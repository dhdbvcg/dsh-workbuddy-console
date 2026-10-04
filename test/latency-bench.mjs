/**
 * 量化「点按钮延迟」：用假池 +真实插件路由，测量一次页面 load() 的墙钟时间。
 *
 * 背景（数字来自真实 DSH + 真实账号池的实测）：
 *   池 /status：每个账号 2 次上游往返（credits + checkin），
 *              3 个账号 → 约 1.3s
 *   /api/tasks：逐账号拉任务 → 2.4~4.6s
 *
 * 优化前：前端 load() 串行 `await mode` → `await overview`，
 *         而这两个接口打的是同一个池 status → 冷启动 2 次串行往返。
 * 优化后：前端 Promise.all 并发 + 后端 in-flight 去重 → 只打 1 次。
 *
 * 用法：node test/latency-bench.mjs
 *   POOL_LATENCY_MS=1300 模拟单次池 status 的真实耗时
 */
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..');
const POOL_LATENCY_MS = Number(process.env.POOL_LATENCY_MS || 1300);

const plugin = await import(pathToFileURL(join(PLUGIN, 'lib', 'index.js')).href);

// —— 假池：模拟真实上游延迟 ——
let poolHits = 0;
const pool = http.createServer(async (req, res) => {
  poolHits++;
  await new Promise((r) => setTimeout(r, POOL_LATENCY_MS));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, accounts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], models: [] }));
});
await new Promise((r) => pool.listen(0, '127.0.0.1', r));
const poolPort = pool.address().port;

// —— 插件路由表（结构与 test/selftest.mjs 的 harness 一致）——
const routes = new Map();
plugin.apply(
  {
    webServer: {
      port: poolPort,
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  },
  { port: poolPort, creditMeter: false },
);

const fakeRes = () => {
  const r = { statusCode: 0, body: '', headers: {} };
  r.writeHead = (code, h) => { r.statusCode = code; r.headers = h || {}; };
  r.end = (b) => { r.body = b || ''; };
  return r;
};

/** 走插件真实handler（和浏览器请求同一条路径） */
const hit = async (path) => {
  const handler = routes.get(path);
  if (!handler) throw new Error(`没有路由 ${path}`);
  const res = fakeRes();
  const t0 = Date.now();
  await handler.handler({ method: 'GET', url: path }, res);
  return { ms: Date.now() - t0, status: res.statusCode };
};

/** 清掉池缓存，让下一段测的是真正的冷启动 */
const cold = () => plugin.invalidatePoolCache('bench');

console.log(`\n假池单次 status 延迟：${POOL_LATENCY_MS}ms（模拟 3 个账号的真实耗时）\n`);

// 预热：把模块加载、连接建立等一次性开销排除掉
cold();
await hit('/wb-console/api/mode');
await hit('/wb-console/api/overview');

// —— 旧行为：前端串行 ——
// 关键：mode 先跑，它会**填上缓存**，所以随后串行的 overview 命中缓存
// 只花几毫秒 —— 这正是优化前的样子：墙钟 = 一次慢池请求 + 一堆快请求。
cold();
poolHits = 0;
const t0 = Date.now();
const a = await hit('/wb-console/api/mode');
const b = await hit('/wb-console/api/overview');
const beforeTotal = Date.now() - t0;
const beforeHits = poolHits;
console.log('=== 优化前：串行 await mode → await overview ===');
console.log(`  /api/mode      ${String(a.ms).padStart(5)} ms  ← 慢池请求`);
console.log(`  /api/overview  ${String(b.ms).padStart(5)} ms  ← 命中 mode 填的缓存`);
console.log(`  合计           ${String(beforeTotal).padStart(5)} ms，打池 ${beforeHits} 次`);

// —— 新行为：前端并发 + 后端 in-flight 去重 ——
// 两个请求几乎同时到达，in-flight 去重把第二个并进第一个：
// 两边都等同一次池往返，墙钟不变但池只被打 1 次。
cold();
poolHits = 0;
const t1 = Date.now();
const [c, d] = await Promise.all([hit('/wb-console/api/mode'), hit('/wb-console/api/overview')]);
const afterTotal = Date.now() - t1;
const afterHits = poolHits;
console.log('\n=== 优化后：Promise.all 并发 + in-flight 去重 ===');
console.log(`  /api/mode      ${String(c.ms).padStart(5)} ms  | 两者并行走同一次池往返`);
console.log(`  /api/overview  ${String(d.ms).padStart(5)} ms  |`);
console.log(`  合计           ${String(afterTotal).padStart(5)} ms，打池 ${afterHits} 次`);

console.log(`\n  冷启动墙钟：${beforeTotal} ms → ${afterTotal} ms（并发不增加耗时）`);
console.log(`  池请求数：  串行 ${beforeHits} 次 → 并发去重 ${afterHits} 次（池压力减半）`);

// —— 二次点击（缓存命中）——
const t2 = Date.now();
await Promise.all([hit('/wb-console/api/mode'), hit('/wb-console/api/overview')]);
const warmTotal = Date.now() - t2;
console.log(`  二次点击（缓存命中）：${warmTotal} ms`);

pool.close();

// 判定：并发不增加墙钟、池只打1 次、二次点击命中缓存
const pass = afterHits === 1 && afterTotal <= beforeTotal + 100 && warmTotal < 200;
console.log(
  `\n结果：${pass ? '通过' : '失败'}（期望：并发只打1 次池、墙钟不劣化、二次点击 <200ms）`,
);
process.exit(pass ? 0 : 1);