#!/usr/bin/env node
/**
 * 一键安装脚本。
 *
 * 手工安装要改两个文件（package.json + cordis.patch.yml）并跑 pnpm install，
 * 任何一步出错都表现为「页面打不开」而看不出原因。这个脚本把整个流程自动化，
 * 并且主动避开两个已知的坑：
 *
 *   1. file: vs link:  —— file: 在 pnpm 下是拷贝语义，之后改代码不生效
 *   2. 重复注册        —— 反复运行不应产生重复的 insert 条目
 *
 * 用法：
 *   node scripts/install.mjs                 # 自动探测 profile
 *   node scripts/install.mjs --profile <dir> # 指定 profile
 *   node scripts/install.mjs --uninstall     # 卸载（移除配置，不动 node_modules）
 *   node scripts/install.mjs --dry-run       # 只显示将做什么
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linkVendorDeps } from './link-vendor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const PKG_NAME = 'dsh-workbuddy-console';
// 条目 id 必须是 llm-workbuddy-xdpool，不是包名：
// vendored 的账号池卡片用它精确匹配设置命名空间（forms.get(entryId)），
// 换成别的 id 卡片就变成只读。
const PLUGIN_ID = 'llm-workbuddy-xdpool';
// 旧版本（2.0.0~2.0.3）写入过 workbuddy-console 这个 id。
// 两个 id 指向同一个包 = DSH 加载两次 = 第二次注册 /wb-console 报
// "duplicate exact route"，两个条目一起失败。安装时要清掉。
const LEGACY_PLUGIN_IDS = ['workbuddy-console'];
// 合并前那个独立插件的包名；若 profile 里还留着指向它的条目，也要清掉（该包已卸载）
const OLD_PKG_NAME = 'dsh-workbuddy-xdpool';

//#region 输出

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
};
const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}!${C.reset} ${m}`);
const bad = (m) => console.log(`${C.red}✗${C.reset} ${m}`);
const info = (m) => console.log(`${C.dim}  ${m}${C.reset}`);
const step = (m) => console.log(`\n${C.bold}${m}${C.reset}`);

//#endregion

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const UNINSTALL = argv.includes('--uninstall');
const profileArg = argv.includes('--profile') ? argv[argv.indexOf('--profile') + 1] : null;

//#region profile 探测

/** 一个目录是不是有效的 DSH profile */
function looksLikeProfile(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  // 有 package.json 或 cordis.patch.yml 就算
  return (
    fs.existsSync(path.join(dir, 'package.json')) ||
    fs.existsSync(path.join(dir, 'cordis.patch.yml')) ||
    fs.existsSync(path.join(dir, 'cordis.yml'))
  );
}

function findProfiles() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const root = path.join(dshHome, 'profiles');
  if (!fs.existsSync(root)) return [];

  const out = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    if (fs.statSync(dir).isDirectory() && looksLikeProfile(dir)) {
      out.push({
        dir,
        name,
        hasXdpool: fs.existsSync(path.join(dir, 'node_modules', 'dsh-workbuddy-xdpool')),
      });
    }
  }
  // 装了 xdpool 的排前面 —— 那是本插件真正需要的
  out.sort((a, b) => Number(b.hasXdpool) - Number(a.hasXdpool));
  return out;
}

function resolveProfile() {
  if (profileArg) {
    if (!looksLikeProfile(profileArg)) {
      bad(`--profile 指定的目录不像 DSH profile: ${profileArg}`);
      process.exit(1);
    }
    return { dir: path.resolve(profileArg), name: path.basename(profileArg), hasXdpool: fs.existsSync(path.join(profileArg, 'node_modules', 'dsh-workbuddy-xdpool')) };
  }

  const found = findProfiles();
  if (found.length === 0) {
    bad('找不到任何 DSH profile。');
    info(`已查找: ${path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles')}`);
    info('用 --profile <目录> 手动指定。');
    process.exit(1);
  }
  if (found.length > 1) {
    warn(`发现 ${found.length} 个 profile，将安装到第一个（装了 xdpool 的优先）：`);
    for (const p of found) info(`${p.name}${p.hasXdpool ? '  ← 有 xdpool' : ''}`);
  }
  return found[0];
}

