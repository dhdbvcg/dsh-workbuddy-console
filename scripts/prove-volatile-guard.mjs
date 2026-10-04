/**
 * 证明「volatile 契约」守卫有效。
 *
 * 把 schemastery 链接换成共享区那份（3.18.2，没有 .volatile()），
 * 期望 volatile-schema-test 与 link-vendor-test 双双失败。
 *
 * 用 try/finally 保证任何情况下都复原 —— 上一版没做，中途失败把链接
 * 删掉没恢复，把自己搞坏了。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Users/dell/dsh-workbuddy-console';
const LINK = path.join(ROOT, 'vendor/xdpool/node_modules/@deepseek-ai/schemastery');
const BAD = 'C:/Users/dell/.dsh/profiles/node_modules/@deepseek-ai/schemastery';
const toWin = (p) => p.replace(/\//g, '\\');

function relink(target) {
  fs.rmSync(LINK, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(LINK), { recursive: true });
  execFileSync('cmd', ['/c', 'mklink', '/J', toWin(LINK), toWin(target)], { stdio: 'pipe' });
}

function runTest(file) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'test', file)], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const original = fs.readlinkSync(LINK);
console.log('当前链接 -> ' + original);

let caught = 0;
let afterCode = -1;
try {
  console.log('\n=== 换成「没有 .volatile()」的那份 ===');
  relink(BAD);
  console.log('  已指向 ' + BAD);

  for (const f of ['volatile-schema-test.mjs', 'link-vendor-test.mjs']) {
    const r = runTest(f);
    const fails = r.out.split('\n').filter((l) => l.includes('FAIL'));
    console.log('  ' + f + ': 退出码 ' + r.code + (fails.length ? '，失败项 ' + fails.length : ''));
    for (const l of fails.slice(0, 3)) console.log('      ' + l.trim());
    if (r.code !== 0) caught++;
  }
} finally {
  console.log('\n=== 复原（无论上面结果如何）===');
  relink(original);
  console.log('  已还原 -> ' + fs.readlinkSync(LINK));
  afterCode = runTest('volatile-schema-test.mjs').code;
  console.log('  复原后 volatile-schema-test 退出码: ' + afterCode);
}

console.log('\n=== 判定 ===');
console.log('  两个守卫都抓到问题: ' + (caught === 2 ? '是 ✓' : '否（只抓到 ' + caught + ' 个）'));
process.exit(caught === 2 && afterCode === 0 ? 0 : 1);
