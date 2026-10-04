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
import * as history from './history.mjs';
import { getCredit, allCredits, stats as creditStats } from './credit-meter.mjs';
import { startBillingProxy } from './billing-proxy.mjs';
import * as samples from './credit-samples.mjs';
import * as skillMarket from './skill-market.mjs';
// 并入的模型池实现（原 dsh-workbuddy-xdpool，MIT，(c) XDTrees）。
// 见 vendor/xdpool/README.md —— 代码原样保留，便于与上游对照升级。
import * as xdpoolModule from '../vendor/xdpool/lib/index.js';

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

/**
 * 挑一个凭证用于调用上游（技能市场等只需要一个账号）。
 *
 * 优先用有 live 文件的账号；否则用第一个。
 * 返回 { accessToken, uid, endpoint }——注意这不是完整的 credential 对象，
 * 只带单次请求需要的字段。
 */
function pickAuthAccount() {
  const accounts = localAccounts();
  if (accounts.length === 0) return null;
  const files = scanCredentialFiles();
  const live = files.find((f) => f.kind === 'live' && f.accessToken);
  const picked = live && accounts.find((a) => a.uid === live.uid) ? accounts.find((a) => a.uid === live.uid) : accounts[0];
  return {
    accessToken: picked.credential.accessToken,
    uid: picked.credential.uid,
    endpoint: undefined, // 用默认 endpoint
  };
}

//#endregion

/**
 * 本次进程里「当前生效」的那一次 apply 留下的清理函数。
 *
 * 为什么需要模块级的它：
 *   dsh-host-webserver 的 register() 遇到同一个 (kind, path) 会直接抛
 *     webserver: duplicate exact route "/wb-console"
 *   —— 路径不做归一化，所以这是一个硬冲突，会让整个插件激活失败。
 *
 *   DSH 自带 hmr，配置/文件变化时插件会被重新 apply。只要有一次
 *   「旧的 dispose 还没跑到、新的 apply 已经开始」，第二次注册就会撞车，
 *   插件在界面上显示「异常 / 无法使用」。
 *
 *   新的一次 apply 先把自己上一次的注册清掉，就与宿主的重载顺序无关了。
 */
let liveDispose = null;

/** 清掉上一次 apply 的注册（重复调用安全） */
function disposeLive() {
  const fn = liveDispose;
  liveDispose = null;
  if (typeof fn !== 'function') return;
  try {
    fn();
  } catch {
    /* 忽略：清理失败不应该让新的 apply 起不来 */
  }
}

