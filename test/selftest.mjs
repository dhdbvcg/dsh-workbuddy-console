/**
 * 插件自检：不起 DSH，直接验证路由注册 + 代理逻辑。
 * 用假的 ctx.webServer 收集路由，然后逐个调用。
 */
import assert from 'node:assert/strict';
import http from 'node:http';

const plugin = await import('../lib/index.js');

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

console.log('\n插件形状');

await t('导出 name / inject / apply', () => {
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(plugin.name, 'workbuddy-console');
  assert.deepEqual(plugin.inject, ['webServer']);
});

console.log('\n路由注册');

function harness(port) {
  const routes = new Map();
  const ctx = {
    webServer: {
      port,
      register(route) {
        assert.ok(!routes.has(route.path), '重复路由 ' + route.path);
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  const dispose = plugin.apply(ctx, { port });
  return { routes, dispose, ctx };
}

await t('注册了页面与全部 API 路由', () => {
  const { routes } = harness(19387);
  for (const p of [
    '/wb-console',
    '/wb-console/',
    '/wb-console/app.js',
    '/wb-console/style.css',
    '/wb-console/api/mode',
    '/wb-console/api/overview',
    '/wb-console/api/claim',
    '/wb-console/api/automation/run',
    '/wb-console/api/accounts/disabled',
    '/wb-console/api/accounts/rescan',
    '/wb-console/api/cooldowns/reset',
    '/wb-console/api/models/refresh',
    '/wb-console/api/accounts/check',
    '/wb-console/api/login/open',
    '/wb-console/api/login/desktop',
    '/wb-console/api/tasks',
    '/wb-console/api/tasks/claim',
    '/wb-console/api/diag',
  ]) {
    assert.ok(routes.has(p), '缺少路由 ' + p);
  }
});

await t('dispose 会注销所有路由', () => {
  const { routes, dispose } = harness(19387);
  assert.ok(routes.size > 0);
  dispose();
  assert.equal(routes.size, 0);
});

console.log('\n静态资源');

function fakeRes() {
  const out = { status: 0, headers: null, body: '' };
  return {
    out,
    writeHead(status, headers) {
      out.status = status;
      out.headers = headers;
    },
    end(body) {
      out.body = body;
    },
  };
}

await t('页面路由返回 HTML', async () => {
  const { routes } = harness(19387);
  const res = fakeRes();
  await routes.get('/wb-console').handler({ method: 'GET' }, res);
  assert.equal(res.out.status, 200);
  assert.match(res.out.headers['Content-Type'], /text\/html/);
  assert.match(res.out.body, /WorkBuddy/);
});

await t('尾斜杠 /wb-console/ 也能打开', async () => {
  const { routes } = harness(19387);
  const res = fakeRes();
  await routes.get('/wb-console/').handler({ method: 'GET' }, res);
  assert.equal(res.out.status, 200);
  assert.match(res.out.body, /WorkBuddy/);
});

await t('static 资源引用 /wb-console 前缀', async () => {
  const { routes } = harness(19387);
  const res = fakeRes();
  await routes.get('/wb-console').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /\/wb-console\/style\.css/);
  assert.match(res.out.body, /\/wb-console\/app\.js/);
});

await t('app.js 里的接口调用带 /wb-console/api 前缀', async () => {
  const { routes } = harness(19387);
  const res = fakeRes();
  await routes.get('/wb-console/app.js').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /\/wb-console\/api/);
});

console.log('\n代理到 xdpool（用假 HTTP 服务模拟插件）');

function fakePool(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const r = handler(req.url, req.method, body ? JSON.parse(body) : {}, req.headers);
      res.writeHead(r.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function postReq(bodyObj, method = 'POST') {
  const listeners = { data: [], end: [], error: [] };
  const req = {
    method,
    on(ev, cb) {
      (listeners[ev] || (listeners[ev] = [])).push(cb);
      return req;
    },
  };
  queueMicrotask(() => {
    const payload = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
    if (payload) for (const cb of listeners.data) cb(Buffer.from(payload));
    for (const cb of listeners.end) cb();
  });
  return req;
}

await t('mode 路由：插件在线时返回 accountCount', async () => {
  const { server, port } = await fakePool(() => ({
    status: 200,
    body: { ok: true, accounts: [{ id: 'a' }, { id: 'b' }], automation: {}, models: [] },
  }));
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/mode').handler({ method: 'GET' }, res);
    const j = JSON.parse(res.out.body);
    assert.equal(j.mode, 'plugin');
    assert.equal(j.plugin.accountCount, 2);
  } finally {
    server.close();
  }
});

await t('overview 路由：透传插件数据', async () => {
  const { server, port } = await fakePool(() => ({
    status: 200,
    body: { ok: true, accounts: [{ id: 'a', nickname: 'A' }], models: [{ id: 'm1' }], distribution: 'round-robin' },
  }));
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/overview').handler({ method: 'GET' }, res);
    const j = JSON.parse(res.out.body);
    assert.equal(j.mode, 'plugin');
    assert.equal(j.plugin.accounts[0].nickname, 'A');
  } finally {
    server.close();
  }
});

await t('代理带上了 loopback Origin（插件要求）', async () => {
  let seenOrigin = null;
  const { server, port } = await fakePool((url, method, body, headers) => {
    seenOrigin = headers.origin;
    return { status: 200, body: { ok: true, accounts: [] } };
  });
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/mode').handler({ method: 'GET' }, res);
    assert.equal(seenOrigin, 'http://127.0.0.1:' + port);
  } finally {
    server.close();
  }
});

