/**
 * 计费代理自检。
 *
 * 重点：代理必须**原样透传**流式响应，且能抓到 credit。
 * 任何改写都可能破坏 SSE 导致对话中断。
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { startBillingProxy, pickSessionId, pickModel } from '../lib/billing-proxy.mjs';
import * as cm from '../lib/credit-meter.mjs';

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  OK   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message);
    fail++;
  }
}

/** 起一个假的上游 shim */
function fakeUpstream(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

function post(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

console.log('\n请求元信息');

await t('pickSessionId 优先用 x-conversation-id', () => {
  assert.equal(pickSessionId({ headers: { 'x-conversation-id': 'conv1', 'x-request-id': 'r1' } }), 'conv1');
});

await t('pickSessionId 无会话头时退到 request-id', () => {
  assert.equal(pickSessionId({ headers: { 'x-request-id': 'r2' } }), 'r2');
});

await t('pickSessionId 什么都没有时返回 unknown', () => {
  assert.equal(pickSessionId({ headers: {} }), 'unknown');
});

await t('pickModel 从请求体解析', () => {
  assert.equal(pickModel({}, JSON.stringify({ model: 'glm-5.3' })), 'glm-5.3');
  assert.equal(pickModel({}, 'not json'), '');
});

console.log('\n代理透传');

await t('流式响应原样透传（字节一致）', async () => {
  cm.reset();
  const SSE =
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
    'data: {"usage":{"credit":0.08}}\n\n' +
    'data: [DONE]\n\n';

  const up = await fakeUpstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // 分片写出，模拟真实流
      for (const part of SSE.match(/[\s\S]{1,20}/g) || []) res.write(part);
      res.end();
    });
  });

  const proxy = await startBillingProxy({ upstream: up.baseUrl });
  try {
    const r = await post(proxy.baseUrl() + '/v1/chat/completions', { model: 'glm-5.3' }, { 'x-conversation-id': 'c-test' });
    assert.equal(r.status, 200);
    assert.equal(r.body, SSE, '透传内容必须与上游字节一致');
  } finally {
    await proxy.close();
    up.server.close();
  }
});

await t('抓到的 credit 记到正确的会话上', async () => {
  cm.reset();
  const SSE = 'data: {"usage":{"credit":0.08}}\n\ndata: [DONE]\n\n';
  const up = await fakeUpstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(SSE);
    });
  });
  const proxy = await startBillingProxy({ upstream: up.baseUrl });
  try {
    await post(proxy.baseUrl() + '/v1/chat/completions', { model: 'kimi-k3-1' }, { 'x-conversation-id': 'sess-A' });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(cm.getCredit('sess-A').credit, 0.08);
    assert.equal(cm.getCredit('sess-A').calls, 1);
    assert.equal(cm.getCredit('sess-A').model, 'kimi-k3-1', '应记下模型名');
  } finally {
    await proxy.close();
    up.server.close();
  }
});

await t('多个请求累加到同一会话', async () => {
  cm.reset();
  const SSE = 'data: {"usage":{"credit":0.05}}\n\n';
  const up = await fakeUpstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(SSE);
    });
  });
  const proxy = await startBillingProxy({ upstream: up.baseUrl });
  try {
    for (let i = 0; i < 3; i++) {
      await post(proxy.baseUrl() + '/v1/chat/completions', { model: 'm' }, { 'x-conversation-id': 'multi' });
    }
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(cm.getCredit('multi').credit, 0.15);
    assert.equal(cm.getCredit('multi').calls, 3);
  } finally {
    await proxy.close();
    up.server.close();
  }
});

await t('非流式响应（/v1/models）正常转发', async () => {
  const up = await fakeUpstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: 'm1' }] }));
  });
  const proxy = await startBillingProxy({ upstream: up.baseUrl });
  try {
    const r = await new Promise((resolve, reject) => {
      const u = new URL(proxy.baseUrl() + '/v1/models');
      http.get({ host: u.hostname, port: u.port, path: u.pathname }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      }).on('error', reject);
    });
    assert.equal(r.status, 200);
    assert.match(r.body, /m1/);
  } finally {
    await proxy.close();
    up.server.close();
  }
});

console.log('\n安全与健壮性');

await t('白名单外的路径返回 404（不会变成开放代理）', async () => {
  const up = await fakeUpstream((req, res) => {
    res.writeHead(200);
    res.end('should not reach');
  });
  const proxy = await startBillingProxy({ upstream: up.baseUrl });
  try {
    const r = await post(proxy.baseUrl() + '/v1/../../etc/passwd', {});
    assert.equal(r.status, 404);
    assert.ok(!r.body.includes('should not reach'));
  } finally {
    await proxy.close();
    up.server.close();
  }
});

await t('上游不可达时返回 502 而不是崩溃', async () => {
  const proxy = await startBillingProxy({ upstream: 'http://127.0.0.1:9' });
  try {
    const r = await post(proxy.baseUrl() + '/v1/chat/completions', { model: 'm' });
    assert.equal(r.status, 502);
    assert.match(r.body, /unreachable|bad_gateway/);
  } finally {
    await proxy.close();
  }
});

await t('未绑定上游时返回 503', async () => {
  const proxy = await startBillingProxy({});
  try {
    const r = await post(proxy.baseUrl() + '/v1/chat/completions', { model: 'm' });
    assert.equal(r.status, 503);
  } finally {
    await proxy.close();
  }
});

await t('上游 4xx 状态码被原样透传（不吞错误）', async () => {
  const up = await fakeUpstream((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'unauthorized' } }));
    });
  });
  const proxy = await startBillingProxy({ upstream: up.baseUrl });
  try {
    const r = await post(proxy.baseUrl() + '/v1/chat/completions', { model: 'm' });
    assert.equal(r.status, 401, '错误状态必须原样返回，否则调用方无法判断');
    assert.match(r.body, /unauthorized/);
  } finally {
    await proxy.close();
    up.server.close();
  }
});

await t('setUpstream 可在运行后绑定', async () => {
  const up = await fakeUpstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  const proxy = await startBillingProxy({});
  try {
    assert.equal(proxy.hasUpstream(), false);
    proxy.setUpstream(up.baseUrl);
    assert.equal(proxy.hasUpstream(), true);
    const r = await post(proxy.baseUrl() + '/v1/chat/completions', {});
    assert.equal(r.status, 200);
  } finally {
    await proxy.close();
    up.server.close();
  }
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
