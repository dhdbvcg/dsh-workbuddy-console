/**
 * 守卫：图片降级代理不能改变 adapter 的**其它**行为。
 *
 * 为什么需要这层测试：v2.0.23/24 的 Proxy 包裹了 PiAiAdapter 的**每一个**方法，
 * 而它在真实宿主里作用于**所有**请求 —— 不只是带图的那些。也就是说，这个代理
 * 一旦在某条路径上出了偏差（this 绑定、参数形状、class 身份），用户会看到
 * 「模型选择器坏了 / 正常聊天也坏了」，而且只会在重启后才发现。
 *
 * 所以这里拿**真实的 PiAiAdapter**（不是假对象）做包装前后的 A/B：
 * 方法面逐个跑，结果（�� JSON 可比的形式）必须一致。
 *
 * 已经真的抓到过一处：get 陷阱把 `constructor` 也包了，导致
 * `wrapped.constructor === PiAiAdapter` 变成 false、`.constructor.name` 变空串。
 */
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR = path.join(ROOT, 'vendor', 'xdpool');
const mod = await import(pathToFileURL(path.join(VENDOR, 'lib', 'index.js')).href);
const { PiAiAdapter } = await import(
  pathToFileURL(path.join(VENDOR, 'node_modules', '@deepseek-ai', 'dsh-llm-pi-ai', 'lib', 'index.js')).href
);
const { createProvider } = await import(
  pathToFileURL(path.join(VENDOR, 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'index.js')).href
);

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const t = async (name, fn) => {
  try { await fn(); ok(name); } catch (e) { bad(name + ' —— ' + (e && e.message ? e.message : e)); }
};
const assert = (await import('node:assert/strict')).default;
const { withToolImageDowngrade, WorkBuddyCatalog, createWorkBuddyAdapter } = mod;

console.log('\n降级代理对 adapter 其它行为的影响');

const PROVIDER = 'workbuddy-xdpool';

/** 用真实 provider + 真实 profile 造一个 PiAiAdapter（与插件内部同构）。 */
function buildRawAdapter(shimBaseUrl) {
  const catalog = new WorkBuddyCatalog();
  catalog.update([{
    id: 'hy4-preview',
    name: 'Hy4 preview',
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsImages: true,
    multiplier: 0,
    supportedEfforts: ['high'],
  }]);
  const models = catalog.visible().map((info) => ({
    id: info.id,
    name: info.name,
    input: info.supportsImages ? ['text', 'image'] : ['text'],
    output: ['text'],
    cost: { input: 0, output: 0 },
    contextWindow: info.contextWindow,
    maxTokens: info.maxOutputTokens,
  }));
  const provider = createProvider({
    id: PROVIDER,
    name: 'WorkBuddy XD Pool',
    auth: { apiKey: { name: 'test', async resolve() { return { auth: { apiKey: 'k' }, source: 'test' }; } } },
    models,
    api: { stream: async function* () { /* 不该被调用 */ }, streamSimple: async function* () { /* 不该被调用 */ } },
  });
  const profile = {
    provider: PROVIDER,
    displayName: 'WorkBuddy XD Pool',
    streamIdleTimeoutMs: 30000,
    configuredMaxTokens: new Map(),
    modelErrors: new Map(),
    piProvider: provider,
  };
  const adapter = new PiAiAdapter({
    profiles: () => new Map([[PROVIDER, profile]]),
    auth: { credentials: { read: async () => {}, list: async () => [], modify: async () => {}, delete: async () => {} } },
    resolveApiKey: async () => 'k',
  });
  return { adapter, catalog, shimBaseUrl };
}

/** 把方法结果转成可比较的形式（Promise 与错误都要归一）。 */
async function settle(fn) {
  try {
    const value = await fn();
    return { ok: true, value: JSON.parse(JSON.stringify(value ?? null)) };
  } catch (e) {
    return { ok: false, code: e?.code ?? null, message: String(e?.message ?? e).slice(0, 120) };
  }
}

