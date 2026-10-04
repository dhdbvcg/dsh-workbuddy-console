/**
 * 复现真实故障：同一进程里 apply() 被调用两次。
 *
 * 真实报错：
 *   webserver: duplicate exact route "/wb-console"
 * dsh-host-webserver 的 register() 遇到同一 (kind, path) 直接抛错，
 * 于是整个插件激活失败，界面上显示「异常 / 无法使用」。
 *
 * 触发场景：DSH 自带 hmr，配置或文件变化时插件会被重新 apply。
 * 只要旧的 dispose 没跑到、新的 apply 已经开始，就会撞车。
 *
 * 这个测试用与真实实现一致的严格语义（重复即抛），
 * 验证 apply 幂等：连续 apply 两次不应抛错，且路由表最终只留一份。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN = 'C:/Users/dell/dsh-workbuddy-console';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };

/** 严格按 dsh-host-webserver 的语义：同一 (kind, path) 重复注册就直接抛 */
function makeCtx() {
  const exact = new Map();
  const prefixes = new Map();
  const log = { info() {}, warn() {}, error() {}, debug() {} };
  const noop = () => ({ dispose() {} });
  const service = new Proxy(function () {}, {
    get: (_t, p) => (p === 'then' ? undefined : () => undefined),
    apply: () => undefined,
  });

  const ctx = {
    webServer: {
      port: 8787,
      register(route) {
        const table = route.kind === 'exact' ? exact : prefixes;
        if (table.has(route.path)) {
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
        }
        table.set(route.path, route);
        return () => table.delete(route.path);
      },
      get routes() { return { exact, prefixes }; },
    },
    get(name) { return name === 'webServer' ? this.webServer : service; },
    on: noop, once: noop, emit: noop,
    effect: (fn) => { try { return fn(); } catch { /* 忽略 */ } },
    inject: () => {}, provide: () => {}, set: () => {},
    logger: log,
    locale: { bind: () => (k) => k },
    slots: { inject: () => {}, register: () => ({ dispose() {} }) },
  };
  ctx.self = ctx;
  ctx.root = ctx;
  return ctx;
}

const mod = await import(pathToFileURL(path.join(PLUGIN, 'lib', 'index.js')).href);
const ctx = makeCtx();

// ---- 0. 清掉可能残留的进程级注册（测试自身要可重复运行）----
{
  const key = Symbol.for('dsh-workbuddy-console.liveDispose');
  if (typeof globalThis[key] === 'function') {
    try { globalThis[key](); } catch { /* 忽略 */ }
    globalThis[key] = null;
  }
}

// ---- 1. 第一次 apply ----
let first = null;
try {
  first = await mod.apply(ctx, {});
  ok('第一次 apply 成功');
} catch (e) {
  bad('第一次 apply 抛错: ' + e.message);
}

const n1 = ctx.webServer.routes.exact.size;
ok(`第一次注册后 exact 路由数: ${n1}`);

// ---- 2. 第二次 apply（不先调用上一次的返回值 —— 模拟宿主热重载）----
try {
  await mod.apply(ctx, {});
  ok('第二次 apply 未抛错（幂等生效）');
} catch (e) {
  bad('第二次 apply 抛错: ' + e.message);
}

const n2 = ctx.webServer.routes.exact.size;
if (n2 === n1) ok(`两次 apply 后路由数不变（仍为 ${n2}）`);
else bad(`路由泄漏: 第一次 ${n1} 条，两次后 ${n2} 条`);

// ---- 2b. 最狠的一种：另一个模块实例（模拟宿主重新 import 同一文件）----
// 模块级变量在这里会失效，所以实现用的是 Symbol.for 的进程级 key。
// 用查询串让 Node 生成第二个模块实例。
try {
  const mod2 = await import(pathToFileURL(path.join(PLUGIN, 'lib', 'index.js')).href + '?reload=1');
  const isSame = mod2 === mod;
  if (!isSame) ok('成功加载第二个模块实例（模拟重新 import）');
  else bad('没能生成第二个模块实例，该用例无效');

  await mod2.apply(ctx, {});
  ok('另一个模块实例 apply 未抛错（跨实例幂等生效）');

  const n3 = ctx.webServer.routes.exact.size;
  if (n3 === n1) ok(`跨实例 apply 后路由数仍为 ${n1}`);
  else bad(`跨实例路由泄漏: ${n1} -> ${n3}`);
} catch (e) {
  bad('另一个模块实例 apply 抛错: ' + e.message);
}

// ---- 3. /wb-console 只应有一份 ----
const hasBase = ctx.webServer.routes.exact.has('/wb-console');
if (hasBase) ok('/wb-console 仍在路由表里');
else bad('/wb-console 丢失');

// ---- 4. 正常路径：先 dispose 再 apply 也要能工作 ----
try {
  const d = await mod.apply(ctx, {});
  if (typeof d === 'function') {
    d();
    const n3 = ctx.webServer.routes.exact.size;
    if (n3 === 0) ok('dispose 清空所有路由');
    else bad(`dispose 后仍剩 ${n3} 条路由`);
    await mod.apply(ctx, {});
    ok('dispose 后可重新 apply');
  } else {
    bad('apply 未返回 dispose 函数');
  }
} catch (e) {
  bad('dispose/重新 apply 流程抛错: ' + e.message);
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
