/**
 * 端到端验证「已发布的 npm 包」：
 *
 *   1. 从 registry 下载真实 tarball（绕过被污染的 DNS）
 *   2. 解包，检查结构完整（vendor、LICENSE-ORIGINAL、web、cordis.patch.yml）
 *   3. 放进 **模拟 profile 布局** 里 import 一次 —— 证明它不依赖我本机的
 *      vendor junction，能靠向上查找解决 peer 依赖
 *      （真实安装时包在 <profile>/node_modules/ 下，向上就能找到 DSH 的依赖）
 *
 * 为什么必须做：本地跑得通不代表发布出去的包跑得通。
 * junction 是本机产物、不会进 tarball，所以必须验证「没有 junction 也能用」。
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const IP = '104.16.4.34';
const HOST = 'registry.npmjs.org';

// 版本从 package.json 读 —— 写死会在每次发版后验错版本
const pkgJson = JSON.parse(fs.readFileSync(path.resolve(HERE, '..', 'package.json'), 'utf8'));
const VERSION = pkgJson.version;
const TARBALL = `/${pkgJson.name}/-/${pkgJson.name}-${VERSION}.tgz`;
const PROFILE = 'C:/Users/dell/.dsh/profiles/desktop';

console.log('验证版本: ' + pkgJson.name + '@' + VERSION);

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { console.log('  ✗ ' + m); fail++; };

// ---- 1. 下载 ----
// 刚发布的版本可能还在 npm 侧处理（CDN 尚未就绪，返回 404），所以重试几次
console.log('=== 1. 下载已发布的 tarball ===');
const tgz = path.join(os.tmpdir(), 'wb-published-' + Date.now() + '.tgz');

function fetchOnce() {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: IP, port: 443, path: TARBALL, method: 'GET', servername: HOST, headers: { host: HOST, 'cache-control': 'no-cache' }, timeout: 60000 },
      (res) => {
        if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

let buf = null;
let lastErr = null;
for (let attempt = 1; attempt <= 8; attempt++) {
  try {
    buf = await fetchOnce();
    break;
  } catch (e) {
    lastErr = e;
    if (attempt < 8) {
      console.log(`  第 ${attempt} 次失败（${e.message}），20s 后重试…`);
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}
if (!buf) {
  console.error('  ✗ 下载失败: ' + (lastErr && lastErr.message));
  console.error('    刚发布的包可能需要几分钟才在 CDN 可见，稍后重跑本脚本即可。');
  process.exit(1);
}
fs.writeFileSync(tgz, buf);
ok(`下载 ${(buf.length / 1024).toFixed(1)} KB`);

// ---- 2. 解包 + 结构检查 ----
console.log('\n=== 2. 解包并检查结构 ===');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pkg-'));
execFileSync('tar', ['-xzf', tgz, '-C', work], { stdio: 'pipe' });
const pkgDir = path.join(work, 'package');

const REQUIRED = [
  'package.json',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  'THIRD-PARTY.md',
  'lib/index.js',
  'lib/client.js',
  'lib/skill-market.mjs',
  'web/index.html',
  'web/app.js',
  'scripts/install.mjs',
  'vendor/xdpool/lib/index.js',
  'vendor/xdpool/lib/client.js',
  'vendor/xdpool/LICENSE-ORIGINAL',
];
for (const f of REQUIRED) {
  if (fs.existsSync(path.join(pkgDir, f))) ok(f);
  else bad('缺 ' + f);
}

// 不该出现的东西
for (const f of ['node_modules', 'test', 'lib/generated']) {
  if (fs.existsSync(path.join(pkgDir, f))) bad('不该包含 ' + f);
  else ok('不含 ' + f);
}

// LICENSE-ORIGINAL 内容正确吗（MIT 合并的硬性要求）
const lic = fs.readFileSync(path.join(pkgDir, 'vendor/xdpool/LICENSE-ORIGINAL'), 'utf8');
if (/XDTrees/.test(lic) && /MIT License/.test(lic)) ok('LICENSE-ORIGINAL 保留了 XDTrees 署名');
else bad('LICENSE-ORIGINAL 内容不对');

// cordis.patch.yml 必须能被 YAML 解析 —— 它是插件的注册入口，
// 一旦写坏，插件在 DSH 里直接「异常 / 无法使用」。
// 2.0.0~2.0.2 三个版本都带着坏掉的 YAML 发出去了，加这条就是为了拦住它。
console.log('\n=== cordis.patch.yml 可解析性 ===');
const patchText = fs.readFileSync(path.join(pkgDir, 'cordis.patch.yml'), 'utf8');
const codeOnly = patchText.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
if (/\/\*|\*\//.test(codeOnly)) bad('发布的 cordis.patch.yml 含 JS 注释语法（/* 或 */）');
else ok('未出现 JS 注释语法');

