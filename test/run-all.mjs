/**
 * 测试入口：在 DSH profile 目录下运行全部测试。
 *
 * 为什么要换目录：
 *   tasks.mjs 会 import 模型池实现（现在来自本仓库的 vendor/xdpool），
 *   而它依赖的 peer 包装在 profile 的 node_modules 里。
 *   同时各测试文件用的是相对 import（../lib/...），
 *   所以必须「复制到 profile 下再跑」才能同时满足两边。
 *   这个脚本把这件事自动化，避免每次手工复制。
 *
 * 用法：node test/run-all.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.dirname(HERE);
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const PKG_NAME = 'dsh-workbuddy-console';

/**
 * 找一个**装着本插件**的 profile 目录。
 *
 * 这里原先找的是 dsh-workbuddy-xdpool —— 那是合并之前的事。
 * 合并后本插件自带 vendor/xdpool，旧包已卸载，于是 desktop 不再匹配、
 * 直接退到了 web profile（那里还残留着旧包）。
 * 后果：测试跑在 web profile 下，Node 从那儿解析得到旧的 xdpool，
 * 让「引用不存在的包名」这条断言在特定环境下失效 —— 排查了很久。
 *
 * 现在改为匹配本插件自身，并优先信任 DSH_PROFILE_DIR。
 */
function findProfile() {
  const candidates = [
    process.env.DSH_PROFILE_DIR,
    path.join(DSH_HOME, 'profiles', 'desktop'),
    path.join(DSH_HOME, 'profiles', 'web'),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(path.join(p, 'node_modules', PKG_NAME))) return p;
  }

  // 兜底：本插件还没装进任何 profile 时，用第一个存在的（保证测试能跑）
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
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
  ['credit-test.mjs', '积分采集 / SSE 解析 / 流旁听透传'],
  ['credit-samples-test.mjs', '余额差值 / 消耗与入账分离 / 窗口过滤'],
  ['proxy-test.mjs', '计费代理 / 字节透传 / 白名单 / 错误透传'],
  ['manifest-test.mjs', 'package.json 与 DSH 加载协议一致性'],
  ['skill-market-test.mjs', '技能市场 / 路径安全 / frontmatter / 卸载'],
  ['client-bundle-test.mjs', '客户端 bundle / 插槽注册 / inject 覆盖'],
  ['link-vendor-test.mjs', 'vendor 依赖链接 / 自然解析判断'],
  ['volatile-schema-test.mjs', 'volatile 契约 / schemastery 能力 / settings 条目可写'],
  ['apply-idempotent-test.mjs', 'apply 幂等 / 重复注册路由 / 热重载'],
  ['model-availability-test.mjs', 'workbuddy 模型可用性 / 残留注册清理'],
  ['manifest-guard-test.mjs', 'YAML 守卫 / JS 注释误写 / 包名解析'],
  ['mount-browser-test.mjs', '浏览器真实挂载 / 市场UI / 选择器按钮 / jsx 契约'],
];

// 先重新生成内联块：vendor 里的账号池客户端源码要同步进 lib/client.js。
// 生成器幂等 —— 源码没变时是空操作，所以每次跑测试都顺手做一次，
// 避免 vendor 更新后忘了重新生成。
try {
  execFileSync(process.execPath, [path.join('scripts', 'gen-xdpool-client.mjs')], { stdio: 'pipe' });
} catch (e) {
  console.error('生成 xdpool 内联块失败：' + (e && (e.stderr || e.message)));
  process.exit(2);
}

const profile = findProfile();
if (!profile) {
  console.error('找不到 DSH profile。');
  console.error('请先安装本插件，或设置 DSH_PROFILE_DIR。');
  process.exit(2);
}

console.log(`插件目录: ${PLUGIN_DIR}`);
console.log(`运行目录: ${profile}（为了解析 vendor 的 peer 依赖）\n`);

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

// cordis.patch.yml 与 README 等根文件：manifest-test 会检查它们是否存在
// （漏拷会让测试报出「文件不存在」，那是测试环境的假阳性）
for (const f of ['cordis.patch.yml', 'README.md', 'README.en.md', 'LICENSE', 'CHANGELOG.md', 'THIRD-PARTY.md']) {
  const src = path.join(PLUGIN_DIR, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(linkDir, f));
}

// vendor/ 也要复制 —— 合并进来的 xdpool 实现由 lib/index.js 直接 import。
// 少了它，插件入口会因为找不到 ../vendor/xdpool/lib/index.js 而加载失败。
// node_modules 链接不复制（那是本机路径，测试环境用不到）。
if (fs.existsSync(path.join(PLUGIN_DIR, 'vendor'))) {
  fs.cpSync(path.join(PLUGIN_DIR, 'vendor'), path.join(linkDir, 'vendor'), {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}node_modules`),
  });
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

  const r = spawnSync(process.execPath, [path.join('test', file)], {
    cwd: linkDir,
    encoding: 'utf8',
    // 关键：把数据目录指到临时位置。
    // 否则像 credit-samples 这类测试会写进用户真实的 ~/.dsh ——
    // 之前就是这样污染了用户的余额历史（多了 11 条 uid=a 的假记录）。
    env: {
      ...process.env,
      WB_CONSOLE_DATA_DIR: path.join(linkDir, 'test-data'),
      WB_CONSOLE_HISTORY_DAYS: '7',
      WB_CI: process.env.WB_CI || '1',
    },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/结果：(\d+) 通过，(\d+) 失败/);
  if (m) {
    const p = Number(m[1]);
    const f = Number(m[2]);
    total += p;
    failed += f;
    rows.push([file, `${p} 通过${f ? `, ${f} 失败` : ''}`, desc]);
    // 有失败时也把输出打出来 —— 否则只看到 "N 失败"，还得手工复现
    if (f > 0) console.log(`\n--- ${file} 输出 ---\n${out.slice(-2500)}`);
  } else {
    failed += 1;
    rows.push([file, '崩溃', desc]);
    console.log(`\n--- ${file} 输出 ---\n${out.slice(-2500)}`);
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
