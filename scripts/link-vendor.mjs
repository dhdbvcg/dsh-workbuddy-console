/**
 * 建立 vendor/xdpool/node_modules 链接。
 *
 * 为什么需要：
 *   合并进来的 xdpool 代码是**上游原样**，它的 import 写的是裸包名
 *   （如 @deepseek-ai/schemastery）。Node 解析裸包名会从当前文件所在目录
 *   逐级向上找 node_modules —— vendor/xdpool 在插件源码目录下，
 *   那里本来没有任何 node_modules，于是解析失败。
 *
 *   我们不改上游代码（改了就没法对照升级），而是在它旁边放一个
 *   指向 DSH 依赖目录的链接，让解析自然走通。
 *
 * 用 junction 而非复制：省空间、单一事实源。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// 本文件是 ESM，没有全局 require —— 必须显式取 createRequire。
// （曾经在这里直接写 require(...)，它抛错又被 catch 吞掉，
//   导致「能否自然解析」的判断恒为 false，新逻辑形同虚设。）
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.resolve(HERE, '..', 'vendor', 'xdpool');
const LINK = path.join(VENDOR, 'node_modules');

/** xdpool 的 peerDependencies 至少要有一个能解析到 */
const REQUIRED = ['@deepseek-ai/schemastery', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-settings', '@earendil-works/pi-ai'];

function candidates() {
  const out = [];
  const home = os.homedir();
  const dshHome = process.env.DSH_HOME || path.join(home, '.dsh');
  if (process.env.DSH_PROFILE_DIR) out.push(path.join(process.env.DSH_PROFILE_DIR, 'node_modules'));
  for (const p of ['desktop', 'web']) out.push(path.join(dshHome, 'profiles', p, 'node_modules'));
  out.push(path.join(dshHome, 'profiles', 'node_modules'));
  return out;
}

/** 这个 node_modules 是否满足全部 peer 依赖 */
function covers(nm) {
  return REQUIRED.every((d) => fs.existsSync(path.join(nm, d)));
}

function alreadyOk() {
  return REQUIRED.every((d) => fs.existsSync(path.join(LINK, d)));
}

/**
 * Node 能不能**不靠链接**解析到 peer 依赖？
 *
 * 从 vendor 的实现文件出发用真实解析规则试一遍：
 *   - 以 link: 方式开发时，包在 profile 之外，向上找不到 node_modules → 需要链接
 *   - 以 npm 安装时，包在 <profile>/node_modules/ 下，向上就能找到 DSH 的依赖
 *     → 不需要链接（而且往 node_modules 里写东西会被重装清掉）
 *
 * 实测依据：scripts/verify-published.mjs 里把发布包放进模拟 profile 后，
 * 不建链接也能 import 成功。
 */
function resolvesNaturally() {
  try {
    const req = createRequire(path.join(VENDOR, 'lib', 'index.js'));
    // 只要有一个能解析到，就说明向上查找路径是通的
    req.resolve(REQUIRED[0]);
    return true;
  } catch {
    return false;
  }
}

export function linkVendorDeps(opts = {}) {
  const logger = opts.logger || console;
  if (!fs.existsSync(VENDOR)) return { ok: false, reason: 'vendor/xdpool 不存在' };

  // 优先信任 Node 自己的解析（npm 安装的场景）
  if (resolvesNaturally()) {
    return { ok: true, skipped: true, via: 'natural' };
  }
  if (alreadyOk()) return { ok: true, skipped: true, via: 'link' };

  // 已有残留（可能断的）先清掉
  try {
    if (fs.existsSync(LINK) || fs.lstatSync(LINK)) fs.rmSync(LINK, { recursive: true, force: true });
  } catch {
    /* 清不掉就继续，后面会失败并报错 */
  }

  const tried = [];
  for (const nm of candidates()) {
    if (!fs.existsSync(nm)) {
      tried.push(`${nm}（不存在）`);
      continue;
    }
    if (!covers(nm)) {
      const missing = REQUIRED.filter((d) => !fs.existsSync(path.join(nm, d)));
      tried.push(`${nm}（缺 ${missing.join(', ')}）`);
      continue;
    }
    try {
      // junction 不需要管理员权限
      execFileSync('cmd', ['/c', 'mklink', '/J', LINK, nm], { stdio: 'pipe' });
      if (alreadyOk()) return { ok: true, target: nm };
      tried.push(`${nm}（建立后仍不完整）`);
    } catch (e) {
      // 退回目录符号链接（跨卷时 junction 不可用）
      try {
        fs.symlinkSync(nm, LINK, 'junction');
        if (alreadyOk()) return { ok: true, target: nm, via: 'symlink' };
      } catch {
        /* 记下来试下一个 */
      }
      tried.push(`${nm}（${(e.stderr || e.message).toString().trim().slice(0, 80)}）`);
    }
  }

  logger.warn?.(
    '[workbuddy-console] 未能为 vendor/xdpool 建立依赖链接，模型池功能可能不可用。\n  试过：\n    ' +
      tried.join('\n    '),
  );
  return { ok: false, reason: '没有找到覆盖全部 peer 依赖的 node_modules', tried };
}

// 直接执行时：建链接并按结果设退出码
if (import.meta.url === 'file:///' + process.argv[1].replace(/\\/g, '/')) {
  const r = linkVendorDeps();
  if (r.ok) {
    console.log(r.skipped ? '已就绪，跳过' : `✓ 已链接到 ${r.target}${r.via ? '（' + r.via + '）' : ''}`);
  } else {
    console.error('✗ ' + r.reason);
    process.exit(1);
  }
}
