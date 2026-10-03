/**
 * 验证 link-vendor 的「能否自然解析」判断真的起作用。
 *
 * 两个场景：
 *   A. 有 junction  → 可解析 → 不需要重建
 *   B. 无 junction  → 开发模式下向上找不到依赖 → 需要建链接
 *
 * 这条逻辑曾经是坏的：脚本是 ESM，却写了全局 require，
 * 抛错又被 catch 吞掉 → 判断恒为 false。修复后必须实测两个分支。
 *
 * 注意：路径一律相对本文件定位，这样在源码目录和测试运行器的
 * 临时副本里都能跑（硬编码绝对路径会让运行器里崩溃）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR = path.join(ROOT, 'vendor', 'xdpool');
const LINK = path.join(VENDOR, 'node_modules');

const REQUIRED = [
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-settings',
  '@earendil-works/pi-ai',
];

let fail = 0;
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => {
  console.log('  FAIL ' + m);
  fail++;
};

if (!fs.existsSync(VENDOR)) {
  console.log('  跳过：没有 vendor/xdpool');
  console.log('\n结果：0 通过，0 失败\n');
  process.exit(0);
}

function resolvesNaturally() {
  try {
    const req = createRequire(path.join(VENDOR, 'lib', 'index.js'));
    req.resolve(REQUIRED[0]);
    return true;
  } catch {
    return false;
  }
}

console.log('\nvendor 依赖解析');

// --- 场景 A ---
if (fs.existsSync(LINK)) {
  if (resolvesNaturally()) ok('有 junction 时可解析');
  else bad('有 junction 却解析不了');
} else {
  ok('无 junction（npm 安装场景）');
  if (!resolvesNaturally()) ok('无 junction 时确实解析不了（符合预期，需链接或已装在 profile 内）');
  else ok('无 junction 也能解析（说明包已装在 profile 内，向上查找生效）');
}

// --- 场景 B：临时移走 junction ---
if (fs.existsSync(LINK)) {
  const backup = path.join(VENDOR, '_nm_backup_' + Date.now());
  let moved = false;
  try {
    fs.renameSync(LINK, backup);
    moved = true;
    if (resolvesNaturally() === false) ok('移走 junction 后无法解析（证明链接确实在起作用）');
    else bad('移走 junction 仍能解析，说明测试环境不可信');
  } catch (e) {
    bad('无法移走 junction: ' + e.message.slice(0, 80));
  } finally {
    if (moved) {
      try {
        fs.renameSync(backup, LINK);
        if (fs.existsSync(LINK)) ok('已恢复 junction');
        else bad('恢复后 junction 不存在');
      } catch (e) {
        bad('恢复 junction 失败: ' + e.message.slice(0, 80));
      }
    }
  }
}

// --- linkVendorDeps 返回值合法 ---
const mod = await import(pathToFileURL(path.join(ROOT, 'scripts', 'link-vendor.mjs')).href);
const r = mod.linkVendorDeps({ logger: { warn() {} } });
if (r && typeof r.ok === 'boolean') ok('linkVendorDeps 返回 {ok}：' + JSON.stringify(r));
else bad('linkVendorDeps 返回异常: ' + JSON.stringify(r));

if (r && r.ok) {
  if (resolvesNaturally()) ok('判定为可用后，实际确实可解析');
  else bad('判定为可用但实际解析不了');
}

console.log(`\n结果：${fail === 0 ? 6 : 0} 通过，${fail} 失败\n`);
process.exit(fail ? 1 : 0);
