/**
 * 把 vendor/xdpool/lib/client.js 的源码**直接内联**进 lib/client.js。
 *
 * 为什么内联而不是 import：
 *   本插件的客户端是 classic script（window.__ModuleLoader__.load 形态），
 *   宿主用 <script> 标签加载它。加顶层 import 会让它变成 ESM，
 *   宿主加载方式一变就可能整个 bundle 起不来 —— 这个坑踩过（空白页）。
 *   所以生成器直接把源码写成一个 const，走字符串注入执行。
 *
 * 用法：node scripts/gen-xdpool-client.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = ROOT + '/vendor/xdpool/lib/client.js';
const TARGET = ROOT + '/lib/client.js';

const BEGIN = '//#region BEGIN GENERATED: xdpool client source';
const END = '//#endregion GENERATED: xdpool client source';

if (!fs.existsSync(SRC)) {
  console.error('✗ 找不到 ' + SRC);
  process.exit(1);
}

const src = fs.readFileSync(SRC, 'utf8');
if (/<\/script/i.test(src)) {
  console.error('✗ vendored 源码含 </script，内联会被 HTML 截断。');
  process.exit(1);
}

const lines = fs.readFileSync(TARGET, 'utf8').split('\n');
const b = lines.findIndex((l) => l.includes(BEGIN));
const e = lines.findIndex((l) => l.includes(END));

const block = [
  BEGIN,
  '// 本块由 scripts/gen-xdpool-client.mjs 生成，请勿手改。',
  '// 内容：vendor/xdpool/lib/client.js（原样内联，MIT, (c) XDTrees — 上游 XDTrees/dsh-workbuddy-xdpool）',
  '// 用途：在本 bundle 内执行一次，捕获它 factory 的产物并转发 apply，',
  '//       这样账号池那张设置卡片就并入了本插件，无需改动上游代码。',
  'const XDPOOL_CLIENT_SRC = ' + JSON.stringify(src) + ';',
  END,
];

let out;
if (b >= 0 && e > b) {
  out = [...lines.slice(0, b), ...block, ...lines.slice(e + 1)];
  fs.writeFileSync(TARGET, out.join('\n'));
  console.log(`✓ 已更新 lib/client.js 中的内联块（${block.length} 行，源码 ${src.length} 字节）`);
} else {
  // 插到文件最前面（在文档注释之后、window.__ModuleLoader__ 之前）
  const insertAt = lines.findIndex((l) => l.startsWith('window.__ModuleLoader__'));
  if (insertAt < 0) {
    console.error('✗ 找不到插入点（window.__ModuleLoader__ 开头）');
    process.exit(1);
  }
  out = [...lines.slice(0, insertAt), ...block, '', ...lines.slice(insertAt)];
  fs.writeFileSync(TARGET, out.join('\n'));
  console.log(`✓ 已插入内联块到 lib/client.js（第 ${insertAt + 1} 行前，源码 ${src.length} 字节）`);
}