//#endregion

//#region 配置改写

/** 读 JSON，失败返回 null（不抛，交给调用方给可读提示） */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return e.code === 'ENOENT' ? {} : null;
  }
}

/**
 * 更新 package.json 的依赖。
 *
 * 关键：用 link: 而不是 file:。
 * file: 在 pnpm 下是拷贝语义，装完之后改源码不生效，且极难排查。
 */
function updatePackageJson(profile, { remove = false } = {}) {
  const file = path.join(profile.dir, 'package.json');
  const pkg = readJson(file);
  if (pkg === null) {
    bad(`package.json 解析失败: ${file}`);
    return { ok: false };
  }

  pkg.dependencies = pkg.dependencies || {};

  if (remove) {
    if (!(PKG_NAME in pkg.dependencies)) {
      info('package.json 里没有本插件，跳过');
      return { ok: true, changed: false };
    }
    delete pkg.dependencies[PKG_NAME];
    if (!DRY) fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    return { ok: true, changed: true, action: 'removed' };
  }

  // 用正斜杠，跨平台且 pnpm 认
  const target = 'link:' + PKG_DIR.replace(/\\/g, '/');
  const existing = pkg.dependencies[PKG_NAME];

  if (existing === target) {
    info(`依赖已是正确形式: ${target}`);
    return { ok: true, changed: false };
  }

  if (existing && existing.startsWith('file:')) {
    warn(`检测到旧的 file: 依赖（拷贝语义，会导致改动不生效），正在改为 link:`);
  }

  pkg.dependencies[PKG_NAME] = target;
  if (!DRY) fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  return { ok: true, changed: true, action: existing ? 'updated' : 'added', target };
}

/**
 * 在 cordis.patch.yml 里注册 / 注销插件。
 *
 * 幂等：已经在文件里就跳过，避免反复运行产生重复条目
 * （重复的 insert 会让 DSH 报路由冲突）。
 */