export function apply(ctx, config = {}) {
  // —— 幂等：先撤掉自己上一次的注册 ——
  //
  // 必须在注册任何路由之前做。宿主重载时若没跑到旧 dispose，
  // 这一步就是唯一能避免 "duplicate exact route" 的地方。
  disposeLive();

  // —— 先把「模型池」那一半交给 vendored 的 xdpool 实现 ——
  //
  // 合并成一个插件后，这里既提供控制台/技能市场，也提供 xdpool 的
  // LLM provider（id: llm-workbuddy-xdpool）。两个 apply 各管各的：
  // xdpool 管 provider 与账号池，本文件管控制台页面。
  //
  // vendored 代码原样保留（MIT, (c) XDTrees），见 vendor/xdpool/。
  let poolDispose = null;
  try {
    const pool = xdpoolModule.apply(ctx, config.pool || {});
    if (typeof pool === 'function') poolDispose = pool;
  } catch (e) {
    // 模型池不可用不应拖垮控制台（反过来也一样）
    ctx.logger?.warn?.('[workbuddy-console] 模型池(xdpool) 启动失败：' + (e && e.message ? e.message : String(e)));
  }

  const port = config.port ?? ctx.webServer.port;

  const routes = [];

  // —— 计费代理 ——
  //
  // 包在 xdpool shim 外面旁听 SSE，抓上游返回的真实 usage.credit。
  // 对 xdpool 零改动 —— 它已经并入本仓库，改动只落在本文件内。
  // 启动失败不影响其它功能（只是拿不到消耗数字）。
  let billingProxy = null;
  if (config.creditMeter !== false) {
    startBillingProxy({ logger: ctx.logger })
      .then(async (proxy) => {
        billingProxy = proxy;
        ctx.logger?.info?.(`[workbuddy-console] 计费代理已启动: ${proxy.baseUrl()}`);
        // 从 xdpool 的 status 里读 shim 地址并绑定
        const bind = async () => {
          const r = await callPool(port, 'status', { method: 'GET', timeoutMs: 15000 });
          const shim = r.ok && r.data && r.data.shim && r.data.shim.baseUrl;
          if (shim && !proxy.hasUpstream()) proxy.setUpstream(shim);
          return shim || null;
        };
        await bind().catch(() => {});
        // shim 地址可能在重扫后变化，定期校正
        const timer = setInterval(() => {
          bind().catch(() => {});
        }, 60000);
        timer.unref?.();
      })
      .catch((err) => {
        ctx.logger?.warn?.('[workbuddy-console] 计费代理启动失败（积分显示将不可用）: ' + (err && err.message ? err.message : String(err)));
      });
  }

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
        const WEB_FILES = ['index.html', 'app.js', 'style.css', 'i18n-dict.js', 'i18n-runtime.js'];
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

  // 静态资源按文件注册路由（每个请求重新读盘，所以改前端刷新即可生效）。
  // 新增前端文件时只要在这里加一行，不用改别处。
  const STATIC_FILES = [
    ['app.js', 'text/javascript; charset=utf-8'],
    ['style.css', 'text/css; charset=utf-8'],
    ['i18n-dict.js', 'text/javascript; charset=utf-8'],
    ['i18n-runtime.js', 'text/javascript; charset=utf-8'],
  ];
  for (const [file, type] of STATIC_FILES) {
    routes.push(
      ctx.webServer.register({
        kind: 'exact',
        path: `${BASE}/${file}`,
        handler: guard(file, staticHandler(file, type)),
      }),
    );
  }

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

        // 顺带记一次快照：这样即使不点「一键签到」，
        // 只要打开过页面就有历史，趋势图不会一片空白。
        try {
          const accounts = Array.isArray(r.data?.accounts) ? r.data.accounts : [];
          history.recordSnapshot(
            accounts.map((a) => ({
              uid: a.id,
              nickname: a.nickname || a.label,
              credit: (a.credits && a.credits.total) || 0,
              checkedIn: !!(a.checkin && a.checkin.todayCheckedIn),
              streakDays: (a.checkin && a.checkin.streakDays) || 0,
              source: 'overview',
            })),
          );
        } catch (e) {
          ctx.logger?.warn?.('[workbuddy-console] 记录概览快照失败: ' + (e && e.message ? e.message : String(e)));
        }

        // 同时采一次余额，供「消耗」统计做差值。
        // 这是无需代理就能得到消耗数据的路径。
        try {
          const accounts = Array.isArray(r.data?.accounts) ? r.data.accounts : [];
          samples.recordSample(
            accounts.map((a) => ({
              uid: a.id,
              nickname: a.nickname || a.label,
              credit: (a.credits && a.credits.total) || 0,
            })),
          );
        } catch (e) {
          ctx.logger?.warn?.('[workbuddy-console] 记录余额样本失败: ' + (e && e.message ? e.message : String(e)));
        }

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

          // 签到后记一笔历史。取签到后的真实状态（checkin 返回的 streakDays），
          // 而不是本地推算，保证历史与上游一致。
          if (out.ok && Array.isArray(out.results)) {
            try {
              history.recordSnapshot(
                out.results.map((r) => ({
                  uid: r.id,
                  nickname: r.label,
                  credit: r.credit || 0,
                  checkedIn: r.outcome === 'claimed' || r.outcome === 'already',
                  streakDays: r.streakDays || 0,
                  source: 'checkin',
                })),
              );
              // 顺手裁剪，避免文件无限增长（失败也不影响主流程）
              history.prune();
            } catch (e) {
              ctx.logger?.warn?.('[workbuddy-console] 记录签到历史失败: ' + (e && e.message ? e.message : String(e)));
            }
          }

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

  // —— 对话积分消耗 ——
  //
  // 数据来自旁听 shim 的 SSE 流（见 credit-meter.mjs）。
  // 这是上游返回的**真实计费值**，不是 token × 倍率的估算。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/credit`,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x');
          const session = url.searchParams.get('session');

          // 不传 session 时返回总量概要，便于排查
          if (!session) {
            const all = allCredits();
            const total = all.reduce((s, v) => s + v.credit, 0);
            return json(res, 200, {
              ok: true,
              credit: total,
              calls: all.reduce((s, v) => s + v.calls, 0),
              sessions: all.length,
              proxy: billingProxy ? { running: true, baseUrl: billingProxy.baseUrl(), hasUpstream: billingProxy.hasUpstream() } : { running: false },
              ...creditStats(),
            });
          }

          json(res, 200, { ok: true, session, ...getCredit(session) });
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // —— 积分消耗（余额差值法） ——
  //
  // 这条路径**不需要代理**：每次读概览时顺手采一次余额，
  // 之后按时间差值算出「消耗」与「入账」。
  //
  // 为什么不用「净值」当消耗：签到 +100、对话 -30，净值是 +70。
  // 必须分开统计，否则数字完全错。见 credit-samples.mjs。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/credit/summary`,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x');
          const days = Number(url.searchParams.get('days')) || 7;
          json(res, 200, samples.summarizeSamples({ days }));
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/credit/sample`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const r = await callPool(port, 'status', { timeoutMs: 30000 });
          if (!r.ok) return json(res, 502, { ok: false, error: r.error || `HTTP ${r.status}` });
          const accounts = Array.isArray(r.data?.accounts) ? r.data.accounts : [];
          const out = samples.recordSample(
            accounts.map((a) => ({
              uid: a.id,
              nickname: a.nickname || a.label,
              credit: (a.credits && a.credits.total) || 0,
            })),
          );
          samples.pruneSamples();
          json(res, 200, { ...out, accounts: accounts.length });
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/credit/clear`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        json(res, 200, samples.clearSamples());
      },
    }),
  );

  // —— 签到历史 ——
  //
  // 只记录本地快照，不上传。写入发生在签到成功后与页面加载时。
  // 聚合时对「同一天同一账号」只取最后一次快照，避免刷新页面导致重复计数。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/history`,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x');
          const days = Number(url.searchParams.get('days')) || 30;
          json(res, 200, history.summarize({ days }));
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/history/prune`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          json(res, 200, history.prune());
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/history/clear`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          json(res, 200, history.clear());
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // —— 技能市场 ——
  //
  // WorkBuddy 的技能市场（实测 10000+ 技能），装到 <DSH>/skills/<name>/。
  // dsh-skill-filesystem 会扫描并 watch 该目录，所以装完不用重启 DSH。
  //
  // 只读接口（列表/搜索）不落盘；安装会写文件，因此校验得严一些：
  // 技能名必须 kebab-case、解压路径必须落在目标目录内。
  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/skills/list`,
      handler: async (req, res) => {
        try {
          const url = new URL(req.url, 'http://x');
          const page = Number(url.searchParams.get('page')) || 1;
          const pageSize = Number(url.searchParams.get('pageSize')) || 20;
          const keyword = url.searchParams.get('keyword') || '';

          const auth = pickAuthAccount();
          if (!auth) return json(res, 200, { ok: false, code: 'NO_AUTH', error: '本机没有可用的 WorkBuddy 凭证' });

          const r = await skillMarket.listSkills(auth, { page, pageSize, keyword });
          if (!r.ok) return json(res, 502, r);

          // 标记哪些已装
          const installed = skillMarket.listInstalled();
          json(res, 200, {
            ...r,
            installed: [...installed.keys()],
            skillsDir: skillMarket.skillsDir(),
          });
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/skills/installed`,
      handler: async (req, res) => {
        try {
          const installed = skillMarket.listInstalled();
          json(res, 200, {
            ok: true,
            skillsDir: skillMarket.skillsDir(),
            total: installed.size,
            skills: [...installed.values()].sort((a, b) => a.dir.localeCompare(b.dir)),
          });
        } catch (e) {
          json(res, 500, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/skills/install`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = await readJsonBody(req);
          const skillId = typeof body.skillId === 'string' ? body.skillId : '';
          const name = typeof body.name === 'string' ? body.name : '';
          if (!skillId || !name) return json(res, 400, { ok: false, error: '缺少 skillId 或 name' });

          const auth = pickAuthAccount();
          if (!auth) return json(res, 400, { ok: false, error: '本机没有可用的 WorkBuddy 凭证' });

          const r = await skillMarket.installSkill(
            auth,
            { skillId, name, version: body.version },
            { overwrite: body.overwrite === true },
          );
          json(res, r.ok ? 200 : 400, r);
        } catch (e) {
          json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  routes.push(
    ctx.webServer.register({
      kind: 'exact',
      path: `${BASE}/api/skills/uninstall`,
      handler: async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' });
        try {
          const body = await readJsonBody(req);
          const name = typeof body.name === 'string' ? body.name : '';
          if (!name) return json(res, 400, { ok: false, error: '缺少 name' });
          const r = skillMarket.uninstallSkill(name);
          json(res, r.ok ? 200 : 400, r);
        } catch (e) {
          json(res, 400, { ok: false, error: e && e.message ? e.message : String(e) });
        }
      },
    }),
  );

  // —— 账号体检 ——
  //
  // 逐个账号真发一次上游请求，确认 token 是否仍被接受。
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

  const cleanup = () => {
    // 先把自己从「当前生效」里摘掉，避免 disposeLive() 二次执行
    if (liveDispose === cleanup) liveDispose = null;
    for (const dispose of routes) {
      try {
        dispose();
      } catch {
        /* 忽略重复释放 */
      }
    }
    // 关掉计费代理，避免插件卸载后端口泄漏
    if (billingProxy) {
      billingProxy.close().catch(() => {});
      billingProxy = null;
    }
    // 卸载模型池那一半（provider / 账号池 / shim）
    if (typeof poolDispose === 'function') {
      try {
        poolDispose();
      } catch {
        /* 忽略重复释放 */
      }
      poolDispose = null;
    }
  };

  // 记成「当前生效」：下一次 apply 会先调用它，
  // 这样即使宿主没跑到返回值，也不会撞 "duplicate exact route"。
  liveDispose = cleanup;
  return cleanup;
}
