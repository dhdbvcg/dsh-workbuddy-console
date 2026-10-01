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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(HERE, '..');
const PKG_NAME = 'dsh-workbuddy-console';
const PLUGIN_ID = 'workbuddy-console';

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

  let text = fs.readFileSync(file, 'utf8');
  const hasEntry = new RegExp(`^\\s*-\\s*id:\\s*${PLUGIN_ID}\\s*$`, 'm').test(text);

  if (remove) {
    if (!hasEntry) {
      info('cordis.patch.yml 里没有本插件，跳过');
      return { ok: true, changed: false };
    }

    // 逐行删除整个块：可选的说明注释 + `- insert:` + id 行 + name 行。
    // 用行扫描而不是正则，因为注释可能有多行，正则很难覆盖全部写法
    // （之前用单行正则会把剩下的注释留在文件里）。
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const out = [];
    // 记录本次插入前、由我们写入的注释行，便于一起删除
    const OUR_COMMENT = /^#\s*(WorkBuddy 多账号控制台|WorkBuddy account console)/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*-\s*id:\s*workbuddy-console\s*$/.test(line)) {
        // 向上吃掉属于我们的注释行与 "- insert:" 行
        while (out.length) {
          const prev = out[out.length - 1];
          if (/^\s*-\s*insert:\s*$/.test(prev) || OUR_COMMENT.test(prev) || /^\s*#.*console/i.test(prev)) {
            out.pop();
            continue;
          }
          break;
        }
        // 吃掉紧随其后的 name 行
        if (i + 1 < lines.length && /^\s*name:\s*dsh-workbuddy-console\s*$/.test(lines[i + 1])) i++;
        // 吃掉紧接其后的空行，避免留下连续空行
        if (i + 1 < lines.length && lines[i + 1].trim() === '' && out.length && out[out.length - 1].trim() === '') {
          // 保留原有的空行结构即可
        }
        continue;
      }
      out.push(line);
    }

    // 折叠多余空行，并去掉文件末尾的空行（只保留一个换行）
    let next = out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n';

    if (!DRY) fs.writeFileSync(file, next);
    return { ok: true, changed: true, action: 'removed' };
  }

  if (hasEntry) {
    info('cordis.patch.yml 已注册，跳过（幂等）');
    return { ok: true, changed: false };
  }

  const block =
    `\n# WorkBuddy 多账号控制台：页面挂在 DSH 自己的 webServer 上，\n` +
    `# 所以 DSH 一启动就能访问 /wb-console，无需手动启动任何进程。\n` +
    `- insert:\n` +
    `    - id: ${PLUGIN_ID}\n` +
    `      name: ${PKG_NAME}\n`;

  const next = text.replace(/\s*$/, '\n') + block;
  if (!DRY) fs.writeFileSync(file, next);
  return { ok: true, changed: true, action: 'added' };
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
info(`xdpool: ${profile.hasXdpool ? '已安装 ✓' : '未安装（任务与模型池功能将不可用）'}`);

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

  if (!profile.hasXdpool) {
    warn('未检测到 dsh-workbuddy-xdpool —— 账号发现、签到、任务都依赖它');
    info('先安装它：https://github.com/XDTrees/dsh-workbuddy-xdpool');
  }
}

step('完成');
console.log(`  ${C.bold}重启 DSH${C.reset}，然后打开：`);
console.log(`  ${C.blue}http://127.0.0.1:<DSH端口>/wb-console${C.reset}`);
console.log(`\n${C.dim}诊断接口：/wb-console/api/diag${C.reset}`);
console.log(`${C.dim}卸载：node scripts/install.mjs --uninstall${C.reset}\n`);
