/**
 * 为 vendor/xdpool 准备 peer 依赖链接。
 *
 * 为什么需要：
 *   合并进来的 xdpool 代码是**上游原样**，import 写的是裸包名
 *   （如 @deepseek-ai/schemastery）。以 link: 方式开发时插件在 profile
 *   之外，向上找不到 node_modules，解析会失败。
 *
 * ── 为什么不是「一个 junction 指向某个 node_modules」 ──
 *
 * 原来就是这么做的，结果选错了源，插件一直有个隐蔽故障：
 *
 *   asVolatile(schema) 是 vendored 代码里的封装：
 *     typeof schema.volatile === 'function' ? schema.volatile() : schema
 *   而宿主 dsh-settings 用 volatileForm(schema) 决定一个条目要不要进
 *   settings 文档，只认 `schema.meta.volatile`。
 *
 *   只要 schemastery 没有 .volatile()，asVolatile 就退化成空操作，
 *   于是**整个条目被排除出 settings 文档**，账号池卡片写入无处可去 ——
 *   表现是「取消勾选 → 保存 → 又变回勾选」，且不报任何错。
 *
 * 实测版本差异：
 *   desktop profile 自带  schemastery 3.18.4  ← 有 .volatile()，与宿主一致
 *   共享区 profiles/node_modules 3.18.2        ← 没有 .volatile()（另一个全局 dsh 带进来的）
 *
 * 而「一个 junction」只能整体选一个源：desktop 缺 dsh-llm/dsh-settings，
 * 共享区四个都全 —— covers() 于是选了共享区，把 schemastery 一起带错了。
 *
 * ── 现在的做法：按包逐个选源 ──
 *
 *   1. 优先用插件所在 profile 自己的 node_modules（与宿主版本一致）
 *   2. 缺的包再去共享区补
 *   3. schemastery 额外要求「真的支持 .volatile()」，否则换下一个源
 *
 * 这样既补齐依赖，又不会把 schemastery 换成宿主不认识的那一份。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.resolve(HERE, '..', 'vendor', 'xdpool');
const LINK = path.join(VENDOR, 'node_modules');

/**
 * vendor/xdpool 真正 import 的裸包。
 *
 * 这份清单是从代码里**提取**出来的，不是手写的 ——
 * 手写清单曾经漏掉 @deepseek-ai/dsh-llm-pi-ai：
 * 按包逐个链接后那个包解析不到，vendored 模块直接 import 失败。
 * 提取命令见 test/link-vendor-test.mjs 里的注释。
 *
 * react 不在其中：它只出现在客户端代码里，而客户端是被内联进
 * lib/client.js 后由浏览器的模块加载器提供 react 的。
 */
const REQUIRED = [
  '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-llm-pi-ai',
  '@earendil-works/pi-ai',
];

/** schemastery 必须有 .volatile()，否则条目进不了 settings 文档 */
const VOLATILE_CRITICAL = '@deepseek-ai/schemastery';

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** 候选 node_modules，按优先级：插件所在 profile 最优先 */
function candidates() {
  const out = [];
  const home = dshHome();
  if (process.env.DSH_PROFILE_DIR) out.push(path.join(process.env.DSH_PROFILE_DIR, 'node_modules'));
  for (const p of ['desktop', 'web']) out.push(path.join(home, 'profiles', p, 'node_modules'));
  out.push(path.join(home, 'profiles', 'node_modules'));
  return out;
}

/**
 * 某份 schemastery 是否支持 .volatile()。
 *
 * 走子进程 + 动态 import 的探针，而不是在本进程里 require：
 * 那份 schemastery 可能是 ESM，require 会抛 ERR_REQUIRE_ESM，
 * 被 catch 吞掉后会被误判成「不支持」—— 实测踩过这个坑。
 */
