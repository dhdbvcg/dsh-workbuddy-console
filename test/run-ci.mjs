/**
 * CI 环境跑全部测试：不需要 DSH profile、不需要真实凭证。
 *
 * 与 run-all.mjs 的区别：
 *   run-all.mjs 在**本机**跑，会把插件复制到 DSH profile 下以解析 xdpool，
 *   并读取真实的账号文件，验证的是「真的能用」。
 *   本脚本在**干净环境**（CI）跑，只验证不依赖外部状态的逻辑。
 *
 * 处理策略：
 *   - 直接在当前目录跑测试（不复制、不依赖 profile）
 *   - 依赖真实凭证/profile 的用例会自行跳过（测试内部已做判断）
 *   - 用环境变量 WB_CI=1 让测试知道「可以跳过」
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const TESTS = [
  ['selftest.mjs', '插件形状 / 路由 / 静态资源 / 代理 / 批量签到'],
  ['routes-test.mjs', '路由注册 / 页面元素 / 前端 URL 拼接'],
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
  ['mount-browser-test.mjs', '浏览器真实挂载 / 市场UI / 选择器按钮 / jsx 契约'],
  ['check-test.mjs', 'JWT / 凭证扫描 / 探活判定 / 体检 / 登录白名单'],
  ['tasks-test.mjs', '任务读取 / 状态归类 / 批量汇总'],
];

console.log(`CI 测试（${ROOT}）\n`);

let total = 0;
let failed = 0;
const rows = [];

for (const [file, desc] of TESTS) {
  const r = spawnSync(process.execPath, [path.join('test', file)], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, WB_CI: '1' },
  });
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
    console.log(`\n--- ${file} 输出 ---\n${out.slice(-2000)}`);
  }
}

console.log('\n结果汇总');
console.log('─'.repeat(70));
for (const [file, status, desc] of rows) {
  console.log(`${status.padEnd(16)} ${file.padEnd(24)} ${desc}`);
}
console.log('─'.repeat(70));
console.log(`总计：${total} 通过，${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
