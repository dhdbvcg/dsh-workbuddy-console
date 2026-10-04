/**
 * 守卫：vendored 的 Config 必须是「volatile 表单」，否则设置条目会被
 * 宿主静默排除，账号池卡片的保存无声失效。
 *
 * 背景（踩了很久的坑）：
 *   宿主 dsh-settings 决定一个条目要不要进 settings 文档时，会跑
 *
 *     function volatileForm(schema) {
 *       if (schema.meta.volatile) return plainSchema(schema);
 *       if (schema.type === "object") { ...只看 volatile 的子字段... }
 *       // 都不是 → undefined → 这个条目被丢掉
 *     }
 *
 *   而 vendored 的 Config 用 asVolatile() 包装字段：
 *
 *     function asVolatile(schema) {
 *       return typeof schema.volatile === "function" ? schema.volatile() : schema;
 *     }
 *
 *   只要插件解析到的 schemastery 没有 .volatile()，asVolatile 就退化成
 *   空操作 → 没有任何 volatile 字段 → 条目进不了 settings 文档 →
 *   账号池卡片拿不到可写作用域 → 「取消勾选 → 保存 → 又变回勾选」，
 *   **且不报任何错**。
 *
 *   实测：desktop profile 自带的 schemastery 3.18.4 有 .volatile()（与宿主一致），
 *   共享区那份 3.18.2 没有。所以 scripts/link-vendor.mjs 必须按包选源，
 *   不能整目录 junction 到共享区。
 *
 * 这个测试直接问「Config 的字段是不是 volatile」，比看版本号可靠
 * —— 同一个版本号在不同安装里完全可能是不同构建。
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR = path.join(ROOT, 'vendor', 'xdpool');

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };

if (!existsSync(VENDOR)) {
  console.log('  跳过：没有 vendor/xdpool');
  console.log('\n结果：0 通过，0 失败\n');
  process.exit(0);
}

console.log('\nvendored Config 的 volatile 契约');

// 1) 链接处的 schemastery 支持 .volatile() 吗
try {
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'probe-schemastery.mjs'), path.join(VENDOR, 'node_modules', '@deepseek-ai', 'schemastery')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  if (out.trim() === 'yes') ok('vendor 链接处的 schemastery 支持 .volatile()');
  else bad('vendor 链接处的 schemastery **不支持** .volatile() —— 设置条目会被排除');
} catch (e) {
  bad('无法检测 vendor 链接处的 schemastery: ' + String((e.stderr || e.message) || '').slice(0, 120));
}

// 2) vendored Config 的字段是否真的 volatile
let Config = null;
try {
  const mod = await import(pathToFileURL(path.join(VENDOR, 'lib', 'index.js')).href);
  Config = mod.Config;
  ok('vendored 模块可加载，导出 Config');
} catch (e) {
  bad('vendored 模块加载失败: ' + String(e.message).slice(0, 120));
}

if (Config) {
  const dict = Config.dict ?? {};
  const keys = Object.keys(dict);
  const volatileKeys = keys.filter((k) => dict[k]?.meta?.volatile === true);
  if (keys.length === 0) bad('Config 没有字段');
  else if (volatileKeys.length === 0) bad('Config 没有任何 volatile 字段 —— 条目会被宿主排除');
  else ok(`Config 有 ${volatileKeys.length}/${keys.length} 个 volatile 字段`);

  // 3) 直接模拟宿主的 volatileForm 判定
  function volatileForm(schema) {
    if (schema?.meta?.volatile) return { plain: true };
    if (schema?.type === 'object') {
      const d = Object.fromEntries(
        Object.entries(schema.dict ?? {}).flatMap(([k, c]) => {
          const f = volatileForm(c);
          return f === undefined ? [] : [[k, f]];
        }),
      );
      return Object.keys(d).length === 0 ? undefined : { keys: Object.keys(d) };
    }
    return undefined;
  }
  const form = volatileForm(Config);
  if (form === undefined) bad('模拟宿主判定：volatileForm(Config) = undefined（条目会被丢弃）');
  else ok('模拟宿主判定：volatileForm(Config) 生成表单，含 ' + (form.keys?.length ?? 1) + ' 个字段');

  // 4) 关键的几个字段必须在
  for (const key of ['modelSelectionCn', 'modelSelectionGlobal', 'distribution', 'disabledAccountIds']) {
    if (form !== undefined && form.keys?.includes(key)) ok('表单含 ' + key);
    else bad('表单缺 ' + key + '（卡片就写不了它）');
  }
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
