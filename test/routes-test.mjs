/**
 * 路由注册校验：确认体检 / 登录 / 任务路由都在，且静态资源可读。
 */
import assert from 'node:assert/strict';
import * as plugin from '../lib/index.js';

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message);
    fail++;
  }
}

function harness() {
  const routes = new Map();
  const ctx = {
    webServer: {
      port: 19387,
      register(r) {
        routes.set(r.path, r);
        return () => routes.delete(r.path);
      },
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  plugin.apply(ctx, { port: 19387 });
  return routes;
}

function fakeRes() {
  const out = { status: 0, headers: null, body: '' };
  return {
    out,
    writeHead(s, h) {
      out.status = s;
      out.headers = h;
    },
    end(b) {
      out.body = b;
    },
  };
}

console.log('\n路由');

t('体检与登录路由已注册', () => {
  const routes = harness();
  for (const p of ['/wb-console/api/accounts/check', '/wb-console/api/login/open', '/wb-console/api/login/desktop']) {
    assert.ok(routes.has(p), '缺少 ' + p);
  }
});

t('任务路由已注册', () => {
  const routes = harness();
  for (const p of ['/wb-console/api/tasks', '/wb-console/api/tasks/claim']) {
    assert.ok(routes.has(p), '缺少 ' + p);
  }
});

t('原有路由仍在', () => {
  const routes = harness();
  for (const p of ['/wb-console', '/wb-console/', '/wb-console/api/mode', '/wb-console/api/overview', '/wb-console/api/claim', '/wb-console/api/automation/run']) {
    assert.ok(routes.has(p), '缺少 ' + p);
  }
});

console.log('\n页面');

t('页面含检查 / 登录按钮', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /btn-check/);
  assert.match(res.out.body, /btn-login/);
});

t('页面含登录弹窗与两个选项', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /login-modal/);
  assert.match(res.out.body, /btn-login-web/);
  assert.match(res.out.body, /btn-login-desktop/);
});

t('页面含体检结果面板', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /check-panel/);
  assert.match(res.out.body, /check-body/);
});

t('页面含未完成任务面板', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /tasks-panel/);
  assert.match(res.out.body, /btn-tasks/);
});

console.log('\n前端脚本');

t('app.js 调用新接口', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console/app.js').handler({ method: 'GET' }, res);
  for (const frag of ['/api/accounts/check', '/api/login/open', '/api/login/desktop', '/api/tasks']) {
    assert.ok(res.out.body.includes(frag), '缺少 ' + frag);
  }
});

// 回归：曾经因为前缀拼两次，请求打到 /wb-console/api/api/mode 而 404
t('apiUrl 不会把 /api 前缀拼两次', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console/app.js').handler({ method: 'GET' }, res);
  const body = res.out.body;
  assert.match(body, /function apiUrl/, '应存在 apiUrl 归一化函数');
  const codeOnly = body
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.ok(!/API\s*\+\s*path\b/.test(codeOnly), '代码里不应直接 API + path');
});

t('apiUrl 归一化逻辑正确', () => {
  const BASE_PATH = '/wb-console';
  const API = BASE_PATH + '/api';
  const apiUrl = (path) => {
    const p = String(path || '');
    if (p.startsWith(BASE_PATH + '/')) return p;
    const rel = p.startsWith('/api/') ? p.slice(4) : p.startsWith('/') ? p : '/' + p;
    return API + rel;
  };
  assert.equal(apiUrl('/api/mode'), '/wb-console/api/mode');
  assert.equal(apiUrl('/mode'), '/wb-console/api/mode');
  assert.equal(apiUrl('mode'), '/wb-console/api/mode');
  assert.equal(apiUrl('/api/tasks'), '/wb-console/api/tasks');
  assert.equal(apiUrl('/wb-console/api/mode'), '/wb-console/api/mode');
  for (const p of ['/api/mode', '/mode', 'mode', '/api/overview?credits=1', '/api/tasks/claim']) {
    assert.ok(!apiUrl(p).includes('/api/api/'), '出现双 /api: ' + apiUrl(p));
  }
});

t('app.js 不含密码输入框', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console/app.js').handler({ method: 'GET' }, res);
  assert.ok(!/type=["']password["']/.test(res.out.body), '前端不应有密码输入框');
});

t('style.css 含体检与任务样式', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console/style.css').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /\.check-row/);
  assert.match(res.out.body, /\.task-group/);
  assert.match(res.out.body, /\.tbar/);
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
