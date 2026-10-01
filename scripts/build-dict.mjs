/**
 * 由 web/i18n.js 生成 web/i18n-dict.js。
 *
 * 为什么需要两步：
 *   同一个字典要同时给两个环境用 ——
 *     Node（测试里直接 import 检查 key 完整性）
 *     浏览器（<script> 直接加载，没有打包步骤）
 *   所以保留 i18n.js 作 ESM 源，生成一份挂 window 的产物。
 *
 * 用法：node scripts/build-dict.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'web', 'i18n.js');
const OUT = path.resolve(HERE, '..', 'web', 'i18n-dict.js');

let s = fs.readFileSync(SRC, 'utf8');

// 去掉 ESM 导出，改成普通声明 + 双环境出口
s = s.replace(/^export const STRINGS = /m, 'const STRINGS = ');
s = s.replace(/^export const LANGS = .*$/m, 'const LANGS = Object.keys(STRINGS);');

const footer = `
// —— 双环境出口 ——
// 浏览器：挂到 window，供 i18n-runtime.js 使用
// Node：CommonJS 导出，供测试脚本读取
if (typeof window !== 'undefined') window.WB_STRINGS = STRINGS;
if (typeof module !== 'undefined' && module.exports) module.exports = { STRINGS, LANGS };
`;

s = s.replace(/\s*$/, '\n') + footer;

fs.writeFileSync(OUT, s);
console.log('已生成 ' + path.relative(process.cwd(), OUT));
console.log('语言: ' + (s.match(/^\s{2}(zh|en):\s*\{/gm) || []).join(' '));
