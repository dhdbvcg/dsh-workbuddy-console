/**
 * 校验两个语言包的 key 完全一致，且没有遗漏的占位符。
 * 漏翻的 key 会在界面上显示成原始 key，用户一眼就能看到。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'web', 'i18n.js');

// 用动态 import 读 ESM 源（权威版本），而不是生成的产物
const mod = await import('file:///' + SRC.replace(/\\/g, '/'));
const S = mod.STRINGS;

// 统计口径：以「检查项」为单位（不是每个 key 都算一项），
// 否则总数会被字典规模撑大，失去参考意义。
let checks = 0;
let failures = 0;

const zh = Object.keys(S.zh);
const en = Object.keys(S.en);

console.log(`zh: ${zh.length} key`);
console.log(`en: ${en.length} key`);

// 检查 1：key 对齐
checks++;
const missingInEn = zh.filter((k) => !(k in S.en));
const missingInZh = en.filter((k) => !(k in S.zh));

if (missingInEn.length) {
  console.log(`\n✗ en 缺少 ${missingInEn.length} 个 key:`);
  for (const k of missingInEn) console.log('    ' + k);
  failures += missingInEn.length;
}
if (missingInZh.length) {
  console.log(`\n✗ zh 缺少 ${missingInZh.length} 个 key:`);
  for (const k of missingInZh) console.log('    ' + k);
  failures += missingInZh.length;
}
if (!missingInEn.length && !missingInZh.length) console.log('\nkey 对齐: 两边一致');

// 检查 2：占位符一致
checks++;
let placeholderBad = 0;
for (const k of zh) {
  if (!(k in S.en)) continue;
  const vars = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
  const a = vars(S.zh[k]);
  const b = vars(S.en[k]);
  if (a !== b) {
    console.log(`  ✗ ${k}: zh[${a}] vs en[${b}]`);
    placeholderBad++;
  }
}
if (placeholderBad) failures += placeholderBad;
console.log(`占位符一致性: ${placeholderBad === 0 ? '全部一致' : placeholderBad + ' 处不一致'}`);

// 检查 3：无空值
checks++;
let empty = 0;
for (const lang of ['zh', 'en']) {
  for (const [k, v] of Object.entries(S[lang])) {
    if (typeof v !== 'string' || v.trim() === '') {
      console.log(`  ✗ ${lang}.${k} 为空`);
      empty++;
    }
  }
}
if (empty) failures += empty;
console.log(`空值检查: ${empty === 0 ? '无空值' : empty + ' 处为空'}`);

const passed = checks - failures;
console.log(`\n结果：${passed} 通过，${failures} 失败\n`);
process.exit(failures === 0 ? 0 : 1);
