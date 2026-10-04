/**
 * 守卫：上游的 shigh 档必须出现在 DSH 自带的推理等级列表里。
 *
 * 用户要求（2026-10-04）：模型支持的思考强度选择要做到 DSH 自带的
 * 推理等级列表中。但 DSH 的「超高」叫 xhigh，上游线格式叫 shigh ——
 * 同一个档位两套命名。thinkingLevelMap 原来做精确字符串匹配，导致
 * advertise shigh 的模型在 DSH 列表里丢掉超高（只剩 低/中/高/极致），
 * 而 WorkBuddy 客户端同一模型有 5 档。
 *
 * 修法：上游只报 shigh 时把 DSH 的 xhigh 映射到线格式 shigh。
 *
 * 测试路径走真实的 adapter.buildModels()（内部经 toPiModel → thinkingLevelMap），
 * 档位过滤逻辑按 dsh-llm-pi-ai 的 getSupportedThinkingLevels 逐行复刻
 * （该函数未导出，改动它时这里会先红）。
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

console.log('\nshigh 档位在 DSH 自带列表中的可见性');

/**
 * dsh-llm-pi-ai 的 getSupportedThinkingLevels 原样复刻（未导出）：
 *   - 档位映射为 null → 不可选
 *   - xhigh / max 只有在 map 里**显式出现**（非 undefined）才可选
 *   - 其余档位只要不是 null 就可选
 */
function dshVisibleLevels(model) {
  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (!model.reasoning) return ['off'];
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === 'xhigh' || level === 'max') return mapped !== undefined;
    return true;
  });
}

/** 用真实 adapter.buildModels() 产出 pi 模型描述符。 */
function buildPiModels(models) {
  const catalog = new mod.WorkBuddyCatalog();
  catalog.update(models);
  const adapter = mod.createWorkBuddyAdapter({
    shim: { baseUrl: () => 'http://127.0.0.1:1', token: () => 'test' },
    catalog,
  });
  return adapter.buildModels();
}

const MODEL = (id, efforts) => ({
  id,
  name: id,
  supportedEfforts: efforts,
  contextWindow: 200000,
  maxOutputTokens: 32000,
  supportsImages: false,
  multiplier: 0,
});

await t('上游 shigh：DSH 列表出现 xhigh（超高），且线上发 shigh', () => {
  const [pi] = buildPiModels([MODEL('hy4-preview', ['low', 'medium', 'high', 'shigh', 'max'])]);
  const visible = dshVisibleLevels(pi);
  assert.ok(visible.includes('xhigh'), `DSH 列表应含 xhigh，实际 ${JSON.stringify(visible)}`);
  assert.strictEqual(pi.thinkingLevelMap.xhigh, 'shigh', '选「超高」时线上应发 shigh');
  // 完整阶梯对齐 WorkBuddy 客户端的 5 档
  assert.deepStrictEqual(visible, ['low', 'medium', 'high', 'xhigh', 'max'],
    `应与客户端一致为 5 档，实际 ${JSON.stringify(visible)}`);
});

await t('上游真报 xhigh：仍用原值（不强行改写）', () => {
  const [pi] = buildPiModels([MODEL('m', ['low', 'high', 'xhigh', 'max'])]);
  assert.strictEqual(pi.thinkingLevelMap.xhigh, 'xhigh');
  assert.ok(dshVisibleLevels(pi).includes('xhigh'));
});

await t('上游既无 xhigh 也无 shigh：不出超高（不凭空造档）', () => {
  const [pi] = buildPiModels([MODEL('m', ['low', 'high', 'max'])]);
  assert.strictEqual(pi.thinkingLevelMap.xhigh, null);
  assert.ok(!dshVisibleLevels(pi).includes('xhigh'));
});

await t('without-shigh 的旧路径不回归：low/high 模型仍只有 low/high', () => {
  const [pi] = buildPiModels([MODEL('hy3', ['low', 'high'])]);
  assert.deepStrictEqual(dshVisibleLevels(pi), ['low', 'high']);
});

await t('无思考档位的模型：reasoning 关闭，列表只有 off', () => {
  const [pi] = buildPiModels([MODEL('plain', undefined)]);
  assert.strictEqual(pi.reasoning, false);
  assert.deepStrictEqual(dshVisibleLevels(pi), ['off']);
});

await t('Max 模式兜底仍取最强档 max（不因 shigh 别名受影响）', () => {
  const catalog = new mod.WorkBuddyCatalog();
  catalog.update([MODEL('hy4-preview', ['low', 'medium', 'high', 'shigh', 'max'])]);
  catalog.applySelection({ maxMode: true });
  assert.strictEqual(catalog.topEffortFor(catalog.find('hy4-preview')), 'max');
});

await t('shigh 模型的兜底档位校验：shigh 是合法线值，可被 defaultEffortFor 接受', () => {
  const catalog = new mod.WorkBuddyCatalog();
  catalog.update([MODEL('hy4-preview', ['low', 'medium', 'high', 'shigh', 'max'])]);
  // reasoningEfforts 存的是 DSH 档位名；xhigh 现在能映射到 shigh 线值
  catalog.applySelection({ reasoningEfforts: { 'hy4-preview': 'xhigh' } });
  // xhigh 不在该模型 supportedEfforts（线值表）里 → 被安全丢弃，不注入
  // （线上别名只活在 thinkingLevelMap，用户没选档位时 shim 的兜底走 defaultEffortFor）
  assert.strictEqual(catalog.defaultEffortFor(catalog.find('hy4-preview')), undefined,
    '保存的 xhigh 不是线值表成员，应被丢弃而不是照发');
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);