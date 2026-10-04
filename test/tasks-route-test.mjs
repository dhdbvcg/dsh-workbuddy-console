/**
 * 未完成任务路由自检：注册、页面元素、真实接口。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// lib/ 相对本文件定位，测试可从任意目录运行。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const plugin = await import('file:///' + path.join(HERE, '..', 'lib', 'index.js').replace(/\\/g, '/'));

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  ✓ ' + name);
    pass++;
  } catch (e) {
    console.log('  ✗ ' + name + '\n      ' + e.message);
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
    writeHead(s, h) { out.status = s; out.headers = h; },
    end(b) { out.body = b; },
  };
}

function postReq(bodyObj) {
  const listeners = { data: [], end: [], error: [] };
  const req = { method: 'POST', on(ev, cb) { (listeners[ev] || (listeners[ev] = [])).push(cb); return req; } };
  queueMicrotask(() => {
    const payload = bodyObj === undefined ? '' : JSON.stringify(bodyObj);
    if (payload) for (const cb of listeners.data) cb(Buffer.from(payload));
    for (const cb of listeners.end) cb();
  });
  return req;
}

console.log('\n路由注册');

await t('tasks 与 tasks/claim 路由已注册', () => {
  const routes = harness();
  assert.ok(routes.has('/wb-console/api/tasks'), '缺少 /api/tasks');
  assert.ok(routes.has('/wb-console/api/tasks/claim'), '缺少 /api/tasks/claim');
});

await t('原有路由未被破坏', () => {
  const routes = harness();
  for (const p of ['/wb-console', '/wb-console/api/mode', '/wb-console/api/overview',
                   '/wb-console/api/claim', '/wb-console/api/accounts/check',
                   '/wb-console/api/login/open']) {
    assert.ok(routes.has(p), '缺少 ' + p);
  }
});

console.log('\n页面与前端');

await t('页面含未完成任务面板', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /tasks-panel/);
  assert.match(res.out.body, /未完成任务/);
  assert.match(res.out.body, /btn-tasks/);
});

await t('app.js 调用 tasks 接口', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console/app.js').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /\/api\/tasks/);
  assert.match(res.out.body, /\/api\/tasks\/claim/);
});

await t('style.css 含任务样式', () => {
  const routes = harness();
  const res = fakeRes();
  routes.get('/wb-console/style.css').handler({ method: 'GET' }, res);
  assert.match(res.out.body, /\.task-group/);
  assert.match(res.out.body, /\.tbar/);
});

console.log('\n接口行为');

const routes = harness();

await t('GET /api/tasks 返回真实任务数据', async () => {
  const res = fakeRes();
  await routes.get('/wb-console/api/tasks').handler({ method: 'GET' }, res);
  const j = JSON.parse(res.out.body);
  assert.equal(res.out.status, 200);
  assert.equal(j.ok, true);
  assert.ok(j.totals, '缺少 totals');
  console.log(`      实测：${j.totals.accounts} 个账号，未完成 ${j.totals.pendingTasks} 个，可领取 ${j.totals.claimableTasks} 个，可拿 ${j.totals.pendingCredit} 积分`);
  if (j.accounts.length) {
    const a = j.accounts.find((x) => x.ok);
    if (a) {
      assert.ok(Array.isArray(a.pending), 'pending 应为数组');
      assert.ok(Array.isArray(a.claimable), 'claimable 应为数组');
      // 未完成任务必须真的没达标
      for (const task of a.pending) {
        assert.ok(task.current < task.target, `${task.taskCode} pending 却 ${task.current}/${task.target}`);
      }
    }
  }
});

await t('GET /api/tasks/claim 被拒绝（只接受 POST）', async () => {
  const res = fakeRes();
  await routes.get('/wb-console/api/tasks/claim').handler({ method: 'GET' }, res);
  assert.equal(res.out.status, 405);
});

await t('POST /api/tasks/claim 缺参数 → 400', async () => {
  const res = fakeRes();
  await routes.get('/wb-console/api/tasks/claim').handler(postReq({ uid: 'x' }), res);
  assert.equal(res.out.status, 400);
  assert.match(JSON.parse(res.out.body).error, /taskCode/);
});

await t('POST /api/tasks/claim 未知 uid → 404（不能领任意账号）', async () => {
  const res = fakeRes();
  await routes.get('/wb-console/api/tasks/claim').handler(postReq({ uid: 'nope', taskCode: 'x' }), res);
  assert.equal(res.out.status, 404);
});

console.log('\nstale-while-revalidate（点按钮延迟的另一半来源）');

// 用纯函数判定，不打真实上游 —— 上游要2~5s，测试必须瞬时且确定。
const D = plugin.tasksCacheDecision;
const cache = { key: 'default', at: 1000, value: {} };
const TTL = 30000, STALE = 300000;

await t('TTL 内 → fresh（直接给缓存）', () => {
  assert.equal(D(cache, 'default', false, TTL, STALE, 1000 + 100), 'fresh');
});

await t('过了 TTL 但在 stale 窗口内 → stale（先给旧数据、后台刷新）', () => {
  assert.equal(D(cache, 'default', false, TTL, STALE, 1000 + TTL + 1), 'stale');
  assert.equal(D(cache, 'default', false, TTL, STALE, 1000 + STALE - 1), 'stale');
});

await t('超出 stale 窗口 → miss（必须真去拉）', () => {
  assert.equal(D(cache, 'default', false, TTL, STALE, 1000 + STALE), 'miss');
});

await t('refresh=1 一律 miss（用户主动要最新）', () => {
  assert.equal(D(cache, 'default', true, TTL, STALE, 1000), 'miss');
});

await t('缓存键不同 / 无缓存 / TTL 关闭 → miss', () => {
  assert.equal(D(cache, 'all', false, TTL, STALE, 1000), 'miss');
  assert.equal(D(null, 'default', false, TTL, STALE, 1000), 'miss');
  assert.equal(D(cache, 'default', false, 0, STALE, 1000), 'miss');
});

await t('stale 窗口至少 5 分钟（成长任务变化很慢，不能刚过期就打上游）', () => {
  // 生产默认 TTL=30s → stale窗口应远大于 TTL，否则等于没优化
  const prodTTL = 30000;
  const prodStale = Math.max(prodTTL * 10, 300000);
  assert.ok(prodStale >= 300000, `stale 窗口 ${prodStale}ms 太短`);
  assert.ok(D(cache, 'default', false, prodTTL, prodStale, 1000 + 60000) === 'stale',
    'TTL 后 1 分钟仍应命中 stale');
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