let yamlOk = false;
for (const cand of ['yaml', 'C:/Users/dell/.dsh/profiles/desktop']) {
  try {
    let yamlMod;
    if (cand === 'yaml') yamlMod = await import('yaml');
    else {
      const { createRequire } = await import('node:module');
      const req = createRequire(cand + '/noop.js');
      yamlMod = await import(pathToFileURL(req.resolve('yaml')).href);
    }
    const doc = yamlMod.parse(patchText);
    if (Array.isArray(doc)) {
      const ids = doc.flatMap((e) => (Array.isArray(e.insert) ? e.insert.map((x) => x.id) : [e.id])).filter(Boolean);
      ok(`YAML 解析成功，顶层数组，条目 id: ${ids.join(', ')}`);
      yamlOk = true;
    } else {
      bad('YAML 顶层不是数组');
    }
    break;
  } catch (e) {
    if (cand === 'yaml') continue; // 试下一个来源
    bad('YAML 解析失败: ' + String(e.message).split('\n')[0]);
  }
}
if (!yamlOk && !/解析失败/.test('')) {
  // 已在上面的分支里报过，这里不重复
}

// ---- 3. 模拟 profile 布局，验证裸依赖能解析 ----
console.log('\n=== 3. 模拟 profile 安装并 import ===');
const sim = path.join(PROFILE, '.wb-pkgtest');
fs.rmSync(sim, { recursive: true, force: true });
fs.mkdirSync(path.join(sim, 'node_modules'), { recursive: true });
const installed = path.join(sim, 'node_modules', 'dsh-workbuddy-console');
fs.cpSync(pkgDir, installed, { recursive: true });
console.log('  安装到: ' + installed.replace(PROFILE, '<profile>'));

// 关键：故意**不**建 vendor junction，验证向上查找能否解决依赖
if (fs.existsSync(path.join(installed, 'vendor/xdpool/node_modules'))) {
  bad('tarball 里竟带了 vendor node_modules');
} else {
  ok('vendor 下没有 junction（符合预期）');
}

let importOk = false;
try {
  const url = pathToFileURL(path.join(installed, 'lib/index.js')).href;
  const mod = await import(url);
  importOk = true;
  ok('import 成功，导出: ' + Object.keys(mod).join(', '));
} catch (e) {
  bad('import 失败: ' + (e.code || '') + ' ' + String(e.message).slice(0, 180));
}

// ---- 4. 客户端 bundle 也能读出来 ----
console.log('\n=== 4. 客户端 bundle 完整性 ===');
const client = fs.readFileSync(path.join(installed, 'lib/client.js'), 'utf8');
if (client.includes('__ModuleLoader__')) ok('含 ModuleLoader 自注册');
else bad('缺 ModuleLoader');
if (client.includes('XDPOOL_CLIENT_SRC')) ok('含账号池内联块（合并生效）');
else bad('缺账号池内联块');
if (client.includes('window.__ModuleLoader__.load') && !/^\s*import\s/m.test(client)) ok('是 classic script（无顶层 import）');
else bad('含顶层 import，宿主可能加载不了');

// ---- 清理 ----
console.log('\n=== 清理 ===');
fs.rmSync(sim, { recursive: true, force: true });
fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(tgz, { force: true });
ok('临时目录已清理');

console.log('\n' + (fail === 0 ? '✓ 已发布的包通过全部检查' : `✗ ${fail} 项未通过`));
process.exit(fail ? 1 : 0);
