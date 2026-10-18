/**
 * 把插件 vendor/xdpool/node_modules 里的宿主依赖，同步成**当前安装的 DSH** 的版本。
 *
 * 为什么需要这个脚本：
 *   vendored 的 xdpool 代码直接 import `@deepseek-ai/dsh-llm`、
 *   `@deepseek-ai/dsh-llm-pi-ai`、`@earendil-works/pi-ai` 等宿主内部包。
 *   DSH 升级后这些包的版本/布局会变，旧副本要么解析失败（入口变了），
 *   要么接口不匹配（例如 0.1.5 传 policy / 0.2.0 要 target）。
 *   而 profile 的 node_modules 会被 DSH 自己重装覆盖，改那里没用。
 *
 * 做法：从 app.asar 把需要的包解成**真实目录**放进插件的 vendor，
 *   然后反复尝试导入插件、把报错里缺的包继续从 asar 解出来，直到收敛。
 *   这样插件自足、与宿主同版本，且 DSH 再升级时重跑一次即可。
 *
 * 用法：
 *   node scripts/sync-vendor-deps.mjs            # 同步
 *   node scripts/sync-vendor-deps.mjs --verify   # 同步 + 验证能导入
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DSH_HOME = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
const PROFILE = process.env.DSH_PROFILE_DIR || path.join(DSH_HOME, 'profiles', 'desktop');

function locateAsar() {
  const candidates = [
    process.env.DSH_ASAR,
    path.join(process.env.LOCALAPPDATA || '', 'Programs/DeepSeek Harness/resources/app.asar'),
    path.join(process.env.PROGRAMFILES || '', 'DeepSeek Harness/resources/app.asar'),
  ].filter(Boolean);
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  throw new Error('找不到 DSH 的 app.asar（可用 DSH_ASAR 指定）');
}

/** 首批必须同步的包（其余靠依赖链自动发现） */
const NEED_PKGS = [
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/cordis',
  '@deepseek-ai/cosmokit',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-subprocess',
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-util-values',
  // 下面这些是 dsh-llm / pi-ai 依赖链上的宿主包。不预先装上的话，
  // 解析会落到 profile 里指向旧全局 npm 安装的 junction（那批副本已被清空，
  // 只剩没有 package.json 的空目录），从而报 "cannot find package .../index.js"。
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-timeout',
  '@deepseek-ai/dsh-launch-environment',
  '@deepseek-ai/dsh-attachment',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-util-crypto',
  'partial-json',
  'typebox',
  '@earendil-works/pi-ai',
];

function vendorRoots() {
  return [
    path.join(ROOT, 'vendor', 'xdpool', 'node_modules'),
    path.join(PROFILE, 'node_modules', 'dsh-workbuddy-console', 'vendor', 'xdpool', 'node_modules'),
  ].filter((p) => fs.existsSync(path.dirname(p)));
}

// ---- 打开 asar ----
const ASAR = locateAsar();
const fd = fs.openSync(ASAR, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(4);
const jsonSize = head.readUInt32LE(12);
const jb = Buffer.alloc(jsonSize);
fs.readSync(fd, jb, 0, jsonSize, 16);
const tree = JSON.parse(jb.toString('utf8'));
const dataOffset = 8 + headerSize;
const unpackedRoot = ASAR + '.unpacked';

function walk(node, prefix, out = []) {
  for (const [n, nd] of Object.entries(node.files || {})) {
    const p = prefix + '/' + n;
    if (nd.files) walk(nd, p, out);
    else out.push({ path: p, offset: Number(nd.offset), size: nd.size, unpacked: !!nd.unpacked });
  }
  return out;
}
const all = walk(tree, '');

function readEntry(f) {
  if (f.unpacked) return fs.readFileSync(path.join(unpackedRoot, f.path.replace(/^\//, '')));
  const b = Buffer.alloc(f.size);
  fs.readSync(fd, b, 0, f.size, dataOffset + f.offset);
  return b;
}

const asarVersion = (() => {
  const pj = all.find((f) => f.path === '/dsh/package.json');
  return pj ? JSON.parse(readEntry(pj).toString('utf8')).version : '?';
})();
console.log('宿主 asar: ' + ASAR);
console.log('DSH 版本: ' + asarVersion);

const roots = vendorRoots();
console.log('写入目标: ' + roots.map((r) => r.replace(process.env.USERPROFILE || '', '~')).join('  |  '));

/** asar 里是否有这个包 */
function inAsar(pkg) {
  return all.some((f) => f.path.startsWith('/dsh/node_modules/' + pkg + '/'));
}

/** 同步一个包到所有 vendor 根；返回写入份数 */
function syncPkg(pkg) {
  const base = '/dsh/node_modules/' + pkg + '/';
  const files = all.filter((f) => f.path.startsWith(base));
  if (!files.length) return 0;
  let n = 0;
  for (const root of roots) {
    const dest = path.join(root, pkg);
    try {
      const st = fs.lstatSync(dest);
      if (st.isSymbolicLink()) fs.unlinkSync(dest); // 只删链接本身
      else fs.rmSync(dest, { recursive: true, force: true });
    } catch { /* 不存在 */ }
    fs.mkdirSync(dest, { recursive: true });
    for (const f of files) {
      const rel = f.path.slice(base.length);
      if (!rel) continue;
      const target = path.join(dest, rel);
      if (!path.resolve(target).startsWith(path.resolve(dest))) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, readEntry(f));
    }
    n++;
  }
  const pj = files.find((f) => f.path === base + 'package.json');
  const ver = pj ? JSON.parse(readEntry(pj).toString('utf8')).version : '?';
  console.log('  ✓ ' + pkg + ' v' + ver + '（' + files.length + ' 文件）');
  return n;
}

let wrote = 0;
for (const pkg of NEED_PKGS) {
  const n = syncPkg(pkg);
  if (!n) console.log('  — ' + pkg + ' 不在 asar 里，跳过');
  else wrote += n;
}

// 清掉与宿主版本不一致的残留，避免新旧混杂
pruneStale();

// ---- 顺着依赖链自动补齐 ----
const ENTRY = path.join(PROFILE, 'node_modules', 'dsh-workbuddy-console', 'lib', 'index.js');
const REPO_ENTRY = path.join(ROOT, 'lib', 'index.js');

function missingPkg(msg) {
  // "Cannot find package 'X'" 里 X 有时是包名，有时是绝对路径（入口文件缺失时）
  const toPkg = (s) => {
    const norm = String(s).replace(/\\/g, '/');
    if (!norm.includes('/node_modules/')) return norm;
    const rest = norm.split('/node_modules/').pop().split('/');
    return rest[0].startsWith('@') ? rest.slice(0, 2).join('/') : rest[0];
  };
  let m = /Cannot find package '([^']+)'/.exec(msg);
  if (m) return toPkg(m[1]);
  m = /Cannot find module '([^']+)'/.exec(msg);
  if (m) return toPkg(m[1]);
  m = /does not provide an export named '[^']+'/.exec(msg);
  if (m) {
    const from = /from ['"]([^'"]+)['"]/.exec(msg);
    if (from) return toPkg(from[1]);
  }
  return null;
}

