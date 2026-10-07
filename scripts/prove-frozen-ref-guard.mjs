/**
 * 证明「冻结 ref 不能抛」这条守卫有效：
 * 把代码改回会写回 ref.width 的版本，测试必须失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Users/dell/dsh-workbuddy-console';
const LIB = path.join(ROOT, 'vendor/xdpool/lib/index.js');
const original = fs.readFileSync(LIB, 'utf8');

// 在 readImageSize 的返回值之前插入一次写回（复现 2.0.38 的错误做法）
const marker = '\t\treturn { width: Math.max(1, Math.floor(rawW)), height: Math.max(1, Math.floor(rawH)) };';
if (!original.includes(marker)) {
  console.error('✗ 找不到插入点');
  process.exit(1);
}
const patched = original.replace(
  marker,
  '\t\tref.width = Math.max(1, Math.floor(rawW));\n' +
  '\t\tref.height = Math.max(1, Math.floor(rawH)); // 故意复现写回\n' +
  marker,
);

function run() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [path.join(ROOT, 'test/image-size-normalize-test.mjs')], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

let caught = false;
try {
  console.log('=== 临时改回「写回 ref」的做法 ===');
  fs.writeFileSync(LIB, patched);
  const r = run();
  const fails = r.out.split('\n').filter((l) => l.includes('FAIL') || l.includes('Cannot assign'));
  console.log('  退出码 ' + r.code);
  for (const l of fails.slice(0, 4)) console.log('      ' + l.trim());
  caught = r.code !== 0;
} finally {
  console.log('\n=== 恢复 ===');
  fs.writeFileSync(LIB, original);
  console.log('  逐字节还原: ' + (fs.readFileSync(LIB, 'utf8') === original ? '✓' : '✗'));
  const after = run();
  console.log('  恢复后退出码: ' + after.code);
  console.log('\n结论: ' + (caught ? '守卫有效 ✓' : '守卫没抓到 ✗'));
  process.exit(caught ? 0 : 1);
}