await t('插件离线时 mode 返回 offline，不抛异常', async () => {
  const { routes } = harness(9);
  const res = fakeRes();
  await routes.get('/wb-console/api/mode').handler({ method: 'GET' }, res);
  const j = JSON.parse(res.out.body);
  assert.equal(j.mode, 'offline');
  assert.equal(j.plugin.online, false);
  assert.ok(j.plugin.error);
});

await t('插件返回非 JSON 时不崩溃', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(502, { 'Content-Type': 'text/html' });
    res.end('<html>bad gateway</html>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/mode').handler({ method: 'GET' }, res);
    const j = JSON.parse(res.out.body);
    assert.equal(j.mode, 'offline');
  } finally {
    server.close();
  }
});

console.log('\n一键全部签到（批量）');

await t('批量签到：claimed + already 汇总正确', async () => {
  const checkinIds = [];
  const { server, port } = await fakePool((url, method, body) => {
    if (url.includes('/status')) {
      return {
        status: 200,
        body: {
          ok: true,
          accounts: [
            { id: 'p1', label: 'A', disabled: false },
            { id: 'p2', label: 'B', disabled: false },
          ],
        },
      };
    }
    checkinIds.push(body.accountId);
    return body.accountId === 'p2'
      ? { status: 200, body: { ok: true, alreadyCheckedIn: true, claim: { credit: 0, streakDays: 1 } } }
      : { status: 200, body: { ok: true, claim: { credit: 100, streakDays: 3 } } };
  });
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/claim').handler(postReq({}), res);
    const j = JSON.parse(res.out.body);
    assert.equal(j.ok, true);
    assert.deepEqual(j.results.map((x) => x.outcome), ['claimed', 'already']);
    assert.equal(j.summary.claimed, 1);
    assert.equal(j.summary.already, 1);
    assert.equal(j.summary.totalCredit, 100);
    assert.deepEqual(checkinIds, ['p1', 'p2'], '应串行遍历两个账号');
  } finally {
    server.close();
  }
});

await t('批量签到：跳过被禁用的账号', async () => {
  const checkinIds = [];
  const { server, port } = await fakePool((url, method, body) => {
    if (url.includes('/status')) {
      return { status: 200, body: { ok: true, accounts: [{ id: 'p1', label: 'A', disabled: false }, { id: 'p2', label: 'B', disabled: true }] } };
    }
    checkinIds.push(body.accountId);
    return { status: 200, body: { ok: true, claim: { credit: 100, streakDays: 1 } } };
  });
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/claim').handler(postReq({}), res);
    assert.deepEqual(checkinIds, ['p1'], '禁用账号不应被签到');
  } finally {
    server.close();
  }
});

await t('批量签到：409 归一化为 inactive', async () => {
  const { server, port } = await fakePool((url) => {
    if (url.includes('/status')) return { status: 200, body: { ok: true, accounts: [{ id: 'p1', label: 'A', disabled: false }] } };
    return { status: 409, body: { error: 'check-in activity is not active' } };
  });
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/claim').handler(postReq({}), res);
    const j = JSON.parse(res.out.body);
    assert.equal(j.results[0].outcome, 'inactive');
  } finally {
    server.close();
  }
});

await t('批量签到：全部禁用时明确报错', async () => {
  const { server, port } = await fakePool(() => ({ status: 200, body: { ok: true, accounts: [{ id: 'p1', label: 'A', disabled: true }] } }));
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/claim').handler(postReq({}), res);
    const j = JSON.parse(res.out.body);
    assert.equal(j.ok, false);
    assert.match(j.error, /没有可签到的账号/);
  } finally {
    server.close();
  }
});

await t('批量签到：插件状态查询失败时提前返回，不误报成功', async () => {
  const { routes } = harness(9);
  const res = fakeRes();
  await routes.get('/wb-console/api/claim').handler(postReq({}), res);
  const j = JSON.parse(res.out.body);
  assert.equal(j.ok, false);
});

console.log('\n通用转发');

await t('POST 转发到插件成功', async () => {
  // 注意：插件启动时会异步轮询 /status 绑定 shim 地址，
  // 所以不能用一个「最后一次请求」变量 —— 会把轮询当成转发结果。
  // 这里只记录目标路径。
  let forwarded = null;
  const { server, port } = await fakePool((url, method, body) => {
    if (url.includes('accounts/disabled')) forwarded = { url, method, body };
    return { status: 200, body: { ok: true, accountId: body.accountId, disabled: body.disabled } };
  });
  try {
    const { routes } = harness(port);
    const res = fakeRes();
    await routes.get('/wb-console/api/accounts/disabled').handler(postReq({ accountId: 'p1', disabled: true }), res);
    const j = JSON.parse(res.out.body);
    assert.equal(j.ok, true);
    assert.ok(forwarded, '转发请求未到达插件');
    assert.match(forwarded.url, /accounts\/disabled/);
    assert.equal(forwarded.method, 'POST');
  } finally {
    server.close();
  }
});

await t('GET 转发被拒绝（只接受 POST）', async () => {
  const { routes } = harness(19387);
  const res = fakeRes();
  await routes.get('/wb-console/api/accounts/disabled').handler({ method: 'GET' }, res);
  assert.equal(res.out.status, 405);
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
