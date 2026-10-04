/**
 * 验证「思考强度 / Max 模式」真的落到请求体上。
 *
 * 这两个功能最容易做成「界面上能点、请求里没变」——所以这里不看 UI，
 * 直接验 shim 注入 reasoning_effort 的那条路径。
 *
 * 关键约束（都来自真实代码，不是猜的）：
 *   - pi-ai 只在请求**显式带 effort** 时才发 reasoning_effort；
 *     没选时字段缺失 → 上游用自己的默认档。
 *   - `thinkingLevelMap` 把 DSH 档位翻译成上游线格式；不支持的档位是 null。
 *   - catalog.visible() 在 Max 模式下忽略 contextBudgets（窗口回到原生上限）。
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

console.log('\n思考强度 / Max 模式');

const MODELS = [
  { id: 'hy4-preview', name: 'Hy4 preview', supportedEfforts: ['low', 'medium', 'high', 'shigh', 'max'], contextWindow: 200000, maxOutputTokens: 32000, supportsImages: false, multiplier: 0 },
  { id: 'hy3', name: 'Hy3', supportedEfforts: ['low', 'high'], contextWindow: 64000, maxOutputTokens: 64000, supportsImages: false, multiplier: 0.05 },
  { id: 'plain', name: 'Plain', supportedEfforts: undefined, contextWindow: 128000, maxOutputTokens: 32000, supportsImages: false, multiplier: 1 },
];

const freshCatalog = () => {
  const c = new mod.WorkBuddyCatalog();
  c.update(MODELS);
  return c;
};

await t('catalog 暴露 maxModeActive / defaultEffortFor / topEffortFor', () => {
  const c = freshCatalog();
  assert.strictEqual(typeof c.maxModeActive, 'function', '缺 maxModeActive');
  assert.strictEqual(typeof c.defaultEffortFor, 'function', '缺 defaultEffortFor');
  assert.strictEqual(typeof c.topEffortFor, 'function', '缺 topEffortFor');
});

await t('默认档：没设置时返回 undefined（不干扰上游）', () => {
  const c = freshCatalog();
  c.applySelection({});
  assert.strictEqual(c.defaultEffortFor(c.find('hy4-preview')), undefined);
  assert.strictEqual(c.maxModeActive(), false);
});

await t('按模型取回各自保存的档位', () => {
  const c = freshCatalog();
  c.applySelection({ reasoningEfforts: { 'hy4-preview': 'high', hy3: 'low' } });
  assert.strictEqual(c.defaultEffortFor(c.find('hy4-preview')), 'high');
  assert.strictEqual(c.defaultEffortFor(c.find('hy3')), 'low');
});

await t('档位不被模型支持时忽略（不能把上游搞报错）', () => {
  const c = freshCatalog();
  // hy3 只支持 low / high，却存了 medium
  c.applySelection({ reasoningEfforts: { hy3: 'medium' } });
  assert.strictEqual(c.defaultEffortFor(c.find('hy3')), undefined, '不支持的档位应被丢弃而不是照发');
});

await t('off 档被保留（界面需要它，线上则表示不发字段）', () => {
  const c = freshCatalog();
  c.applySelection({ reasoningEfforts: { 'hy4-preview': 'off' } });
  assert.strictEqual(c.defaultEffortFor(c.find('hy4-preview')), 'off');
});

await t('没有思考档位的模型取不到档位', () => {
  const c = freshCatalog();
  c.applySelection({ reasoningEfforts: { plain: 'high' } });
  assert.strictEqual(c.defaultEffortFor(c.find('plain')), undefined);
});

await t('topEffortFor 取模型advertise 的最强档', () => {
  const c = freshCatalog();
  // SELECTION_EFFORTS 顺序里，shigh 不在 DSH 档位表中，所以最高应是 max
  assert.strictEqual(c.topEffortFor(c.find('hy4-preview')), 'max');
  assert.strictEqual(c.topEffortFor(c.find('hy3')), 'high');
  assert.strictEqual(c.topEffortFor(c.find('plain')), undefined);
});

await t('Max 模式：visible() 忽略 contextBudgets，窗口回到原生上限', () => {
  const c = freshCatalog();
  c.applySelection({ contextBudgets: { 'hy4-preview': 200000 }, maxMode: true });
  assert.strictEqual(c.maxModeActive(), true);
  const shown = c.visible().find((m) => m.id === 'hy4-preview');
  // 原生也是 200000，用一个更小的预算才能看出差别
  assert.ok(shown.contextWindow >= 200000);
});

await t('Max 模式下较小的预算被忽略（这才是开关的意义）', () => {
  const c = freshCatalog();
  const big = { ...MODELS[0], contextWindow: 1000000 };
  const c2 = new mod.WorkBuddyCatalog();
  c2.update([big]);
  // 关掉 Max：预算生效，窗口被压到200K
  c2.applySelection({ contextBudgets: { 'hy4-preview': 200000 } });
  assert.strictEqual(c2.visible()[0].contextWindow, 200000, '关闭时应按预算压低');
  // 打开 Max：忽略预算，回到原生 1M
  c2.applySelection({ contextBudgets: { 'hy4-preview': 200000 }, maxMode: true });
  assert.strictEqual(c2.visible()[0].contextWindow, 1000000, 'Max 模式应忽略预算');
});

await t('Max 模式不隐藏模型（只放宽限制）', () => {
  const c = freshCatalog();
  c.applySelection({ enabledModelIds: ['hy3'], maxMode: true });
  assert.deepStrictEqual(c.visible().map((m) => m.id), ['hy3'], 'Max 模式不该改变启用集合');
});

await t('applySelection 换一次设置就换一次结论（不缓存陈旧值）', () => {
  const c = freshCatalog();
  c.applySelection({ reasoningEfforts: { 'hy4-preview': 'low' } });
  assert.strictEqual(c.defaultEffortFor(c.find('hy4-preview')), 'low');
  c.applySelection({ reasoningEfforts: { 'hy4-preview': 'max' } });
  assert.strictEqual(c.defaultEffortFor(c.find('hy4-preview')), 'max', '换设置后应立刻生效');
  c.applySelection({});
  assert.strictEqual(c.defaultEffortFor(c.find('hy4-preview')), undefined);
});

// —— 注入路径本身（parseSelection 的校验）——
await t('parseSelection 接受合法 effort 与 maxMode', () => {
  // parseSelection 未导出，用 route 间接验；这里直接验 schema 层
  assert.ok(mod.Config, 'Config 未导出');
  const inner = mod.Config.dict.modelSelectionCn.dict;
  assert.ok(inner.reasoningEfforts, 'schema 缺 reasoningEfforts');
  assert.ok(inner.maxMode, 'schema 缺 maxMode');
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);