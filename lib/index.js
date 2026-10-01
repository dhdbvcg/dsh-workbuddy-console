/**
 * dsh-workbuddy-console — WorkBuddy 账号管理器（DSH 内置网页版）
 *
 * 为什么做成 DSH 插件而不是独立进程：
 *   独立进程需要手动启动，DSH 重启后 8787 就没了（"拒绝连接"）。
 *   本插件直接把自己的页面挂在 DSH 自己的 webServer 上，
 *   所以只要 DSH 在跑，页面就在，不需要任何手动启动。
 *
 * 它同时是 dsh-workbuddy-xdpool 的前端：
 *   - 账号数据、签到、积分、自动化、模型池都转发给插件（同进程，直接调用）
 *   - 补齐插件缺失的「一键全部签到」
 *
 * 路由（挂在 DSH 端口下）：
 *   GET  /wb-console              页面
 *   GET  /wb-console/app.js
 *   GET  /wb-console/style.css
 *   GET  /wb-console/api/mode
 *   GET  /wb-console/api/overview
 *   POST /wb-console/api/claim
 *   POST /wb-console/api/automation/run
 *   POST /wb-console/api/accounts/disabled
 *   POST /wb-console/api/accounts/rescan
 *   POST /wb-console/api/cooldowns/reset
 *   POST /wb-console/api/models/refresh
 *   GET  /wb-console/api/accounts/check     账号体检（逐个实时探活）
 *   POST /wb-console/api/login/open         打开官网登录页
 *   POST /wb-console/api/login/desktop      拉起 WorkBuddy 桌面版
 *
 * 关于「自动登录」：WorkBuddy 用交互式浏览器 OAuth，登录必须由人完成。
 * 本插件只提供登录入口，不存储、不代填任何账号密码。
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { healthCheck, openUrl, launchDesktopApp, LOGIN_URL, ACCOUNT_URL, scanCredentialFiles } from './account-check.mjs';
import { pendingTasks, claimTask } from './tasks.mjs';

export const name = 'workbuddy-console';
export const inject = ['webServer'];

/** 页面路径前缀 */
const BASE = '/wb-console';

/** 插件自己的 HTTP 路由（与 xdpool 同一进程，仍然走 HTTP 以便复用其鉴权/校验） */
const POOL = '/plugins/dsh-workbuddy-xdpool';

const PROXY_TIMEOUT_MS = 45000;
const CLAIM_GAP_MS = 700;

const HERE = dirname(fileURLToPath(import.meta.url));
/** 静态资源在包的 web/ 下（lib/ 的上一级） */
const WEB_DIR = join(HERE, '..', 'web');

