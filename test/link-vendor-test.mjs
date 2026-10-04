/**
 * vendor 依赖链接的守卫。
 *
 * 这里真正要守的不是「能不能解析到」，而是**解析到的是哪一份**。
 *
 * 踩了很久的坑：整目录 junction 到共享区时，schemastery 是 3.18.2（没有
 * .volatile()），而宿主用的是 3.18.4。没有 .volatile() → vendored 的
 * asVolatile() 退化成空操作 → Config 里没有 volatile 字段 →
 * 宿主 volatileForm() 返回 undefined → **条目被排除出 settings 文档** →
 * 账号池卡片保存静默失效。
 *
 * 所以断言写成：「从 vendor 出发解析到的 schemastery 必须支持 .volatile()」。
 * 这一条与安装方式无关，npm 安装（向上查找）和 link: 开发（junction）都成立。
 *
 * 注意：不要再断言「移走链接就一定解析不到」——
 * 在 profile 目录下跑测试时，父级 node_modules 本来就能提供依赖，
 * 那条断言会误报（旧版本就是这么挂的）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR = path.join(ROOT, 'vendor', 'xdpool');
const LINK = path.join(VENDOR, 'node_modules');
const PROBE = path.join(ROOT, 'scripts', 'probe-schemastery.mjs');

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };

if (!fs.existsSync(VENDOR)) {
  console.log('  跳过：没有 vendor/xdpool');
  console.log('\n结果：0 通过，0 失败\n');
  process.exit(0);
}

console.log('\nvendor 依赖链接');

const SCHEMASTERY = '@deepseek-ai/schemastery';

/** 从 vendor 的实现文件出发，解析某个包 */
function resolveFromVendor(pkg) {
  try {
    return createRequire(path.join(VENDOR, 'lib', 'index.js')).resolve(pkg);
  } catch {
    return null;
  }
}

/** 该目录的 schemastery 支持 .volatile() 吗（子进程探针，兼容 ESM/CJS） */
function supportsVolatile(dir) {
  if (!dir) return false;
  try {
    const out = execFileSync(process.execPath, [PROBE, dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'yes';
  } catch {
    return false;
  }
}

// --- 1. 链接存在时：解析到的 schemastery 必须支持 .volatile() ---
if (fs.existsSync(LINK)) {
  ok('vendor/xdpool/node_modules 存在');
  const dir = resolveFromVendor(SCHEMASTERY);
  if (!dir) {
    bad('链接存在却解析不到 ' + SCHEMASTERY);
  } else {
    const pkgDir = dir.slice(0, dir.lastIndexOf(path.sep + 'lib'));
    if (supportsVolatile(pkgDir)) {
      ok('解析到的 schemastery 支持 .volatile()（' + pkgDir.replace(ROOT, '<repo>').slice(-60) + '）');
    } else {
      bad('解析到的 schemastery **不支持** .volatile() → 设置条目会被排除、卡片保存静默失效');
    }
  }
} else {
  ok('无 vendor 链接（npm 安装场景，依赖由 profile 向上提供）');
  const dir = resolveFromVendor(SCHEMASTERY);
  const pkgDir = dir ? dir.slice(0, dir.lastIndexOf(path.sep + 'lib')) : null;
  if (supportsVolatile(pkgDir)) ok('向上解析到的 schemastery 支持 .volatile()');
  else bad('向上解析到的 schemastery 不支持 .volatile()');
}

// --- 2. vendored 代码 import 的裸包，必须全部能解析 ---
// 这份清单是从代码里提取的，不是手写的 —— 手写曾经漏掉 dsh-llm-pi-ai。
console.log('\nvendored 依赖完整性');
const NEEDED = [
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-pi-ai',
];
for (const pkg of NEEDED) {
  const dir = resolveFromVendor(pkg);
  if (dir) ok(pkg);
  else bad(pkg + ' 解析不到（vendored 模块会 import 失败）');
}

// --- 3. linkVendorDeps 返回值合法，且判定为可用时确实可用 ---
const mod = await import(pathToFileURL(path.join(ROOT, 'scripts', 'link-vendor.mjs')).href);
const r = mod.linkVendorDeps({ logger: { warn() {} } });
if (r && typeof r.ok === 'boolean') ok('linkVendorDeps 返回 ' + JSON.stringify({ ok: r.ok, skipped: r.skipped, via: r.via }));
else bad('linkVendorDeps 返回异常: ' + JSON.stringify(r));

if (r && r.ok) {
  const dir = resolveFromVendor(SCHEMASTERY);
  const pkgDir = dir ? dir.slice(0, dir.lastIndexOf(path.sep + 'lib')) : null;
  if (supportsVolatile(pkgDir)) ok('判定可用后，schemastery 能力确实达标');
  else bad('判定为可用，但 schemastery 能力不达标');
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
