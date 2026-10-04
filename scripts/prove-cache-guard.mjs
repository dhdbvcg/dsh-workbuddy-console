/**
 * 证明「池状态短缓存」这条守卫有效：把 TTL 改成 0（等于关掉缓存），
 * 缓存测试必须失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Users/dell/dsh-workbuddy-console';
const LIB = path.join(ROOT, 'lib/index.js');
const original = fs.readFileSync(LIB, 'utf8');

const patched = original.replace(
  /const POOL_CACHE_TTL_MS = Number\(process\.env\.WB_POOL_CACHE_MS \|\| 5000\);/,
  'const POOL_CACHE_TTL_MS = 0; // 临时关闭，验证守卫',
);
if (patched === original) {
  console.error('✗ 替换失败，找不到 TTL 定义');
  process.exit(1);
}

function runSelftest() {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'test/selftest.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

let caught = false;
try {
  console.log('=== 临时关闭缓存（TTL=0）===');
  fs.writeFileSync(LIB, patched);
  const r = runSelftest();
  const fails = r.out.split('\n').filter((l) => l.includes('FAIL'));
  console.log('  退出码 ' + r.code + (fails.length ? '，失败项:' : ''));
  for (const l of fails) console.log('      ' + l.trim());
  caught = r.code !== 0;
} finally {
  console.log('\n=== 恢复 ===');
  fs.writeFileSync(LIB, original);
  const restored = fs.readFileSync(LIB, 'utf8') === original;
  console.log('  逐字节还原: ' + (restored ? '✓' : '✗'));
  const after = runSelftest();
  console.log('  恢复后 selftest 退出码: ' + after.code);
  console.log('\n结论: ' + (caught ? '守卫有效 ✓' : '守卫没抓到 ✗'));
  process.exit(caught ? 0 : 1);
}