await t('class 身份不被代理破坏（instanceof / prototype / constructor）', () => {
  const { adapter } = buildRawAdapter('http://127.0.0.1:1');
  const wrapped = withToolImageDowngrade(adapter, () => true);
  assert.ok(wrapped instanceof PiAiAdapter, 'instanceof 应仍成立');
  assert.strictEqual(Object.getPrototypeOf(wrapped), Object.getPrototypeOf(adapter), 'prototype 应相同');
  assert.strictEqual(wrapped.constructor, PiAiAdapter, 'constructor 身份必须保持 —— 宿主可能有 class 身份判断');
  assert.strictEqual(wrapped.constructor.name, 'PiAiAdapter', 'constructor.name 不能被包装成空串');
});

await t('同步方法：包装前后行为一致', async () => {
  const { adapter } = buildRawAdapter('http://127.0.0.1:1');
  const wrapped = withToolImageDowngrade(adapter, () => true);
  for (const method of ['providerInfo', 'providerRetryPolicy']) {
    const before = await settle(() => adapter[method](PROVIDER));
    const after = await settle(() => wrapped[method](PROVIDER));
    assert.deepStrictEqual(after, before, `${method} 行为被代理改变了`);
  }
});

await t('模型相关方法：包装前后行为一致（含模型选择器用到的能力字段）', async () => {
  const { adapter } = buildRawAdapter('http://127.0.0.1:1');
  const wrapped = withToolImageDowngrade(adapter, () => true);
  // 只用**公开**入口比较：`modelInfo(snapshot, …)` 是内部方法（第一参是 snapshot），
  // 拿它做 A/B 会因签名不同而误报。公开面是 listModels / resolveModel。
  for (const method of ['listModels', 'resolveModel']) {
    const before = await settle(() => adapter[method](PROVIDER, 'hy4-preview'));
    const after = await settle(() => wrapped[method](PROVIDER, 'hy4-preview'));
    assert.deepStrictEqual(after, before, `${method} 行为被代理改变了`);
  }
  // 模型选择器要靠这个字段渲染「图片输入」等能力
  const info = await wrapped.resolveModel(PROVIDER, 'hy4-preview');
  assert.ok(JSON.stringify(info).includes('image'), 'resolveModel 里应仍带 image 能力，UI 才能显示图片输入开关');
});

await t('未知 provider / 模型：包装前后同样按各自的错误走', async () => {
  const { adapter } = buildRawAdapter('http://127.0.0.1:1');
  const wrapped = withToolImageDowngrade(adapter, () => true);
  const cases = [
    ['listModels', 'no-such-provider'],
    ['resolveModel', 'no-such-provider'],
    ['resolveModel', 'hy4-preview'], // provider 对、模型错
  ];
  for (const [method, provider] of cases) {
    const before = await settle(() => adapter[method](provider, 'no-such-model'));
    const after = await settle(() => wrapped[method](provider, 'no-such-model'));
    assert.deepStrictEqual(after, before, `${method}(${provider}) 的失败方式被代理改变了`);
  }
});

await t('prepareCall：包装前后一致（不带 messages 的调用不受影响）', async () => {
  const { adapter } = buildRawAdapter('http://127.0.0.1:1');
  const wrapped = withToolImageDowngrade(adapter, () => true);
  const before = await settle(() => adapter.prepareCall(PROVIDER, 'hy4-preview', {}));
  const after = await settle(() => wrapped.prepareCall(PROVIDER, 'hy4-preview', {}));
  assert.deepStrictEqual(after, before, 'prepareCall 行为被代理改变了');
});

await t('插件真实 adapter 的 providerInfo / listModels 也能正常工作', async () => {
  const catalog = new WorkBuddyCatalog();
  catalog.update([{
    id: 'hy4-preview',
    name: 'Hy4 preview',
    contextWindow: 200000,
    maxOutputTokens: 32000,
    supportsImages: true,
    multiplier: 0,
  }]);
  const { adapter } = createWorkBuddyAdapter({
    shim: { baseUrl: () => 'http://127.0.0.1:1', token: () => 't' },
    catalog,
    ctx: { get: () => undefined },
    providerId: PROVIDER,
  });
  assert.strictEqual(adapter.providerInfo(PROVIDER).id, PROVIDER);
  const models = await adapter.listModels(PROVIDER);
  assert.strictEqual(models.length, 1);
  assert.deepStrictEqual([...models[0].inputModalities].sort(), ['image', 'text'],
    '模型选择器依赖 inputModalities 显示图片输入开关，代理不能影响它');
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);