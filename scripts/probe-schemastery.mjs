/**
 * 探针：某份 @deepseek-ai/schemastery 是否支持 .volatile()。
 *
 *   node scripts/probe-schemastery.mjs <包目录>
 *   → 打印 yes / no
 *
 * 为什么单独放一个文件、用子进程跑：
 *   - 那份 schemastery 可能是 ESM，用 require() 会抛 ERR_REQUIRE_ESM，
 *     被 catch 吞掉后会被误判成「不支持」（踩过）。
 *   - 用动态 import 就与模块格式无关。
 *   写成文件而不是 -e 内联，是为了避开各 shell 的引号问题。
 */
const dir = process.argv[2];
if (!dir) {
  console.log('no');
  process.exit(0);
}

try {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const fs = await import('node:fs');
  const path = await import('node:path');

  let mod = null;

  // 先按 CommonJS 试（快）
  try {
    const req = createRequire(path.join(dir, 'noop.js'));
    mod = req(dir);
  } catch {
    /* 再按 ESM 试 */
  }

  if (!mod) {
    // 从 package.json 找入口
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    let rel = null;
    const e = pj.exports;
    if (typeof e === 'string') rel = e;
    else if (e && e['.']) rel = typeof e['.'] === 'string' ? e['.'] : (e['.'].import ?? e['.'].default ?? e['.'].require);
    if (!rel) rel = pj.module ?? pj.main ?? 'lib/index.js';
    mod = await import(pathToFileURL(path.join(dir, rel)).href);
  }

  const z = mod && typeof mod.string === 'function' ? mod : (mod && mod.default);
  if (!z || typeof z.string !== 'function') {
    console.log('no');
    process.exit(0);
  }
  const s = z.string();
  console.log(typeof s.volatile === 'function' ? 'yes' : 'no');
} catch {
  console.log('no');
}
