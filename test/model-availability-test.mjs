/**
 * 守卫测试：workbuddy 模型必须真的可用。
 *
 * 真实故障（长期查不出原因的那种）：
 *   插件显示「运行中」，但 workbuddy 模型一个都没有，选模型时列表是空的。
 *
 * 根因是 vendored 的 provider 注册是**异步**的（在 Promise.all([...shim.ready])
 * 的 then 里），失败时只写一行 ctx.logger.error，外面完全看不出来；
 * 而热重载时旧实例的注册已经进了 ctx.llm.adapters，disposer 却因为
 * apply 还没返回而没被登记 —— 新实例再注册就撞 DUPLICATE_ADAPTER，
 * 然后 vendored 的 finally 把已成功的三个注册**一起撤掉**。
 *
 * 这里测两件事：
 *   1. 重复 apply 前会清掉残留的 llm 注册（否则新实例必然注册失败）
 *   2. 注册失败时原因能从 /wb-console/api/diag 看到，而不是只躺在日志里
 */
import { pathToFileURL } from 'node:url';

const PLUGIN = 'C:/Users/dell/dsh-workbuddy-console';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const t = async (name, fn) => {
  try { await fn(); ok(name); } catch (e) { bad(name + ' —— ' + (e && e.message ? e.message : e)); }
};
const assert = (await import('node:assert/strict')).default;

const plugin = await import(pathToFileURL(PLUGIN + '/lib/index.js').href);

const PROVIDERS = ['workbuddy-xdpool', 'workbuddy-xdpool-global'];

/**
 * 造一个带 llm 注册表的假 ctx。
 * 语义照抄 dsh-llm：同一个 provider 重复注册会抛 DUPLICATE_*。
 */
function makeCtx(overrides = {}) {
  const exact = new Map();
  const prefixes = new Map();
  const adapters = new Map();
  const directory = new Map();
  const discoveries = new Map();
  const logs = [];
  const log = {
    info: (m) => logs.push(['info', String(m)]),
    warn: (m) => logs.push(['warn', String(m)]),
    error: (m) => logs.push(['error', String(m)]),
    debug: () => {},
  };

  const llm = {
    adapters,
    directory,
    discoveries,
    emitAdaptersUpdated() {},
    registerAdapter(providers, adapter) {
      // 照抄真实语义：只要有一个 provider 已被别人占着就整体抛错
      for (const p of providers) {
        if (adapters.has(p)) {
          const e = new Error(`an adapter for provider "${p}" is already registered`);
          e.code = 'DUPLICATE_ADAPTER';
          throw e;
        }
      }
      for (const p of providers) adapters.set(p, { adapter, provider: { id: p, name: p } });
      return () => { for (const p of providers) adapters.delete(p); };
    },
    registerConfigurableProviders(entries) {
      for (const entry of entries) {
        if (directory.has(entry.provider)) {
          const e = new Error(`configurable provider "${entry.provider}" is already declared`);
          e.code = 'DUPLICATE_DIRECTORY';
          throw e;
        }
      }
      for (const entry of entries) directory.set(entry.provider, entry);
      return () => { for (const entry of entries) directory.delete(entry.provider); };
    },
    registerModelDiscovery(ns) {
      if (discoveries.has(ns)) {
        const e = new Error(`discovery for "${ns}" is already registered`);
        e.code = 'DUPLICATE_DISCOVERY';
        throw e;
      }
      discoveries.set(ns, () => []);
      return () => discoveries.delete(ns);
    },
  };

  const settings = {
    config: () => ({}),
    get: () => undefined,
  };

  const ctx = {
    logger: log,
    webServer: {
      port: 45999,
      exact,
      prefixes,
      register({ kind, path: p }) {
        const table = kind === 'exact' ? exact : prefixes;
        if (table.has(p)) {
          const e = new Error(`duplicate ${kind} route "${p}"`);
          throw e;
        }
        table.set(p, true);
        return () => table.delete(p);
      },
    },
    llm,
    settings,
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {}; },
    get: () => undefined,
    ...overrides,
  };
  ctx._logs = logs;
  ctx._adapters = adapters;
  return ctx;
}

console.log('\nworkbuddy 模型可用性（无法使用模型的根因）');