function supportsVolatile(pkgDir) {
  try {
    const out = execFileSync(process.execPath, [path.join(HERE, 'probe-schemastery.mjs'), pkgDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'yes';
  } catch {
    return false;
  }
}

/** 逐个包找源：优先 profile，其次共享区；schemastery 还要过能力检查 */
function resolveSources() {
  const picked = {};
  const notes = [];
  const list = candidates();

  for (const pkg of REQUIRED) {
    let chosen = null;
    for (const nm of list) {
      const dir = path.join(nm, pkg);
      if (!fs.existsSync(dir)) continue;

      if (pkg === VOLATILE_CRITICAL && !supportsVolatile(dir)) {
        notes.push(`${pkg}: 跳过 ${nm}（该副本没有 .volatile()）`);
        continue;
      }
      chosen = { dir, from: nm };
      break;
    }
    if (chosen) {
      picked[pkg] = chosen;
      notes.push(`${pkg}: ${chosen.dir}`);
    } else {
      notes.push(`${pkg}: ✗ 没有可用来源`);
    }
  }
  return { picked, notes };
}

/** 当前链接是否已经可用：四个包都能解析，且 schemastery 过能力检查 */
function linkUsable() {
  for (const pkg of REQUIRED) {
    if (!fs.existsSync(path.join(LINK, pkg))) return false;
  }
  return supportsVolatile(path.join(LINK, VOLATILE_CRITICAL));
}

/**
 * Node 不靠链接能不能解析到**正确**的 peer 依赖？
 *
 * npm 安装时包在 <profile>/node_modules 下，向上就能找到，且那份与宿主同源
 * → 不需要链接（往 node_modules 里写东西反而会被重装清掉）。
 *
 * 注意：这里必须连 schemastery 的能力一起验，不能只看「能解析到」。
 * 之前只判断能解析，于是解析到旧版也当成功，问题被掩盖。
 */
function resolvesNaturally() {
  let schemasteryDir = null;
  try {
    const req = createRequire(path.join(VENDOR, 'lib', 'index.js'));
    for (const pkg of REQUIRED) req.resolve(pkg);
    schemasteryDir = path.dirname(req.resolve(VOLATILE_CRITICAL));
  } catch {
    return false;
  }
  return supportsVolatile(schemasteryDir);
}

/** 在 LINK 下为某个包建 junction（必要时先补齐 @scope 目录） */
function linkPackage(pkg, sourceDir) {
  const target = path.join(LINK, pkg);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    if (fs.existsSync(target) || fs.lstatSync(target)) fs.rmSync(target, { recursive: true, force: true });
  } catch {
    /* 清不掉就让 mklink 报错 */
  }
  execFileSync('cmd', ['/c', 'mklink', '/J', target, sourceDir], { stdio: 'pipe' });
}

export function linkVendorDeps(opts = {}) {
  const logger = opts.logger || console;
  if (!fs.existsSync(VENDOR)) return { ok: false, reason: 'vendor/xdpool 不存在' };

  if (resolvesNaturally()) return { ok: true, skipped: true, via: 'natural' };
  if (linkUsable()) return { ok: true, skipped: true, via: 'link' };

  // 清掉旧链接（可能是整目录 junction，也可能是过期的逐包链接）
  try {
    if (fs.existsSync(LINK) || fs.lstatSync(LINK)) fs.rmSync(LINK, { recursive: true, force: true });
  } catch {
    /* 继续，后面会报错 */
  }
  fs.mkdirSync(LINK, { recursive: true });

  const { picked, notes } = resolveSources();
  const failed = REQUIRED.filter((p) => !picked[p]);

  for (const pkg of REQUIRED) {
    if (!picked[pkg]) continue;
    try {
      linkPackage(pkg, picked[pkg].dir);
    } catch (e) {
      failed.push(pkg);
      notes.push(`${pkg}: 建链接失败 ${String((e.stderr || e.message) || '').toString().trim().slice(0, 80)}`);
    }
  }

  if (failed.length) {
    logger.warn?.(
      '[workbuddy-console] vendor/xdpool 依赖链接不完整，模型池可能不可用。\n  ' + notes.join('\n  '),
    );
    return { ok: false, reason: '有依赖未能链接', failed, notes };
  }

  // 关键自检：schemastery 必须真的支持 .volatile()，
  // 否则条目会静默地进不了 settings 文档（卡片写入失效）。
  if (!supportsVolatile(path.join(LINK, VOLATILE_CRITICAL))) {
    logger.warn?.(
      '[workbuddy-console] vendor/xdpool 的 schemastery 缺少 .volatile()：\n' +
        '  插件的设置条目将不会出现在 settings 文档里，账号池卡片的保存会静默失效。\n  ' +
        '  请确认插件所在 profile 的 node_modules 里有与宿主同版本的 @deepseek-ai/schemastery。',
    );
    return { ok: false, reason: 'schemastery 缺少 .volatile()', notes };
  }

  return { ok: true, notes, packages: Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, v.dir])) };
}

// 直接执行时：建链接并按结果设退出码
if (import.meta.url === 'file:///' + process.argv[1].replace(/\\/g, '/')) {
  const r = linkVendorDeps();
  if (r.ok) {
    if (r.skipped) {
      console.log('已就绪，跳过（' + r.via + '）');
    } else {
      console.log('✓ 已按包链接：');
      for (const n of r.notes) console.log('    ' + n);
    }
  } else {
    console.error('✗ ' + r.reason);
    if (r.notes) for (const n of r.notes) console.error('    ' + n);
    process.exit(1);
  }
}
