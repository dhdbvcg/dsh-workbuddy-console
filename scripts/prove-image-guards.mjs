/**
 * 证明图片尺寸相关的两条守卫都有效：
 *   A. 冻结 ref 不能抛（2.0.38 的事故）
 *   B. 非整数尺寸必须被换成整数（"Image request width..." 的根因）
 *
 * 做法：分别把代码改回错误版本，测试必须失败；然后逐字节还原。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Users/dell/dsh-workbuddy-console';
const LIB = path.join(ROOT, 'vendor/xdpool/lib/index.js');
const TEST = path.join(ROOT, 'test/image-size-normalize-test.mjs');
const original = fs.readFileSync(LIB, 'utf8');

function run() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [TEST], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const MUTATIONS = [
  {
    name: 'A. 把 readImageSize 改成会写回 ref（2.0.38 的做法）',
    make: (s) =>
      s.replace(
        '\t\treturn { width: Math.max(1, Math.floor(rawW)), height: Math.max(1, Math.floor(rawH)) };',
        '\t\tref.width = Math.max(1, Math.floor(rawW));\n\t\tref.height = Math.max(1, Math.floor(rawH));\n' +
          '\t\treturn { width: Math.max(1, Math.floor(rawW)), height: Math.max(1, Math.floor(rawH)) };',
      ),
  },
  {
    name: 'B. 让 normalizeImageBlock 不再换成整数（退回"只 Math.floor 判定"）',
    make: (s) =>
      s.replace(
        '\t\treturn { ...block, attachment: { ...ref, width: size.width, height: size.height } };',
        '\t\treturn block; // 故意不改：复现"我们看取整值、宿主看原始值"的错配',
      ),
  },
];

let allCaught = true;
for (const m of MUTATIONS) {
  const patched = m.make(original);
  if (patched === original) {
    console.log('✗ 注入失败（找不到锚点）: ' + m.name);
    allCaught = false;
    continue;
  }
  try {
    console.log('=== 注入: ' + m.name + ' ===');
    fs.writeFileSync(LIB, patched);
    const r = run();
    const fails = r.out.split('\n').filter((l) => l.includes('FAIL'));
    console.log('  退出码 ' + r.code + (fails.length ? '，失败项:' : ''));
    for (const l of fails.slice(0, 3)) console.log('      ' + l.trim());
    if (r.code === 0) { console.log('  ✗ 守卫没抓到'); allCaught = false; }
    else console.log('  ✓ 守卫抓到了');
  } finally {
    fs.writeFileSync(LIB, original);
  }
  console.log('');
}

console.log('=== 还原校验 ===');
const restored = fs.readFileSync(LIB, 'utf8') === original;
console.log('  逐字节还原: ' + (restored ? '✓' : '✗'));
const after = run();
console.log('  还原后退出码: ' + after.code);
console.log('\n结论: ' + (allCaught && restored && after.code === 0 ? '两条守卫都有效 ✓' : '有问题 ✗'));
process.exit(allCaught && restored && after.code === 0 ? 0 : 1);