//#region 工具

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function text(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * 给 handler 套一层「错误可见」包装。
 *
 * DSH 的 webServer 在 handler 抛异常时只回一个空的 400，
 * 异常内容进了 logger.warn，用户和我们都看不到 —— 这正是
 * 「页面打不开但不知道为啥」的根源。这里捕获后直接回可读的错误页。
 */
function guard(name, handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      const detail = e && e.stack ? e.stack : String(e);
      // 打到 DSH 日志，方便事后排查
      console.error(`[workbuddy-console] ${name} handler 失败: ${detail}`);
      if (res.headersSent) {
        try {
          res.destroy();
        } catch {
          /* 忽略 */
        }
        return;
      }
      try {
        const body = `<!doctype html><meta charset="utf-8"><h1>WorkBuddy 账号管理器内部错误</h1><p>路由：${name}</p><pre>${detail
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')}</pre>`;
        res.writeHead(500, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        });
        res.end(body);
      } catch {
        /* 连错误页都发不出去就只能放弃 */
      }
    }
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        const p = JSON.parse(raw);
        resolve(p && typeof p === 'object' && !Array.isArray(p) ? p : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 调 xdpool 插件的 HTTP 路由。
 * 关键：必须带 loopback Origin，否则插件以 403 origin-not-trusted 拒绝。
 */
async function callPool(port, name_, opts = {}) {
  const url = `http://127.0.0.1:${port}${POOL}/${name_}`;
  const method = opts.method || 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? PROXY_TIMEOUT_MS);
  try {
    const init = {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Origin: `http://127.0.0.1:${port}`,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/json' }),
      },
    };
    if (method !== 'GET') init.body = JSON.stringify(opts.body ?? {});
    const r = await fetch(url, init);
    const t = await r.text();
    let data = null;
    try {
      data = t ? JSON.parse(t) : null;
    } catch {
      return { ok: false, status: r.status, error: `插件返回非 JSON（HTTP ${r.status}）` };
    }
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: aborted ? `插件响应超时（${opts.timeoutMs ?? PROXY_TIMEOUT_MS}ms）` : `无法连接插件：${e && e.message ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

//#endregion

//#region 业务

/** 一键全部签到：插件只有单账号接口，这里串行遍历补齐批量能力 */
async function claimAll(port, accountIds) {
  const listRes = await callPool(port, 'status');
  if (!listRes.ok) {
    return { ok: false, error: listRes.error || `插件状态查询失败（HTTP ${listRes.status}）`, results: [] };
  }
  const accounts = Array.isArray(listRes.data?.accounts) ? listRes.data.accounts : [];
  let targets = accounts.filter((a) => !a.disabled);
  if (Array.isArray(accountIds) && accountIds.length) targets = targets.filter((a) => accountIds.includes(a.id));
  if (!targets.length) return { ok: false, error: '没有可签到的账号（可能全部被禁用）', results: [] };

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    const a = targets[i];
    const r = await callPool(port, 'checkin', { method: 'POST', body: { accountId: a.id } });
    if (!r.ok) {
      results.push({
        id: a.id,
        label: a.label,
        outcome: r.status === 409 ? 'inactive' : 'error',
        message: (r.data && r.data.error) || r.error || `HTTP ${r.status}`,
        credit: 0,
      });
    } else if (r.data && r.data.alreadyCheckedIn) {
      results.push({
        id: a.id,
        label: a.label,
        outcome: 'already',
        message: `今日已签到（连签 ${r.data.claim?.streakDays ?? 0} 天）`,
        credit: 0,
      });
    } else {
      const credit = r.data?.claim?.credit ?? 0;
      results.push({
        id: a.id,
        label: a.label,
        outcome: 'claimed',
        message: `签到成功 +${credit} 积分`,
        credit,
        streakDays: r.data?.claim?.streakDays ?? 0,
      });
    }
    if (i < targets.length - 1 && CLAIM_GAP_MS > 0) await new Promise((s) => setTimeout(s, CLAIM_GAP_MS));
  }

  const claimed = results.filter((x) => x.outcome === 'claimed');
  return {
    ok: true,
    results,
    summary: {
      total: results.length,
      claimed: claimed.length,
      already: results.filter((x) => x.outcome === 'already').length,
      failed: results.filter((x) => !['claimed', 'already'].includes(x.outcome)).length,
      totalCredit: claimed.reduce((s, x) => s + (x.credit || 0), 0),
    },
  };
}

/** 读取前端静态资源（随插件一起分发）
 *
 * 每次请求都重新读盘：改 HTML/CSS/JS 不用重载插件，刷新页面即可生效。
 * 只有 lib/ 里的后端代码改动才需要重启 DSH。
 */
function asset(file) {
  return readFileSync(join(WEB_DIR, file), 'utf8');
}

/**
 * 本机凭证 → 账号列表（每个 uid 取最新的一份）。
 *
 * 体检和任务读取共用这一个入口，避免两处口径不一致：
 * live 文件优先，其次 mtime 最新。
 */
function localAccounts() {
  const files = scanCredentialFiles();
  const byUid = new Map();
  for (const f of files) {
    if (!f.accessToken || !f.uid) continue;
    const prev = byUid.get(f.uid);
    const rank = (x) => (x.kind === 'live' ? 1 : 0);
    if (!prev || rank(f) > rank(prev) || (rank(f) === rank(prev) && (f.mtimeMs || 0) > (prev.mtimeMs || 0))) {
      byUid.set(f.uid, f);
    }
  }
  return [...byUid.values()].map((f) => ({
    uid: f.uid,
    nickname: f.nickname || f.uid,
    credential: {
      uid: f.uid,
      uin: f.uin,
      nickname: f.nickname,
      domain: f.domain,
      accessToken: f.accessToken,
      refreshToken: f.refreshToken,
    },
  }));
}

//#endregion

export function apply(ctx, config = {}) {
  const port = config.port ?? ctx.webServer.port;

  const routes = [];

  // —— 页面 ——
  // 同时注册带/不带尾斜杠两种形式：用户手打地址时两种都会用到，
  // 尾斜杠在浏览器里是最自然的输入（/wb-console/）。
  const pageHandler = (req, res) => {
    try {
      text(res, 200, asset('index.html'), 'text/html; charset=utf-8');
    } catch (e) {
      text(res, 500, '读取页面失败：' + (e && e.message ? e.message : String(e)), 'text/plain; charset=utf-8');
    }
  };
  routes.push(ctx.webServer.register({ kind: 'exact', path: BASE, handler: guard('page', pageHandler) }));
  routes.push(ctx.webServer.register({ kind: 'exact', path: `${BASE}/`, handler: guard('page', pageHandler) }));

  // —— 诊断路由 ——
  // 用 GET /wb-console/api/diag 查看静态资源读取、Content-Length 计算、
  // 以及各路 API 的真实状态。页面打不开时先看这个。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/diag`,
      handler: async (req, res) => {
        const WEB_FILES = ['index.html', 'app.js', 'style.css'];
        const assets = WEB_FILES.map((f) => {
          try {
            const body = asset(f);
            return {
              file: f,
              ok: true,
              bytes: Buffer.byteLength(body),
              // 这里如果和 bytes 不一致，Content-Length 就会写错
              jsLength: body.length,
            };
          } catch (e) {
            return { file: f, ok: false, error: e && e.message ? e.message : String(e) };
          }
        });
        json(res, 200, {
          ok: true,
          webDir: WEB_DIR,
          webDirExists: existsSync(WEB_DIR),
          assets,
          platform: process.platform,
          node: process.version,
        });
      },
    }),
  );
  const staticHandler = (file, type) => (req, res) => {
    try {
      text(res, 200, asset(file), type);
    } catch (e) {
      text(res, 500, '读取静态资源失败：' + (e && e.message ? e.message : String(e)), 'text/plain; charset=utf-8');
    }
  };
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/app.js`,
      handler: guard('app.js', staticHandler('app.js', 'text/javascript; charset=utf-8')),
    }),
  );
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/style.css`,
      handler: guard('style.css', staticHandler('style.css', 'text/css; charset=utf-8')),
    }),
  );

  // —— API ——

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/mode`,
      handler: async (req, res) => {
        const r = await callPool(port, 'status', { timeoutMs: 15000 });
        json(res, 200, {
          ok: true,
          mode: r.ok ? 'plugin' : 'offline',
          plugin: {
            online: r.ok,
            accountCount: r.ok && Array.isArray(r.data?.accounts) ? r.data.accounts.length : 0,
            error: r.ok ? null : r.error || `HTTP ${r.status}`,
          },
        });
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/overview`,
      handler: async (req, res) => {
        const r = await callPool(port, 'status', { timeoutMs: 60000 });
        if (!r.ok) return json(res, 502, { ok: false, mode: 'offline', error: r.error || `HTTP ${r.status}` });
        json(res, 200, { ok: true, mode: 'plugin', plugin: r.data });
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/claim`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = await readJsonBody(req);
          const ids = body.ids || body.uids;
          const out = await claimAll(port, Array.isArray(ids) && ids.length ? ids : undefined);
          json(res, out.ok ? 200 : 500, out);
        } catch (e) {
          json(res, 400, { ok: false, error: e.message });
        }
      },
    }),
  );

  /** 通用转发：POST 到 xdpool 的某个路由 */
  const forward = (routeName, path) => {
    routes.push(
      ctx.webServer.register({
        kind: 'exact',
        path: `${BASE}${path}`,
        handler: async (req, res) => {
          if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
          let body = {};
          try {
            body = await readJsonBody(req);
          } catch (e) {
            return json(res, 400, { ok: false, error: e.message });
          }
          const r = await callPool(port, routeName, { method: 'POST', body });
          if (!r.ok) return json(res, r.status || 500, { ok: false, error: r.error || r.data?.error || `HTTP ${r.status}` });
          json(res, 200, { ok: true, ...(r.data && typeof r.data === 'object' ? r.data : {}) });
        },
      }),
    );
  };

  forward('automation/run', '/api/automation/run');
  forward('accounts/disabled', '/api/accounts/disabled');
  forward('accounts/ignored', '/api/accounts/ignored');
  forward('accounts/credit-reserve', '/api/accounts/credit-reserve');
  forward('accounts/rescan', '/api/accounts/rescan');
  forward('cooldowns/reset', '/api/cooldowns/reset');
  forward('models/refresh', '/api/models/refresh');
  forward('models/save', '/api/models/save');

  // —— 未完成任务 ——
  //
  // 读每个账号的 growth 任务列表，挑出「未完成」和「可领取」两类。
  // 口径与 xdpool 插件的 parseTask 一致（复用插件导出的 client），
  // 所以这里显示的可领取数 == 插件自动化里看到的 claimableCount。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/tasks`,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x');
          const includeAll = url.searchParams.get('all') === '1';
          const accounts = localAccounts();

          if (accounts.length === 0) {
            return json(res, 200, {
              ok: true,
              accounts: [],
              totals: { accounts: 0, failed: 0, pendingTasks: 0, claimableTasks: 0, pendingCredit: 0, claimableCredit: 0 },
              note: '本机没有可用凭证',
            });
          }

          const out = await pendingTasks(accounts, { includeAll });
          json(res, 200, out);
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // —— 领取单个任务奖励 ——
  //
  // 只允许领取「本机凭证里存在的 uid」，避免这个接口被当成
  // 任意 taskCode 的转发器。taskCode 的合法性由上游判定。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/tasks/claim`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = await readJsonBody(req);
          const uid = typeof body.uid === 'string' ? body.uid : '';
          const taskCode = typeof body.taskCode === 'string' ? body.taskCode : '';
          if (!uid || !taskCode) return json(res, 400, { ok: false, error: '缺少 uid 或 taskCode' });

          const account = localAccounts().find((a) => a.uid === uid);
          if (!account) return json(res, 404, { ok: false, error: '账号不存在于本机凭证中' });

          const r = await claimTask(account.credential, taskCode);
          json(res, r.ok ? 200 : 500, r.ok ? { ...r, uid, taskCode } : r);
        } catch (e) {
          json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // —— 账号体检 ——
  //
  // 逐个账号真发一次上游请求，确认 token 是否仍被接受。
  // 不看 expiresAt：上游撤销 token 不会改写本地文件，所以「未过期」不代表还能用。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/accounts/check`,
      handler: async (req, res) => {
        try {
          const out = await healthCheck();
          json(res, 200, out);
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // —— 登录入口 ——
  //
  // 登录必须由人在浏览器里完成（交互式 OAuth），这里只负责把入口打开，
  // 不存储、不代填任何账号密码。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/login/open`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        let target = LOGIN_URL;
        try {
          const body = await readJsonBody(req);
          if (body.target === 'account') target = ACCOUNT_URL;
        } catch {
          /* 空 body 用默认地址 */
        }
        const r = openUrl(target);
        json(res, r.ok ? 200 : 500, { ...r, hint: '登录完成后回到本页点「重扫账号」' });
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/login/desktop`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        const r = launchDesktopApp();
        json(res, r.ok ? 200 : 500, { ...r, hint: '在桌面版里登录后，回到本页点「重扫账号」' });
      },
    }),
  );

  ctx.logger?.info?.(`[workbuddy-console] 已挂载: http://127.0.0.1:${port}${BASE}`);

  return () => {
    for (const dispose of routes) {
      try {
        dispose();
      } catch {
        /* 忽略重复释放 */
      }
    }
  };
}