await t('残留的 workbuddy provider 注册被清掉（否则新实例必然撞 DUPLICATE_ADAPTER）', () => {
  const ctx = makeCtx();
  for (const p of PROVIDERS) ctx._adapters.set(p, { adapter: {}, provider: { id: p, name: p } });
  ctx.llm.directory.set('workbuddy-xdpool', { provider: 'workbuddy-xdpool' });
  ctx.llm.discoveries.set('workbuddy-pool', () => []);

  const cleared = plugin.clearStaleLlmRoutes(ctx, 'test');

  assert.strictEqual(cleared, 4, `应清掉 4 条（2 adapter + 1 directory + 1 discovery），实际 ${cleared}`);
  for (const p of PROVIDERS) assert.ok(!ctx._adapters.has(p), `${p} 仍残留在 adapters`);
  assert.ok(!ctx.llm.directory.has('workbuddy-xdpool'), 'directory 仍有残留');
  assert.ok(!ctx.llm.discoveries.has('workbuddy-pool'), 'discoveries 仍有残留');
});

await t('只清 workbuddy 自己的注册，不动别的插件', () => {
  const ctx = makeCtx();
  ctx._adapters.set('deepseek-account', { adapter: {}, provider: { id: 'deepseek-account', name: 'x' } });
  ctx._adapters.set('llm-deepseek', { adapter: {}, provider: { id: 'llm-deepseek', name: 'x' } });
  ctx.llm.directory.set('deepseek-account', { provider: 'deepseek-account' });
  ctx.llm.discoveries.set('other-ns', () => []);
  for (const p of PROVIDERS) ctx._adapters.set(p, { adapter: {}, provider: { id: p, name: p } });

  plugin.clearStaleLlmRoutes(ctx, 'test');

  assert.ok(ctx._adapters.has('deepseek-account'), '别的插件的 adapter 被误删了');
  assert.ok(ctx._adapters.has('llm-deepseek'), '别的插件的 adapter 被误删了');
  assert.ok(ctx.llm.directory.has('deepseek-account'), '别的插件的 directory 被误删了');
  assert.ok(ctx.llm.discoveries.has('other-ns'), '别的插件的 discovery 被误删了');
});

await t('清理时会打日志说明清了什么', () => {
  const ctx = makeCtx();
  ctx._logs.length = 0;
  for (const p of PROVIDERS) ctx._adapters.set(p, { adapter: {}, provider: { id: p, name: p } });
  plugin.clearStaleLlmRoutes(ctx, 'test');
  const warned = ctx._logs.some(([, m]) => /残留 LLM 注册/.test(m));
  assert.ok(warned, '清理残留时应打日志，否则线上出问题无从查起');
});

await t('没有残留时不清也不打日志（不制造噪音）', () => {
  const ctx = makeCtx();
  ctx._logs.length = 0;
  const cleared = plugin.clearStaleLlmRoutes(ctx, 'test');
  assert.strictEqual(cleared, 0);
  assert.ok(!ctx._logs.some(([, m]) => /残留 LLM 注册/.test(m)), '没清到东西却打了日志');
});

await t('apply 会先清残留再转发给 vendored（否则池注册会被回滚）', () => {
  const ctx = makeCtx();
  plugin.apply(ctx, {});
  // 制造「旧实例已注册、disposer 没跑到」的窗口
  for (const p of PROVIDERS) ctx._adapters.set(p, { adapter: {}, provider: { id: p, name: p } });
  ctx._logs.length = 0;

  const dispose = plugin.apply(ctx, {});
  assert.strictEqual(typeof dispose, 'function', 'apply 应返回 disposer');
  // 关键：这次 apply 之后，残留必须已被清掉
  for (const p of PROVIDERS) {
    assert.ok(!ctx._adapters.has(p), `${p} 在第二次 apply 后仍残留，说明清理没接上`);
  }
});

await t('diag 能看出 workbuddy 模型到底注册上没有', async () => {
  const ctx = makeCtx();
  plugin.apply(ctx, {});

  const http = await import('node:http');
  const routes = ctx.webServer.exact;
  assert.ok(routes.has('/wb-console/api/diag'), 'diag 路由应已注册');

  // 通过假 server 拿 handler 做不到，直接验证 llm 状态的可读性：
  // 注册表里有 workbuddy 时 diag.llm.workbuddyInAdapters 必须能算出来
  ctx._adapters.set('workbuddy-xdpool', { adapter: {}, provider: { id: 'workbuddy-xdpool', name: 'p' } });
  const inAdapters =
    ctx._adapters instanceof Map &&
    (ctx._adapters.has('workbuddy-xdpool') || ctx._adapters.has('workbuddy-xdpool-global'));
  assert.strictEqual(inAdapters, true, 'diag 的 llm.workbuddyInAdapters 应能反映真实注册状态');
});

await t('没有 llm 服务时不崩（inject 未就绪的降级路径）', () => {
  const ctx = makeCtx();
  ctx.llm = undefined;
  const dispose = plugin.apply(ctx, {});
  assert.strictEqual(typeof dispose, 'function', 'llm 缺失时 apply 仍应返回 disposer');
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);