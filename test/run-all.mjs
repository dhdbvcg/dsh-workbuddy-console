/**
 * 测试入口：在 DSH profile 目录下运行全部测试。
 *
 * 为什么要换目录：
 *   tasks.mjs 需要 import dsh-workbuddy-xdpool，而那个包只装在
 *   profile 的 node_modules 里。同时各测试文件用的是相对 import（../lib/...），
 *   所以必须「复制到 profile 下再跑」才能同时满足两边。
 *   这个脚本把这件事自动化，避免每次手工复制。
 *
 * 用法：node test/run-all.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.dirname(HERE);
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');

/** 找到一个装着 dsh-workbuddy-xdpool 的 profile 目录 */
function findProfile() {
  const candidates = [
    process.env.DSH_PROFILE_DIR,
    path.join(DSH_HOME, 'profiles', 'desktop'),
    path.join(DSH_HOME, 'profiles', 'web'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'node_modules', 'dsh-workbuddy-xdpool'))) return p;
  }
  return null;
}

const TESTS = [
  ['selftest.mjs', '插件形状 / 路由 / 静态资源 / 代理 / 批量签到'],
  ['check-test.mjs', 'JWT / 凭证扫描 / 探活判定 / 体检 / 登录白名单'],
  ['routes-test.mjs', '路由注册 / 页面元素 / 前端 URL 拼接'],
  ['tasks-test.mjs', '任务读取 / 状态归类 / 批量汇总'],
  ['tasks-route-test.mjs', '任务路由 / 领取入口 / 参数校验'],
  ['i18n-test.mjs', '中英字典 key 对齐 / 占位符一致性'],
  ['installer-test.mjs', '安装 / 卸载 / 幂等 / 保留他插件配置'],
  ['history-test.mjs', '签到历史 / 容错 / 聚合去重 / 裁剪'],
];

const profile = findProfile();
if (!profile) {
  console.error('找不到装有 dsh-workbuddy-xdpool 的 DSH profile。');
  console.error('请确认 dsh-workbuddy-xdpool 已安装，或设置 DSH_PROFILE_DIR。');
  process.exit(2);
}

console.log(`插件目录: ${PLUGIN_DIR}`);
console.log(`运行目录: ${profile}（为了解析 dsh-workbuddy-xdpool）\n`);

// 把 lib/ 和 web/ 复制到 profile 下，让相对 import（../lib/...）可用。
// 注意：测试文件在 <profile>/.wb-console-test/test/ 下，
// 所以 ../lib 解析到 <profile>/.wb-console-test/lib。
const linkDir = path.join(profile, '.wb-console-test');
fs.rmSync(linkDir, { recursive: true, force: true });
fs.mkdirSync(path.join(linkDir, 'test'), { recursive: true });
fs.mkdirSync(path.join(linkDir, 'lib'), { recursive: true });
fs.mkdirSync(path.join(linkDir, 'web'), { recursive: true });
for (const f of fs.readdirSync(path.join(PLUGIN_DIR, 'lib'))) {
  fs.copyFileSync(path.join(PLUGIN_DIR, 'lib', f), path.join(linkDir, 'lib', f));
}
for (const f of fs.readdirSync(path.join(PLUGIN_DIR, 'web'))) {
  fs.copyFileSync(path.join(PLUGIN_DIR, 'web', f), path.join(linkDir, 'web', f));
}
// package.json 也复制，保证插件以 ESM 解析
fs.copyFileSync(path.join(PLUGIN_DIR, 'package.json'), path.join(linkDir, 'package.json'));

// scripts/ 也要有 —— installer-test 通过 ../scripts/install.mjs 找它
fs.mkdirSync(path.join(linkDir, 'scripts'), { recursive: true });
for (const f of fs.readdirSync(path.join(PLUGIN_DIR, 'scripts'))) {
  fs.copyFileSync(path.join(PLUGIN_DIR, 'scripts', f), path.join(linkDir, 'scripts', f));
}

let total = 0;
let failed = 0;
const rows = [];

for (const [file, desc] of TESTS) {
  const src = path.join(HERE, file);
  if (!fs.existsSync(src)) {
    rows.push([file, '缺失', desc]);
    failed += 1;
    continue;
  }
  fs.writeFileSync(path.join(linkDir, 'test', file), fs.readFileSync(src));

  const r = spawnSync(process.execPath, [path.join('test', file)], { cwd: linkDir, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/结果：(\d+) 通过，(\d+) 失败/);
  if (m) {
    const p = Number(m[1]);
    const f = Number(m[2]);
    total += p;
    failed += f;
    rows.push([file, `${p} 通过${f ? `, ${f} 失败` : ''}`, desc]);
  } else {
    failed += 1;
    rows.push([file, '崩溃', desc]);
    console.log(`\n--- ${file} 输出 ---\n${out.slice(-1500)}`);
  }
}

fs.rmSync(linkDir, { recursive: true, force: true });

console.log('\n结果汇总');
console.log('─'.repeat(64));
for (const [file, status, desc] of rows) {
  console.log(`${status.padEnd(16)} ${file.padEnd(22)} ${desc}`);
}
console.log('─'.repeat(64));
console.log(`总计：${total} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
