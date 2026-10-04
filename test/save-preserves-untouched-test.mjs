/**
 * 守卫：保存模型改动时，不能把用户**没碰过**的字段悄悄抹掉。
 *
 * 踩过的坑（2026-10-04）：
 *   卡片保存时写的是 `maxMode: maxModeDraft`，而 maxModeDraft 的语义是
 *   「undefined = 本次没碰过这个开关，请沿用已存的值」。
 *   于是用户只勾了一个模型、点保存 → payload 里maxMode 是 undefined
 *   → 宿主 parseSelection 跳过它 → saveSelection 也不写它
 *   → **设置文档里的 maxMode 被整体覆盖掉，Max 模式自己关掉了**。
 *
 *   同类字段还有 contextBudgets / reasoningEfforts：它们在卡片里是
 *   「从 status 重建整个对象」而不是「只发改动的」，所以是安全的；
 *   maxMode 当初只做了 draft 叠加，没有走同一条路。
 *
 * 为什么单独立一个测试：这类 bug 不会报错、界面看起来完全正常，
 * 只有「改了 A 结果 B 被重置」这种间接后果，功能测试很难断言。
 *
 * 这里做的是**静态契约检查**：卡片保存时写进 payload 的每个 selection 字段，
 * 其值来源必须是「草稿 ?? 已存值」这种合并表达式，而不是裸的 draft 变量。
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

const clientSrc = fs.readFileSync(path.join(VENDOR, 'lib', 'client.js'), 'utf8');
const mod = await import(pathToFileURL(path.join(VENDOR, 'lib', 'index.js')).href);
const schemaFields = Object.keys(mod.Config.dict.modelSelectionCn.dict);

console.log('\n保存模型改动不得抹掉未触碰的字段');

// 取出 saveModels 里的 payload 字面量
const writeStart = clientSrc.indexOf('await write.call(settingsScope, key, {');
const writeEnd = clientSrc.indexOf('});', writeStart);
if (writeStart < 0 || writeEnd < 0) {
  bad('找不到卡片保存时的 payload');
} else {
  // 先剥掉注释：字段上面那段解释性注释里含有 `}` 与中文标点，
  // 不剥掉的话截取范围会提前结束、字段名也会被注释干扰。
  const payload = clientSrc
    .slice(writeStart, writeEnd)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

  // 每个字段的值来源，逐个断言。
  // 两种写法都算「出现在 payload 里」：`key: value` 与 ES6 简写 `value,`
  for (const field of schemaFields) {
    const explicit = new RegExp(`\\b${field}\\s*:\\s*([^,\\n]+)`).exec(payload);
    // 末尾容许空白：payload 的截取刚好停在 `});` 之前，最后一个字段后面
    // 既没有逗号也没有花括号（切片的边界，不是源码的边界）。
    const shorthand = new RegExp(`(^|[{,\\s])${field}\\s*[,}\\s]`).test(payload);
    if (!explicit && !shorthand) { bad(`payload 里没有 ${field}`); continue; }
    if (!explicit) {
      // 简写形式：值就是同名的局部变量
      ok(`${field} 以简写形式写入（值来自同名变量，下面单独查它的来源）`);
      continue;
    }
    const value = explicit[1].trim();

    // 「从 status 重建整个对象」是安全的：未改动时它等于已存值
    if (/^(enabledModelIds|imageModelIds|contextBudgets|reasoningEfforts)$/.test(value)) {
      ok(`${field} 由当前 draft 整体重建（未改动时等于已存值，安全）`);
      continue;
    }
    // 其他字段必须走「草稿 ?? 已存值」的合并
    if (/\?\?/.test(value)) {
      ok(`${field} 用了「${value}」—— 未触碰时沿用已存值`);
      continue;
    }
    bad(
      `${field} 写的是裸的 \`${value}\`：用户没碰它时值是 undefined，` +
        '保存会把已存的设置抹掉。必须写成「draft ?? 已存值」的合并形式',
    );
  }
}

// —— 反向确认：maxMode 的合并来源真的存在 ——
const mergeLine = /const maxMode = maxModeDraft \?\? savedMaxMode;/.test(clientSrc);
if (mergeLine) ok('maxMode 已定义为「草稿 ?? 已存值」');
else bad('找不到 maxMode 的合并定义（maxMode = maxModeDraft ?? savedMaxMode）');

const savedFromStatus = /savedMaxMode = status\?\.selection\?\.maxMode === true/.test(clientSrc);
if (savedFromStatus) ok('savedMaxMode 从 status.selection.maxMode 读取');
else bad('找不到 savedMaxMode 的读取来源');

// —— 顺带守：discardModels / 保存成功后都要清掉 maxMode 草稿 ——
// 否则「放弃修改」之后保存按钮还会一直亮着。
for (const [where, label] of [['discardModels', '放弃修改'], ['setDraft(void 0);\n\t\t\t\t\t// Same after', '保存成功后']]) {
  const idx = clientSrc.indexOf(where);
  if (idx < 0) { bad(`找不到 ${label} 的位置`); continue; }
  const window = clientSrc.slice(idx, idx + 420);
  if (window.includes('setMaxModeByRegion')) ok(`${label} 时也清掉了 maxMode 草稿`);
  else bad(`${label} 时没清 maxMode 草稿 —— 开关状态会与已存值不一致`);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);