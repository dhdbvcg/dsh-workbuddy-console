/**
 * 守卫：status 查询的延迟特性。
 *
 * 用户报告（2026-10-04）：改完模型点保存，界面要等好几秒才变，原版没这个问题。
 * 根因有两处，这里各锁一条：
 *
 *   1. poolWebStatus 逐账号**串行** await fetchCredits + fetchCheckinStatus ——
 *      N 个账号 = 2N 次串行上游往返，一轮就是好几秒。
 *      → 改成每账号并发（Promise.all），一轮耗时 ≈ 最慢一次往返。
 *
 *   2. 卡片保存后不刷新 status，只能等 30 秒轮询（浏览器测试里另验）。
 *
 * 额外锁：同一区域的在途请求去重 —— 挂载 / 轮询 / 保存刷新撞在一起时
 * 共享同一次查询，而不是各自起一轮 2N 次往返。
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const mod = await import(pathToFileURL(path.join(ROOT, 'vendor', 'xdpool', 'lib', 'index.js')).href);

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const t = async (name, fn) => {
  try { await fn(); ok(name); } catch (e) { bad(name + ' —— ' + (e && e.message ? e.message : e)); }
};
const assert = (await import('node:assert/strict')).default;

console.log('\nstatus 查询延迟');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 构造假 deps：N 个账号，每个 credits/checkin 都耗 `delay` ms，并统计并发峰值。 */
function fakeDeps(n, delay) {
  let running = 0;
  let maxRunning = 0;
  let creditsCalls = 0;
  const track = async (value) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await sleep(delay);
    running -= 1;
    return value;
  };
  const accounts = Array.from({ length: n }, (_, i) => ({
    id: `acc-${i}`,
    label: `账号${i}`,
    credential: { token: `t${i}`, domain: '', expiresAtMs: 0 },
    cooldownUntilMs: 0,
    modelCooldowns: {},
    rateLimitHits: 0,
  }));
  return {
    maxRunning: () => maxRunning,
    creditsCalls: () => creditsCalls,
    deps: {
      pool: {
        list: () => accounts,
        isDisabled: () => false,
        creditReserveOf: () => 0,
        isReserved: () => false,
        noteCredits: () => {},
        lastServedId: () => undefined,
        currentDistribution: () => 'priority',
        creditReservesInOrder: () => [],
      },
      catalogs: {
        cn: { currentSelection: () => ({}), current: () => [] },
        global: { currentSelection: () => ({}), current: () => [] },
      },
      ignoredAccounts: () => [],
      scheduler: () => ({ earningsToday: {} }),
      shim: () => ({ running: false }),
      client: {
        fetchCredits: (c) => { creditsCalls += 1; return track({ total: 100, packages: [] }); },
        fetchCheckinStatus: () => track({ active: true, todayCheckedIn: false, streakDays: 1, dailyCredit: 5, todayCredit: 0, isStreakDay: false, nextStreakDay: null, streakBonusCredit: 0 }),
      },
    },
  };
}

await t('每账号的上游查询是并发的（并发峰值 > 1）', async () => {
  const f = fakeDeps(4, 60);
  await mod.poolWebStatus(f.deps, 'cn');
  assert.ok(f.maxRunning() >= 2, `并发峰值 ${f.maxRunning()}，仍是串行`);
});

await t('4 账号 × 每查询 80ms：总耗时应接近一次往返，而不是 8×80ms 串行', async () => {
  const f = fakeDeps(4, 80);
  const start = Date.now();
  await mod.poolWebStatus(f.deps, 'cn');
  const elapsed = Date.now() - start;
  // 串行 = 4 账号 × 2 查询 × 80ms = 640ms；并发 ≈ 80-160ms。给足余量取 400。
  assert.ok(elapsed < 400, `耗时 ${elapsed}ms，超过并发上限，疑似串行回潮`);
});

await t('响应形状不变：credits 成功字段齐全', async () => {
  const f = fakeDeps(1, 1);
  const status = await mod.poolWebStatus(f.deps, 'cn');
  const row = status.accounts[0];
  assert.strictEqual(row.credits.total, 100);
  assert.deepStrictEqual(row.credits.packages, []);
  assert.strictEqual(row.checkin.active, true);
  assert.strictEqual(row.creditsError, undefined);
  assert.strictEqual(row.checkinError, undefined);
});

await t('单个账号失败只影响自己那行（creditsError / checkinError）', async () => {
  const f = fakeDeps(2, 1);
  // 让第二个账号的两个查询都失败
  const origCredits = f.deps.client.fetchCredits;
  const origCheckin = f.deps.client.fetchCheckinStatus;
  f.deps.client.fetchCredits = (c) => (c.token === 't1' ? Promise.reject(new Error('boom')) : origCredits(c));
  f.deps.client.fetchCheckinStatus = (c) => (c.token === 't1' ? Promise.reject(new Error('bang')) : origCheckin(c));
  const status = await mod.poolWebStatus(f.deps, 'cn');
  assert.strictEqual(status.accounts[0].credits.total, 100, '健康账号不能被波及');
  assert.match(String(status.accounts[1].creditsError), /boom/);
  assert.match(String(status.accounts[1].checkinError), /bang/);
});

await t('同一区域并发请求共享同一次在途查询（fetchCredits 只发一轮）', async () => {
  const f = fakeDeps(2, 80);
  // 拿到真实的路由 handler：registerPoolStatusRoute 会通过 ctx.webServer.register 注册
  const handlers = [];
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => { handlers.push(route); return () => {}; } },
  };
  mod.registerPoolStatusRoute(ctx, f.deps);
  const statusRoute = handlers.find((r) => String(r.path).includes('/status'));
  assert.ok(statusRoute, '没找到 status 路由');

  const makeRes = () => {
    const out = { status: 0, body: undefined };
    return {
      out,
      writeHead(code) { out.status = code; return this; },
      end(payload) { out.body = payload; },
      get headersSent() { return false; },
    };
  };
  const req = { method: 'GET', url: '/?region=cn', headers: {} };

  // 三个请求同时打进来：应共享同一次在途查询
  const results = await Promise.all([0, 1, 2].map(async () => {
    const res = makeRes();
    await statusRoute.handler(req, res);
    return res.out;
  }));
  assert.strictEqual(f.creditsCalls(), 2, `并发 3 个请求应共享一次查询（每账号 1 次），实际发了 ${f.creditsCalls()} 轮`);
  for (const r of results) {
    assert.strictEqual(r.status, 200);
    assert.ok(JSON.parse(r.body).accounts.length === 2);
  }
});

await t('在途查询结束后去重释放（下一次请求起新查询）', async () => {
  const f = fakeDeps(1, 20);
  const handlers = [];
  const ctx = {
    effect: (fn) => fn(),
    webServer: { register: (route) => { handlers.push(route); return () => {}; } },
  };
  mod.registerPoolStatusRoute(ctx, f.deps);
  const statusRoute = handlers.find((r) => String(r.path).includes('/status'));
  const makeRes = () => {
    const out = { status: 0 };
    return { out, writeHead(code) { out.status = code; return this; }, end() {}, get headersSent() { return false; } };
  };
  const req = { method: 'GET', url: '/', headers: {} };
  await statusRoute.handler(req, makeRes());
  const first = f.creditsCalls();
  await statusRoute.handler(req, makeRes());
  assert.strictEqual(f.creditsCalls(), first + 1, '第二个请求应是新查询，而不是拿到被缓存的旧结果');
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);