/**
 * npm 发布前自检。
 * 只检查、不发布 —— 发布是不可逆的对外动作，先看清楚再决定。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const pkg = JSON.parse(fs.readFileSync(ROOT + '/package.json', 'utf8'));

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

console.log('=== 包信息 ===');
console.log('  name    : ' + pkg.name);
console.log('  version : ' + pkg.version);
console.log('  license : ' + pkg.license);
console.log('  author  : ' + pkg.author);

console.log('\n=== 必填字段 ===');
for (const f of ['name', 'version', 'description', 'license', 'main', 'files']) {
  if (pkg[f]) ok(f); else bad('缺 ' + f);
}
if (pkg.private === true) bad('private: true 会挡住发布'); else ok('非 private');

console.log('\n=== 名称合法性（npm 规则）===');
if (/^[a-z0-9][a-z0-9._-]*$/.test(pkg.name) && pkg.name.length <= 214) ok('名称合法');
else bad('名称不合法: ' + pkg.name);

console.log('\n=== files 里声明的路径都存在吗 ===');
for (const f of pkg.files) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) ok(f); else bad(f + ' 不存在');
}

console.log('\n=== 入口与导出 ===');
for (const [k, v] of Object.entries(pkg.exports || {})) {
  const rel = typeof v === 'string' ? v : v.default;
  if (!rel) { ok(k + ' (条件导出)'); continue; }
  const p = path.join(ROOT, rel);
  if (fs.existsSync(p)) ok(k + ' -> ' + rel); else bad(k + ' -> ' + rel + ' 不存在');
}

console.log('\n=== 体积最大的文件（npm 会打包进 tarball）===');
function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.name === 'node_modules' || e.name === '.git') continue;
    if (e.isDirectory()) walk(p, out);
    else out.push({ p: path.relative(ROOT, p), size: fs.statSync(p).size });
  }
  return out;
}
const all = walk(ROOT).filter((f) => !/^(test|assets)[\\/]/.test(f.p));
const top = all.sort((a, b) => b.size - a.size).slice(0, 8);
for (const f of top) console.log('  ' + (f.size / 1024).toFixed(0).padStart(6) + ' KB  ' + f.p);
console.log('  ---- 合计约 ' + (all.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(1) + ' MB（含 test/ 会更大）');

console.log('\n=== 敏感信息扫描 ===');
// 注意：扫描脚本自身含这些模式的正则字面量，会把自检报成泄漏（踩过一次），
// 所以跳过本文件。
const SELF = 'scripts' + path.sep + 'prepublish-check.mjs';
const PATTERNS = [
  [/npm_[A-Za-z0-9]{20,}/, 'npm token'],
  [/ghp_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/eyJhbGciOiJSUzI1NiIsInR5cCI/, '疑似 JWT'],
  [/13735037775|19518078796/, '手机号'],
];
let leaked = 0;
for (const f of all) {
  if (/\.(png|jpg|ico|woff2?)$/i.test(f.p)) continue;
  if (f.p === SELF) continue;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, f.p), 'utf8'); } catch { continue; }
  for (const [re, label] of PATTERNS) {
    if (re.test(text)) { console.log('  ！ ' + f.p + ' 含 ' + label); leaked++; }
  }
}
if (leaked === 0) ok('未发现 token / 手机号 / JWT');
else bad(leaked + ' 处疑似敏感信息');

console.log('\n=== .npmignore / .gitignore 是否会把 vendor 排掉 ===');
for (const f of ['.npmignore']) {
  if (fs.existsSync(path.join(ROOT, f))) {
    const c = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/vendor/.test(c)) bad(f + ' 里排除了 vendor —— 合并后的模型池会缺实现');
    else ok(f + ' 未排除 vendor');
  } else ok('无 ' + f + '（用 package.json files 白名单，安全）');
}

console.log('\n=== 结论 ===');
if (fail === 0) console.log('  ✓ 可以发布');
else console.log('  ✗ 有 ' + fail + ' 项需先处理');
process.exit(fail ? 1 : 0);
