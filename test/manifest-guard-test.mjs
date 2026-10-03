/**
 * 验证 check-manifest 真能抓到「YAML 里写 JS 注释」这个 bug。
 *
 * 抓不到的守卫等于没有 —— 所以这里故意写一份坏配置，跑检查，
 * 必须失败，然后恢复再确认通过。
 *
 * 路径一律相对本文件：这样在源码目录和测试运行器的临时副本里，
 * 改的都是**自己那份** cordis.patch.yml，不会动到源码。
 *
 * 曾经的真实故障：cordis.patch.yml 里用 "/** * /"（JS 块注释）当说明，
 * YAML 把它当内容，插件加载直接报 YAMLException，界面显示「异常」。
 * 当时 210 项测试全绿也没拦住 —— 没有任何测试解析过那个文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PATCH = path.join(ROOT, 'cordis.patch.yml');
const CHECK = path.join(ROOT, 'scripts', 'check-manifest.mjs');

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };

if (!fs.existsSync(PATCH) || !fs.existsSync(CHECK)) {
  console.log('  跳过：缺少 cordis.patch.yml 或 check-manifest.mjs');
  console.log('\n结果：0 通过，0 失败\n');
  process.exit(0);
}

const original = fs.readFileSync(PATCH, 'utf8');
const BROKEN = [
  '/**',
  ' * Register the plugin.',
  ' */',
  '- insert:',
  '    - id: workbuddy-console',
  '      name: dsh-workbuddy-console',
  '',
].join('\n');

function runCheck() {
  try {
    const out = execFileSync(process.execPath, [CHECK], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status === undefined ? 1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

try {
  // --- 1. 坏配置必须被抓到 ---
  fs.writeFileSync(PATCH, BROKEN);
  const r = runCheck();
  if (r.code !== 0) {
    ok('坏配置被检查拦下（退出码 ' + r.code + '）');
    if (/\/\*|\*\//.test(r.out)) ok('报错指出了 /* 或 */ 的问题');
    else bad('拦下了但没指出是 JS 注释语法');
    if (/解析失败|YAMLException|Implicit keys|separator is expected/i.test(r.out)) ok('报错包含 YAML 解析错误');
    else bad('没有 YAML 解析错误信息');
  } else {
    bad('坏配置竟然通过了 —— 守卫无效');
  }

  // --- 2. 另外几种坏法也要拦住 ---
  fs.writeFileSync(PATCH, '- insert:\n\t- id: x\n\t  name: y\n');
  const tab = runCheck();
  if (tab.code !== 0) ok('Tab 缩进被拦下');
  else bad('Tab 缩进没被拦下');

  fs.writeFileSync(PATCH, '- id: a\n  name: dsh-workbuddy-xdpool\n');
  const stale = runCheck();
  if (stale.code !== 0) ok('引用不存在的包名被拦下');
  else {
    bad('引用不存在的包名没被拦下');
    // 失败时把证据打出来，别让人再去手工复现
    console.log('      检查输出:\n' + String(stale.out).split('\n').map((l) => '      ' + l).join('\n'));
    console.log('      解析探针: dsh-workbuddy-xdpool -> ' + (() => {
      try {
        return createRequire(path.join(ROOT, 'package.json')).resolve('dsh-workbuddy-xdpool');
      } catch (e) {
        return '不可解析 (' + e.code + ')';
      }
    })());
    // 把 Node 实际会搜索的目录列出来 —— 直接回答"从哪解析到的"
    console.log('      搜索路径:');
    for (const d of createRequire(path.join(ROOT, 'package.json')).resolve.paths('dsh-workbuddy-xdpool') || []) {
      const hit = fs.existsSync(path.join(d, 'dsh-workbuddy-xdpool'));
      console.log('        ' + (hit ? '✓ ' : '  ') + d);
    }
  }

  fs.writeFileSync(PATCH, '- id: dup\n  name: dsh-workbuddy-console\n- id: dup\n  name: dsh-workbuddy-console\n');
  const dup = runCheck();
  if (dup.code !== 0) ok('重复 id 被拦下');
  else bad('重复 id 没被拦下');
} finally {
  // --- 3. 无论成败都要恢复 ---
  fs.writeFileSync(PATCH, original);
}

// --- 4. 恢复后必须通过 ---
const good = runCheck();
if (good.code === 0) ok('恢复后检查通过');
else bad('恢复后检查仍失败（源码可能被写坏）: ' + good.out.slice(-200));

const restored = fs.readFileSync(PATCH, 'utf8') === original;
if (restored) ok('cordis.patch.yml 已逐字节还原');
else bad('cordis.patch.yml 未还原！');

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
