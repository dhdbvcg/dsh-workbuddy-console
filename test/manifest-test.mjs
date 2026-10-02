/**
 * 清单一致性自检。
 *
 * 为什么需要：曾经因为 package.json 声明了 dsh.client 但 exports 里
 * 没有 "./client"，导致 DSH **启动直接失败**（required plugin did not activate）。
 * 这类错误在运行前完全看不出来，只有启动崩了才知道。
 * 所以在 CI 里静态检查一遍。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message);
    fail++;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

console.log('\n入口');

t('main 指向存在的文件', () => {
  assert.ok(pkg.main, '缺少 main');
  assert.ok(fs.existsSync(path.join(ROOT, pkg.main)), 'main 不存在: ' + pkg.main);
});

t('files 包含 lib（否则发布后缺文件）', () => {
  assert.ok(Array.isArray(pkg.files), '缺少 files');
  assert.ok(pkg.files.includes('lib'), 'files 未包含 lib');
});

console.log('\ndsh.client 与 exports 一致性');

t('声明 dsh.client 时必须有 exports["./client"]', () => {
  const declares = !!(pkg.dsh && pkg.dsh.client);
  if (!declares) return; // 没声明就不需要
  const exp = pkg.exports && pkg.exports['./client'];
  assert.ok(exp, '声明了 dsh.client 但 exports["./client"] 缺失 —— DSH 启动会失败');
});

t('exports["./client"] 是字符串或含 string default 的对象', () => {
  const exp = pkg.exports && pkg.exports['./client'];
  if (!exp) return;
  if (typeof exp === 'string') return;
  assert.equal(typeof exp.default, 'string', 'exports["./client"] 形式不合法');
});

t('client bundle 文件真实存在', () => {
  const exp = pkg.exports && pkg.exports['./client'];
  if (!exp) return;
  const rel = typeof exp === 'string' ? exp : exp.default;
  assert.ok(fs.existsSync(path.join(ROOT, rel)), '客户端 bundle 不存在: ' + rel);
});

t('client bundle 使用 __ModuleLoader__.load 协议', () => {
  const exp = pkg.exports && pkg.exports['./client'];
  if (!exp) return;
  const rel = typeof exp === 'string' ? exp : exp.default;
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  assert.match(text, /__ModuleLoader__\.load/, 'bundle 未使用 DSH 的加载协议');
});

console.log('\ncordis patch');

t('patch 文件存在且被 files 收录', () => {
  const rel = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
  if (!rel) return;
  assert.ok(fs.existsSync(path.join(ROOT, rel)), 'patch 不存在: ' + rel);
  // bundle.patch 写作 "./cordis.patch.yml"，files 里是 "cordis.patch.yml" —— 要归一化再比
  const normalized = rel.replace(/^\.\//, '');
  assert.ok(
    pkg.files.some((f) => f.replace(/^\.\//, '') === normalized),
    `patch 未在 files 中（files=${JSON.stringify(pkg.files)}，patch=${rel}）`,
  );
});

t('patch 里注册的 name 与包名一致', () => {
  const rel = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch;
  if (!rel) return;
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  assert.match(text, new RegExp('name:\\s*' + pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'patch 里的 name 与包名不符');
});

console.log('\npeerDependencies 都有 meta 声明');

t('每个 optional peer 都在 peerDependenciesMeta 里标注', () => {
  const peers = Object.keys(pkg.peerDependencies || {});
  const meta = pkg.peerDependenciesMeta || {};
  for (const p of peers) {
    // 非 optional 的不强制
    if (meta[p]) assert.equal(meta[p].optional, true, `${p} 的 meta 应为 optional:true`);
  }
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
