/**
 * 验证客户端 bundle 是否符合 dsh-client-modules 的要求。
 *
 * 之前的问题：package.json 声明了 dsh.client，但 exports 里没有 "./client"，
 * 导致 DSH 启动直接失败（required plugin did not activate）。
 * 这个脚本在安装前就能查出这类错误。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/dell/dsh-workbuddy-console';
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

let bad = 0;
function ok(msg) {
  console.log('  OK   ' + msg);
}
function fail(msg) {
  console.log('  FAIL ' + msg);
  bad++;
}

console.log('检查 dsh.client 与 exports 的一致性\n');

const declaresClient = !!(pkg.dsh && pkg.dsh.client);
const hasClientExport = !!(pkg.exports && pkg.exports['./client']);

if (!declaresClient) {
  ok('未声明 dsh.client —— 无需 ./client 导出');
  process.exit(0);
}

// 声明了就必须有导出（这正是 DSH 报的错）
if (hasClientExport) ok('声明了 dsh.client，且 exports["./client"] 存在');
else fail('声明了 dsh.client，但 exports["./client"] 缺失（DSH 会启动失败）');

// 导出值必须是字符串，或带 string default 的对象
if (hasClientExport) {
  const v = pkg.exports['./client'];
  if (typeof v === 'string') ok('exports["./client"] 是字符串');
  else if (v && typeof v.default === 'string') ok('exports["./client"] 是带 default 的对象');
  else fail('exports["./client"] 必须是字符串或含 string default 的对象');
}

// 文件必须真实存在
if (hasClientExport) {
  const rel = typeof pkg.exports['./client'] === 'string' ? pkg.exports['./client'] : pkg.exports['./client'].default;
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) {
    const size = fs.statSync(abs).size;
    ok(`客户端 bundle 存在（${rel}, ${size} bytes）`);

    // 内容必须是 __ModuleLoader__.load 形式
    const text = fs.readFileSync(abs, 'utf8');
    if (text.includes('__ModuleLoader__.load')) ok('bundle 使用 __ModuleLoader__.load 协议');
    else fail('bundle 未使用 __ModuleLoader__.load —— DSH 无法加载');

    if (/id:\s*['"]/.test(text)) ok('bundle 声明了模块 id');
    else fail('bundle 缺少 id');
  } else {
    fail(`客户端 bundle 文件不存在: ${abs}`);
  }
}

// files 字段必须包含 lib（否则发包后缺文件）
if (Array.isArray(pkg.files) && pkg.files.includes('lib')) ok('files 包含 lib');
else fail('files 未包含 lib —— 发布后会缺文件');

// main 也要存在
const mainAbs = path.join(ROOT, pkg.main || '');
if (pkg.main && fs.existsSync(mainAbs)) ok('main 入口存在');
else fail('main 入口不存在: ' + pkg.main);

console.log(bad === 0 ? '\n通过：package.json 与 DSH 客户端加载协议一致' : `\n${bad} 项不通过`);
process.exit(bad === 0 ? 0 : 1);
