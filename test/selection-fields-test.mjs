/**
 * 守卫：schema 里声明的每个 selection 字段，都必须真的被 saveSelection 写进设置。
 *
 * 踩过的坑（2026-10-04 加思考强度 / Max 模式时）：
 *   schema 加了 reasoningEfforts 与 maxMode，parseSelection 也校验了，
 *   前端也能改能保存 —— 但 saveSelection 是**手工逐字段构造 payload**的：
 *
 *     const payload = {
 *       ...enabledModelIds 走这一支,
 *       ...imageModelIds  走这一支,
 *       ...contextBudgets 走这一支
 *     };
 *
 *   新字段没人加那一行，于是被**静默丢弃**。表现是：界面能点、保存按钮会亮、
 *   不报任何错，但设置文档里根本没有那个值 —— 重开卡片又变回原样。
 *
 *   这类 bug 靠功能测试很难稳定抓到（要真跑一遍设置服务），
 *   所以这里直接把两边的字段名对齐：schema 里有、saveSelection 里没有 → 失败。
 *
 * 另外顺手守两件容易忘的事：
 *   - parseSelection 的校验分支必须覆盖同样的字段集
 *   - 卡片保存时必须带上同样的字段集
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR = path.join(ROOT, 'vendor', 'xdpool');

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };

const hostSrc = fs.readFileSync(path.join(VENDOR, 'lib', 'index.js'), 'utf8');
const clientSrc = fs.readFileSync(path.join(VENDOR, 'lib', 'client.js'), 'utf8');

console.log('\nselection 字段：schema → 校验 → 保存 三处必须一致');

const mod = await import(pathToFileURL(path.join(VENDOR, 'lib', 'index.js')).href);
const schemaFields = Object.keys(mod.Config.dict.modelSelectionCn.dict);
console.log('  schema 字段:', schemaFields.join(', '));

// —— 1) saveSelection 必须搬运每个字段 ——
// 取 saveSelection 的函数体，避免匹配到文件别处的同名字符串。
const saveStart = hostSrc.indexOf('saveSelection: async (region, selection) =>');
const saveEnd = hostSrc.indexOf('setAccountDisabled:', saveStart);
if (saveStart < 0 || saveEnd < 0) {
  bad('找不到 saveSelection 实现（源码结构变了？）');
} else {
  const saveBody = hostSrc.slice(saveStart, saveEnd);
  const missing = schemaFields.filter((f) => !saveBody.includes(`selection.${f}`));
  if (missing.length === 0) {
    ok(`saveSelection 搬运了全部 ${schemaFields.length} 个字段`);
  } else {
    bad(`saveSelection 漏搬字段：${missing.join(', ')} —— 这些值会被静默丢弃`);
  }
  // 只搬运校验过的字段：不该出现 schema 之外的键
  const known = new Set(schemaFields);
  const carried = [...saveBody.matchAll(/selection\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const unknown = [...new Set(carried)].filter((f) => !known.has(f));
  if (unknown.length === 0) ok('saveSelection 没有搬运 schema 之外的字段');
  else bad(`saveSelection 搬运了未声明/未校验的字段：${unknown.join(', ')}`);
}

// —— 2) parseSelection 必须校验每个字段 ——
// 字段可能以 body["x"] 或裸名出现，两种都认。
const parseStart = hostSrc.indexOf('function parseSelection(body) {');
const parseEnd = hostSrc.indexOf('\nfunction ', parseStart + 10);
if (parseStart < 0 || parseEnd < 0) {
  bad('找不到 parseSelection 实现');
} else {
  const parseBody = hostSrc.slice(parseStart, parseEnd);
  const missing = schemaFields.filter(
    (f) => !parseBody.includes(`"${f}"`) && !new RegExp(`\\b${f}\\b`).test(parseBody),
  );
  if (missing.length === 0) {
    ok(`parseSelection 覆盖了全部 ${schemaFields.length} 个字段`);
  } else {
    bad(`parseSelection 没有校验字段：${missing.join(', ')} —— 未校验的值会被写进设置`);
  }
}

// —— 3) 卡片保存时必须带上同样的字段 ——
const cardStart = clientSrc.indexOf('await write.call(settingsScope, key, {');
const cardEnd = clientSrc.indexOf('});', cardStart);
if (cardStart < 0) {
  bad('找不到卡片保存时的 write 调用');
} else {
  const cardBody = clientSrc.slice(cardStart, cardEnd);
  const missing = schemaFields.filter((f) => !cardBody.includes(f));
  if (missing.length === 0) {
    ok(`卡片保存时带上全部 ${schemaFields.length} 个字段`);
  } else {
    bad(`卡片保存时漏发字段：${missing.join(', ')} —— 用户改了但永远存不进去`);
  }
}

// —— 4) 卡片读回时也要读同样的字段，否则保存后界面不回显 ——
// enabledModelIds / imageModelIds 由 draft 的 enabled/images 承载，不要求逐字出现。
// maxMode 是**区域级**而非每模型级，所以它不进 draftFromStatus，
// 而是由 savedMaxMode 直接从 status.selection 读 —— 这是对的分工，单独验。
const draftStart = clientSrc.indexOf('function draftFromStatus(status) {');
const draftEnd = clientSrc.indexOf('function draftIsDirty', draftStart);
if (draftStart < 0 || draftEnd < 0) {
  bad('找不到 draftFromStatus');
} else {
  const draftBody = clientSrc.slice(draftStart, draftEnd);
  const perModel = schemaFields.filter((f) => !['enabledModelIds', 'imageModelIds', 'maxMode'].includes(f));
  const missing = perModel.filter((f) => !draftBody.includes(f));
  if (missing.length === 0) ok(`draftFromStatus 读回全部 ${perModel.length} 个「每模型」字段`);
  else bad(`draftFromStatus 没读回：${missing.join(', ')} —— 保存后界面不会回显`);
}

if (schemaFields.includes('maxMode')) {
  if (/savedMaxMode\s*=\s*status\?\.selection\?\.maxMode\s*===\s*true/.test(clientSrc)) {
    ok('maxMode 由 savedMaxMode 从 status.selection 直接读（区域级开关，不进每模型 draft）');
  } else {
    bad('maxMode 既不在 draftFromStatus 里、也没找到 savedMaxMode 读取路径 —— 开关状态无法回显');
  }
}

// —— 5) 新字段必须都是 volatile 作用域内的（由父级 modelSelectionCn 承载）——
const selVolatile = mod.Config.dict.modelSelectionCn.meta?.volatile === true;
if (selVolatile) ok('modelSelectionCn 整体是 volatile（设置改动能热更新到运行实例）');
else bad('modelSelectionCn 不是 volatile —— 设置改动不会生效');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);