function updatePatch(profile, { remove = false } = {}) {
  const file = path.join(profile.dir, 'cordis.patch.yml');
  if (!fs.existsSync(file)) {
    bad(`找不到 cordis.patch.yml: ${file}`);
    return { ok: false };
  }

  const raw = fs.readFileSync(file, 'utf8');

  // 把文件切成「头部注释 + 若干条目块」，逐块处理后再拼回去。
  // 用块解析而不是行内正则：注释与缩进写法多变，正则很难覆盖全。
  const lines = raw.split(/\r?\n/);
  const head = [];
  const blocks = [];
  let cur = null;
  for (const l of lines) {
    const m = /^-\s*id:\s*(\S+)/.exec(l);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { id: m[1], lines: [l] };
    } else if (cur) {
      cur.lines.push(l);
    } else {
      head.push(l);
    }
  }
  if (cur) blocks.push(cur);

  const nameOf = (b) => {
    const m = /^\s*name:\s*(.+)$/m.exec(b.lines.join('\n'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  };

  // 指向「本插件」的条目：name 是本包名，或 id 是主/旧 id
  const isOurs = (b) => nameOf(b) === PKG_NAME || b.id === PLUGIN_ID || LEGACY_PLUGIN_IDS.includes(b.id);
  // 指向那个已被卸载的旧包的条目（合并前遗留），也要清掉，否则解析不到
  const isStaleOld = (b) => nameOf(b) === OLD_PKG_NAME;

  const before = blocks.map((b) => b.id);
  let kept = blocks.filter((b) => !isStaleOld(b));
  const removedStale = blocks.length - kept.length;

  if (remove) {
    const kept2 = kept.filter((b) => !isOurs(b));
    const removed = kept.length - kept2.length;
    if (removed === 0 && removedStale === 0) {
      info('cordis.patch.yml 里没有本插件，跳过');
      return { ok: true, changed: false };
    }
    const out = [...head, ...kept2.flatMap((b) => b.lines)].join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
    if (!DRY) fs.writeFileSync(file, out);
    return { ok: true, changed: true, action: 'removed', removed, removedStale };
  }

  // 安装：本插件只保留一个条目
  const ours = kept.filter(isOurs);
  const primary = ours.find((b) => b.id === PLUGIN_ID) || ours[0];
  const dropOurs = ours.filter((b) => b !== primary);

  if (primary) {
    // 已存在：确保 name 指向本包（旧版本可能写成别的）
    const nm = nameOf(primary);
    if (nm !== PKG_NAME) {
      primary.lines = primary.lines.map((l) => (/^\s*name:\s*/.test(l) ? `  name: ${PKG_NAME}` : l));
    }
  } else {
    kept.push({
      id: PLUGIN_ID,
      lines: [
        `- id: ${PLUGIN_ID}`,
        `  name: ${PKG_NAME}`,
      ],
    });
  }

  if (dropOurs.length) kept = kept.filter((b) => !dropOurs.includes(b));

  const changed =
    !primary ||
    dropOurs.length > 0 ||
    removedStale > 0 ||
    (primary && nameOf(primary) !== PKG_NAME);

  if (!changed) {
    info('cordis.patch.yml 已注册，跳过（幂等）');
    return { ok: true, changed: false };
  }

  const out = [...head, ...kept.flatMap((b) => b.lines)].join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';
  if (!DRY) fs.writeFileSync(file, out);
  return {
    ok: true,
    changed: true,
    action: primary ? 'updated' : 'added',
    deduped: dropOurs.map((b) => b.id),
    removedStale,
    before,
    after: kept.map((b) => b.id),
  };
}

//#endregion

//#region pnpm

function findNode() {
  // DSH 自带 runtime 优先（它就是跑插件的那个 node）
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const runtimeRoot = path.join(dshHome, 'dsh-runtimes');
  if (fs.existsSync(runtimeRoot)) {
    for (const r of fs.readdirSync(runtimeRoot)) {
      for (const sub of ['node/bin/node.exe', 'node/bin/node', 'node/node.exe']) {
        const p = path.join(runtimeRoot, r, 'dependencies', sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return process.execPath;
}

function findPnpm(nodePath) {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const runtimeRoot = path.join(dshHome, 'dsh-runtimes');
  if (fs.existsSync(runtimeRoot)) {
    for (const r of fs.readdirSync(runtimeRoot)) {
      for (const sub of ['pnpm/bin/pnpm.mjs', 'pnpm/bin/pnpm.cjs']) {
        const p = path.join(runtimeRoot, r, 'dependencies', sub);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

function runInstall(profile) {
  const node = findNode();
  const pnpm = findPnpm(node);

  if (!pnpm) {
    warn('找不到 DSH 自带的 pnpm，请手动在 profile 目录执行：');
    info(`cd "${profile.dir}" && pnpm install`);
    return false;
  }

  info(`node: ${node}`);
  info(`pnpm: ${pnpm}`);
  const r = spawnSync(node, [pnpm, 'install', '--ignore-scripts'], {
    cwd: profile.dir,
    stdio: 'inherit',
  });
  return r.status === 0;
}

//#endregion

//#region 校验

/** 确认装出来的东西是 junction 而不是拷贝 */
function verifyLink(profile) {
  const link = path.join(profile.dir, 'node_modules', PKG_NAME);
  if (!fs.existsSync(link)) return { ok: false, reason: '未安装到 node_modules' };

  const st = fs.lstatSync(link);
  if (st.isSymbolicLink()) {
    let target = null;
    try {
      target = fs.realpathSync(link);
    } catch {
      /* ignore */
    }
    return { ok: true, linked: true, target };
  }
  // 是真实目录 —— 检查内容是不是最新（比对 index.js 大小）
  return { ok: true, linked: false };
}

//#endregion

//#region 主流程

console.log(`${C.bold}${PKG_NAME} 安装器${C.reset}`);
if (DRY) warn('dry-run 模式：不会写入任何文件');

step('1. 定位 DSH profile');
const profile = resolveProfile();
ok(`profile: ${profile.dir}`);
// xdpool 已并入本仓库（vendor/xdpool），不再需要单独安装。
// 若 profile 里还留着旧的独立副本，提示一下但不必阻止安装。
if (profile.hasXdpool) {
  info('检测到独立的 dsh-workbuddy-xdpool —— 现在已并入本插件，可选卸载它：');
  info('  pnpm remove dsh-workbuddy-xdpool');
}

if (UNINSTALL) {
  step('2. 卸载');
  const p = updatePatch(profile, { remove: true });
  info(p.changed ? '已从 cordis.patch.yml 移除' : 'cordis.patch.yml 无变更');
  const j = updatePackageJson(profile, { remove: true });
  info(j.changed ? '已从 package.json 移除依赖' : 'package.json 无变更');
  console.log('\n完成。重启 DSH 生效。');
  console.log(`${C.dim}提示：node_modules 里的残留可手动删除，或再跑一次 pnpm install${C.reset}`);
  process.exit(0);
}

step('2. 注册插件到 cordis.patch.yml');
const patch = updatePatch(profile);
if (!patch.ok) process.exit(1);
ok(patch.changed ? `已${patch.action === 'added' ? '添加' : '移除'}注册条目` : '已是正确状态');

step('3. 写入依赖（用 link: 而非 file:）');
const pkg = updatePackageJson(profile);
if (!pkg.ok) process.exit(1);
ok(pkg.changed ? `已${pkg.action === 'added' ? '添加' : '更新'}依赖 → ${pkg.target}` : '依赖已正确');
if (pkg.target) info(`${C.dim}link:${C.reset} 让 pnpm 建 junction，改源码立即生效；file: 是拷贝，会读到旧代码`);

step('4. 安装依赖');
if (DRY) {
  info('[dry-run] 跳过 pnpm install');
} else {
  const done = runInstall(profile);
  if (!done) warn('pnpm install 未成功，请按上面的提示手动执行');
  else ok('依赖安装完成');
}

step('5. 校验');
if (DRY) {
  info('[dry-run] 跳过校验');
} else {
  const v = verifyLink(profile);
  if (!v.ok) {
    bad(v.reason);
  } else if (v.linked) {
    ok(`已链接到源码目录（junction）`);
    info(v.target || '');
  } else {
    warn('node_modules 里是拷贝而不是链接 —— 之后改源码不会生效');
    info('检查 pnpm 版本是否支持 file:/link: 语义，或手动建 junction');
  }

  // 合并进来的 xdpool 需要能解析它的 peer 依赖（源码目录本身没有 node_modules）
  const link = linkVendorDeps({ logger: { warn: (m) => warn(m) } });
  if (link.ok) {
    ok(link.skipped ? 'vendor 依赖链接已就绪' : `vendor 依赖已链接到 ${link.target}`);
  } else {
    warn('vendor 依赖链接失败 —— 模型池（provider）功能可能不可用');
    info('手动执行：node scripts/link-vendor.mjs');
  }
}

step('完成');
console.log(`  ${C.bold}重启 DSH${C.reset}，然后打开：`);
console.log(`  ${C.blue}http://127.0.0.1:<DSH端口>/wb-console${C.reset}`);
console.log(`\n${C.dim}诊断接口：/wb-console/api/diag${C.reset}`);
console.log(`${C.dim}卸载：node scripts/install.mjs --uninstall${C.reset}\n`);