/** 清掉 vendor 里与当前宿主版本不一致的 @deepseek-ai/* 残留 */
function pruneStale() {
  const asarVer = (pkg) => {
    const pj = all.find((f) => f.path === '/dsh/node_modules/' + pkg + '/package.json');
    if (!pj) return null;
    try { return JSON.parse(readEntry(pj).toString('utf8')).version; } catch { return null; }
  };
  let removed = 0;
  for (const root of roots) {
    const dir = path.join(root, '@deepseek-ai');
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const pkg = '@deepseek-ai/' + name;
      const want = asarVer(pkg);
      if (want === null) continue; // asar 里没有 → 不动（可能是本地 vendor 包）
      const p = path.join(dir, name, 'package.json');
      let have = null;
      try { have = JSON.parse(fs.readFileSync(p, 'utf8')).version; } catch { have = null; }
      if (have === want) continue;
      try { fs.rmSync(path.join(dir, name), { recursive: true, force: true }); removed++; } catch { /* */ }
    }
  }
  if (removed) console.log('  · 清掉 ' + removed + ' 份旧版本残留');
}

/**
 * 用**子进程**跑一次导入，返回 { ok, msg }。
 *
 * 必须开新进程：Node 的 ESM 解析器会缓存 package.json 读取结果，
 * 在同一进程里重试拿到的仍是旧解析（实测会造成"补了包却还报同一个错"的假卡住）。
 */
function tryImport(entry) {
  const code =
    'import(' + JSON.stringify(pathToFileURL(entry).href + '?t=' + Date.now()) + ')' +
    '.then(m=>{console.log("OK "+m.name);},e=>{console.error("ERR "+(e&&(e.message||e)));process.exit(3)});';
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8',
    timeout: 180000,
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  if (r.status === 0 && /^OK /m.test(out)) return { ok: true, msg: out };
  const line = out.split('\n').find((l) => l.trim().startsWith('ERR ')) || out.split('\n')[0] || '';
  return { ok: false, msg: line.trim() };
}

function converge(entry, label) {
  const synced = new Set();
  for (let round = 1; round <= 80; round++) {
    const r = tryImport(entry);
    if (r.ok) {
      console.log('  ✓ ' + label + ' 导入成功（第 ' + round + ' 轮，共补 ' + synced.size + ' 个包）');
      return true;
    }
    const pkg = missingPkg(r.msg);
    if (!pkg) { console.log('  ✗ ' + label + ' 无法解析缺失包: ' + r.msg.slice(0, 150)); return false; }
    if (!inAsar(pkg)) { console.log('  ✗ ' + label + ' 缺 ' + pkg + '，但 asar 里没有'); return false; }
    if (synced.has(pkg)) { console.log('  ✗ ' + label + ' 补过 ' + pkg + ' 仍失败: ' + r.msg.slice(0, 150)); return false; }
    console.log('  + ' + label + ' 缺 ' + pkg + ' → 从 asar 补');
    const n = syncPkg(pkg);
    if (!n) { console.log('  ✗ ' + label + ' 写入失败: ' + pkg); return false; }
    synced.add(pkg);
  }
  console.log('  ✗ ' + label + ' 超过 80 轮未收敛');
  return false;
}

console.log('\n顺着依赖链补齐（已安装副本）…');
const ok1 = await converge(ENTRY, '已安装副本');
console.log('\n顺着依赖链补齐（仓库）…');
const ok2 = await converge(REPO_ENTRY, '仓库');

fs.closeSync(fd);
console.log('\n共写入 ' + wrote + ' 份包');
if (process.argv.includes('--verify') && (!ok1 || !ok2)) process.exit(1);
