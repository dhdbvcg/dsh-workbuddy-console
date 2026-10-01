/**
 * 账号体检 + 登录入口。
 *
 * 为什么不只看 expiresAt：
 *   upstream 撤销 token 时不会改写本地文件里的过期时间，
 *   所以一个「未过期」的快照 token 完全可能已经被上游拒绝。
 *   唯一可信的检查是真的发一次请求看上游认不认。
 *
 * 关于「自动登录」：
 *   WorkBuddy 的登录是交互式浏览器 OAuth（Keycloak），
 *   必须由人在浏览器里完成。这里只提供「跳到登录页」和「拉起桌面版」两个入口，
 *   绝不存储或代填账号密码。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

/** 上游计费/签到接口，用于探活（只读） */
const PROBE_PATH = '/v2/billing/meter/checkin-activity-status';

/** WorkBuddy 官方入口 */
export const LOGIN_URL = 'https://www.codebuddy.cn/work/';
export const ACCOUNT_URL = 'https://www.codebuddy.cn/profile/plan';

//#region 凭证文件发现

/**
 * 候选 auth 目录（与 xdpool 插件的 defaultDesktopAuthDirs 保持一致，
 * 避免两边看到的账号不一致）。
 */
export function authDirs(env = process.env, platform = process.platform, home = os.homedir()) {
  const dirs = [];
  const override = typeof env.WORKBUDDY_AUTH_FILE === 'string' && env.WORKBUDDY_AUTH_FILE.trim() !== '' ? env.WORKBUDDY_AUTH_FILE.trim() : '';
  if (override) {
    // 可能是文件也可能是目录
    try {
      const st = fs.statSync(override);
      dirs.push(st.isDirectory() ? override : path.dirname(override));
    } catch {
      dirs.push(override);
    }
  }
  if (platform === 'darwin') {
    dirs.push(path.join(home, 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth'));
  } else if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    dirs.push(path.join(local, 'CodeBuddyExtension', 'Data', 'Public', 'auth'));
    dirs.push(path.join(roaming, 'CodeBuddyExtension', 'Data', 'Public', 'auth'));
  } else {
    dirs.push(path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'CodeBuddyExtension', 'Data', 'Public', 'auth'));
  }
  return [...new Set(dirs)];
}

const LIVE_NAME = 'workbuddy-desktop.info';

/**
 * 扫描本机所有 WorkBuddy 凭证文件。
 *
 * 区分三类：
 *   live     —— workbuddy-desktop.info（桌面端当前正在用的）
 *   snapshot —— workbuddy-desktop.<时间戳>.<pid>.<uuid>.info（历史登录留下的）
 *   logout   —— workbuddy-desktop.info.logged-out（登出标记，本身没有 token）
 */
export function scanCredentialFiles(env = process.env) {
  const out = [];
  for (const dir of authDirs(env)) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    // 该目录是否存在登出标记
    const hasLogoutMarker = entries.includes(`${LIVE_NAME}.logged-out`);

    for (const name of entries) {
      if (!name.endsWith('.info')) continue;
      if (name === `${LIVE_NAME}.logged-out`) continue;
      const full = path.join(dir, name);

      let parsed = null;
      let error = null;
      try {
        parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch (e) {
        error = String(e.message || e).slice(0, 200);
      }

      const auth = (parsed && parsed.auth) || {};
      const account = (parsed && parsed.account) || {};

      out.push({
        path: full,
        dir,
        file: name,
        kind: name === LIVE_NAME ? 'live' : 'snapshot',
        hasLogoutMarker,
        parseError: error,
        uid: account.uid || null,
        nickname: account.nickname || null,
        uin: account.uin || null,
        phone: account.phoneNumber || null,
        type: account.type || null,
        domain: auth.domain || null,
        accessToken: auth.accessToken || '',
        refreshToken: auth.refreshToken || '',
        expiresAt: typeof auth.expiresAt === 'number' ? auth.expiresAt : null,
        lastRefreshTime: typeof auth.lastRefreshTime === 'number' ? auth.lastRefreshTime : null,
        mtimeMs: safeMtime(full),
      });
    }
  }
  return out;
}

function safeMtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

//#endregion

//#region Token 解析

/** 解 JWT payload；失败返回 null */
export function decodeJwt(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** token 的 exp（毫秒） */
export function tokenExpiryMs(token) {
  const p = decodeJwt(token);
  return p && typeof p.exp === 'number' ? p.exp * 1000 : null;
}

//#endregion

//#region 实时探活

/**
 * 真发一次上游请求验证 token 是否仍被接受。
 *
 * 判据：
 *   200 + code:0        → valid
 *   401 / 403           → invalid（上游不认这个 token 了）
 *   其它                → unknown（网络问题等，不能据此断言失效）
 *
 * @returns {Promise<{state:'valid'|'invalid'|'unknown', httpStatus:number|null, detail:string, status?:object}>}
 */
export async function probeCredential(cred, opts = {}) {
  const endpoint = (opts.endpoint || 'https://copilot.tencent.com').replace(/\/+$/, '');
  if (!cred.accessToken) {
    return { state: 'invalid', httpStatus: null, detail: '凭证文件里没有 accessToken' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const res = await fetch(endpoint + PROBE_PATH, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cred.accessToken}`,
        'X-User-Id': cred.uid || '',
        'User-Agent': 'WorkBuddy/5.4.7',
        'X-IDE-Type': 'WorkBuddy',
        'X-Product': 'WorkBuddy',
      },
      body: '{}',
    });
    const text = await res.text();

    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* 网关错误页通常不是 JSON */
    }

    if (res.status === 401 || res.status === 403) {
      return {
        state: 'invalid',
        httpStatus: res.status,
        detail: '上游拒绝了该 token（HTTP ' + res.status + '）——该账号需要重新登录',
      };
    }
    if (res.status === 200 && body && body.code === 0) {
      return { state: 'valid', httpStatus: 200, detail: '上游接受了该 token', status: body.data || null };
    }
    return {
      state: 'unknown',
      httpStatus: res.status,
      detail: `上游返回了非预期结果（HTTP ${res.status}${body && body.code !== undefined ? ', code=' + body.code : ''}）`,
    };
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return {
      state: 'unknown',
      httpStatus: null,
      detail: aborted ? '探活请求超时' : `网络错误：${e && e.message ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

//#endregion

//#region 汇总

/**
 * 体检：列出所有凭证文件，逐个实时探活，并按账号归并。
 *
 * 同一 uid 可能有多份凭证（live + 多个快照），保留「更新的那份」作为代表，
 * 但把全部来源路径都报出来，方便你判断该删哪个。
 */
export async function healthCheck(opts = {}) {
  const files = scanCredentialFiles(opts.env);
  const byUid = new Map();
  const unreadable = [];

  for (const f of files) {
    if (f.parseError || !f.accessToken) {
      unreadable.push({
        path: f.path,
        file: f.file,
        kind: f.kind,
        reason: f.parseError || '没有 accessToken',
      });
      continue;
    }
    if (!byUid.has(f.uid)) byUid.set(f.uid, []);
    byUid.get(f.uid).push(f);
  }

  const accounts = [];
  for (const [uid, creds] of byUid) {
    // 代表凭证：live 优先，其次 mtime 最新
    const sorted = [...creds].sort((a, b) => {
      if ((a.kind === 'live') !== (b.kind === 'live')) return a.kind === 'live' ? -1 : 1;
      return (b.mtimeMs || 0) - (a.mtimeMs || 0);
    });
    const primary = sorted[0];
    const probe = await probeCredential(primary, opts);

    accounts.push({
      uid,
      nickname: primary.nickname,
      uin: primary.uin,
      phone: primary.phone,
      domain: primary.domain,
      state: probe.state,
      detail: probe.detail,
      httpStatus: probe.httpStatus,
      expiresAt: primary.expiresAt ?? tokenExpiryMs(primary.accessToken),
      lastRefreshTime: primary.lastRefreshTime,
      // 来源信息 —— 用户判断的依据
      hasLiveFile: creds.some((c) => c.kind === 'live'),
      hasLogoutMarker: creds.some((c) => c.hasLogoutMarker),
      sources: sorted.map((c) => ({ kind: c.kind, file: c.file, path: c.path, mtimeMs: c.mtimeMs })),
      checkin: probe.status
        ? {
            active: !!probe.status.active,
            todayCheckedIn: !!probe.status.today_checked_in,
            streakDays: probe.status.streak_days ?? 0,
            todayCredit: probe.status.today_credit ?? 0,
          }
        : null,
    });
  }

  // 稳定排序：有效的在前，然后按昵称
  accounts.sort((a, b) => {
    const rank = { valid: 0, unknown: 1, invalid: 2 };
    const d = (rank[a.state] ?? 3) - (rank[b.state] ?? 3);
    if (d !== 0) return d;
    return String(a.nickname || a.uid).localeCompare(String(b.nickname || b.uid));
  });

  const summary = {
    total: accounts.length,
    valid: accounts.filter((a) => a.state === 'valid').length,
    invalid: accounts.filter((a) => a.state === 'invalid').length,
    unknown: accounts.filter((a) => a.state === 'unknown').length,
    hasLiveFile: accounts.some((a) => a.hasLiveFile),
    needsLogin: accounts.length === 0 || accounts.every((a) => a.state === 'invalid'),
  };

  return { ok: true, checkedAt: Date.now(), summary, accounts, unreadable };
}

//#endregion

//#region 登录入口

/**
 * 用系统默认浏览器打开一个 URL。
 *
 * 只允许打开白名单内的 WorkBuddy 域名，避免这个接口被当成任意 URL 跳板。
 */
export function openUrl(url) {
  const ALLOWED = ['www.codebuddy.cn', 'codebuddy.cn', 'www.workbuddy.cn', 'workbuddy.cn', 'www.codebuddy.ai', 'codebuddy.ai'];
  let u;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, error: '非法 URL' };
  }
  if (u.protocol !== 'https:') return { ok: false, error: '只允许 https' };
  if (!ALLOWED.includes(u.hostname)) return { ok: false, error: `域名不在白名单内：${u.hostname}` };

  try {
    const platform = process.platform;
    let child;
    if (platform === 'win32') {
      // 用 start 让系统默认浏览器处理；空 title 参数是 start 的必需占位
      child = spawn('cmd', ['/c', 'start', '', u.href], { detached: true, stdio: 'ignore', windowsHide: true });
    } else if (platform === 'darwin') {
      child = spawn('open', [u.href], { detached: true, stdio: 'ignore' });
    } else {
      child = spawn('xdg-open', [u.href], { detached: true, stdio: 'ignore' });
    }
    child.unref();
    return { ok: true, url: u.href };
  } catch (e) {
    return { ok: false, error: `无法打开浏览器：${e && e.message ? e.message : String(e)}` };
  }
}

/**
 * 拉起 WorkBuddy 桌面版。
 *
 * 为什么有用：桌面版重新登录后会写出新的 live 文件（workbuddy-desktop.info），
 * 插件重扫就能发现。这里不代填任何凭据，只是把 App 打开。
 */
export function launchDesktopApp(opts = {}) {
  const platform = process.platform;
  const candidates = [];

  if (platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    if (local) candidates.push(path.join(local, 'Programs', 'WorkBuddy', 'WorkBuddy.exe'));
    candidates.push('WorkBuddy.exe'); // 交给 PATH
  } else if (platform === 'darwin') {
    candidates.push('/Applications/WorkBuddy.app');
  } else {
    candidates.push('workbuddy');
  }

  for (const target of candidates) {
    if (target.endsWith('.exe') && !path.isAbsolute(target)) continue; // 相对的只是占位，跳过
    try {
      if (path.isAbsolute(target) && !fs.existsSync(target)) continue;
      const child = spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      return { ok: true, launched: target };
    } catch {
      /* 试下一个 */
    }
  }
  return {
    ok: false,
    error: '找不到 WorkBuddy 桌面版，请手动打开它，或直接用上面的「打开官网登录页」',
  };
}

//#endregion
