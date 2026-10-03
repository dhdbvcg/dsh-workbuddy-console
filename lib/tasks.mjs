/**
 * 未完成任务（成长任务）读取。
 *
 * 数据源：WorkBuddy growth 任务接口 `GET {chat}/v2/activity/growth/tasks`。
 *
 * 为什么不让 xdpool 插件代劳：
 *   插件的 /status 路由只暴露 claimableSeen（一个累计计数）和自动化收益，
 *   并没有把任务列表给出来。所以这里复用插件导出的 client 直接读，
 *   这样两边的任务口径（parseTask 的 claimable/locked 判定）完全一致。
 *
 * 三种状态（与插件 parseTask 同口径）：
 *   claimed   —— 已领取
 *   claimable —— 达标且未领取（可以马上领）
 *   pending   —— 未完成（有进度但没达标）   ← 本次要展示的重点
 *   locked    —— 锁定
 */

import os from 'node:os';
import path from 'node:path';

//#region 插件客户端桥接

let cachedClient = null;

/**
 * 找一个能 import 到模型池实现的入口。
 *
 * 合并成一个插件后，首选是**本仓库自带的 vendor 副本**
 * （vendor/xdpool，原 dsh-workbuddy-xdpool，MIT (c) XDTrees）：
 * 同一份代码，不必再猜 node_modules 装在哪。
 *
 * 为什么还需要后面的候选：
 *   vendor 副本是源码目录，裸包名解析不了（那里没有 node_modules），
 *   所以仍要用 file:// 绝对路径；万一将来 vendor 被移除，
 *   还能回退到 profile 里已安装的 dsh-workbuddy-xdpool。
 *
 * 候选顺序：
 *   1. vendor/xdpool（本仓库自带）
 *   2. DSH_PROFILE_DIR 环境变量指定的 profile
 *   3. 常见 profile 位置（desktop / web）
 *   4. 直接裸包名（本插件被安装进某个 node_modules 时可用）
 */
function pluginEntryCandidates() {
  const out = [];
  const add = (dir) => {
    if (!dir) return;
    out.push(dir.replace(/\\/g, '/').replace(/\/+$/, '') + '/node_modules/dsh-workbuddy-xdpool/lib/index.js');
  };

  if (process.env.WORKBUDDY_XDPOOL_ENTRY) out.push(process.env.WORKBUDDY_XDPOOL_ENTRY);

  // 1) 本仓库自带的 vendor 副本（合并后的一等公民）
  out.push(new URL('../vendor/xdpool/lib/index.js', import.meta.url).href);

  const home = os.homedir();
  const dshHome = process.env.DSH_HOME || path.join(home, '.dsh');
  if (process.env.DSH_PROFILE_DIR) add(process.env.DSH_PROFILE_DIR);
  for (const p of ['desktop', 'web']) add(path.join(dshHome, 'profiles', p));

  return out;
}

/**
 * 取 xdpool 插件导出的上游客户端。
 * 失败时返回 { error }，由调用方给出可读提示。
 */
async function getPoolClient() {
  if (cachedClient) return { client: cachedClient };

  const tried = [];
  for (const entry of pluginEntryCandidates()) {
    try {
      const mod = await import('file:///' + entry);
      if (typeof mod.WorkBuddyUpstreamClient !== 'function') {
        tried.push(`${entry} (未导出 WorkBuddyUpstreamClient)`);
        continue;
      }
      cachedClient = new mod.WorkBuddyUpstreamClient({});
      return { client: cachedClient, from: entry };
    } catch (e) {
      tried.push(`${entry} → ${e && e.code ? e.code : e && e.message ? e.message : String(e)}`);
    }
  }

  // 兜底：裸包名（本插件装在某个 node_modules 里时可用）
  try {
    const mod = await import('dsh-workbuddy-xdpool');
    if (typeof mod.WorkBuddyUpstreamClient === 'function') {
      cachedClient = new mod.WorkBuddyUpstreamClient({});
      return { client: cachedClient, from: 'dsh-workbuddy-xdpool' };
    }
  } catch (e) {
    tried.push(`dsh-workbuddy-xdpool → ${e && e.code ? e.code : String(e)}`);
  }

  return {
    error:
      '找不到 dsh-workbuddy-xdpool 插件，无法读取任务列表。' +
      '请确认它已安装在 DSH profile 中（任务数据由它提供）。已尝试：' +
      tried.join('; '),
  };
}

//#endregion

//#region 任务读取

/**
 * 归一化一个任务，产出展示需要的字段。
 * @param {object} t parseTask 的结果
 */
function shape(t) {
  let state;
  if (t.claimed) state = 'claimed';
  else if (t.locked) state = 'locked';
  else if (t.claimable) state = 'claimable';
  else state = 'pending';

  const target = Number(t.target) || 0;
  const current = Number(t.current) || 0;
  return {
    taskCode: t.taskCode,
    title: t.title,
    state,
    current,
    target,
    // 进度百分比：target 为 0（比如纯计数任务）时按 0 处理，避免除零
    percent: target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0,
    credit: t.credit || 0,
    energy: t.energy || 0,
    hasReward: !!t.hasReward,
    acceptStatus: t.acceptStatus || '',
    locked: !!t.locked,
  };
}

/**
 * 读一个账号的任务列表。
 * @returns {Promise<{ok:true, tasks:Array, summary:object}|{ok:false, error:string}>}
 */
export async function tasksForCredential(cred) {
  const got = await getPoolClient();
  if (got.error) return { ok: false, error: got.error };

  try {
    const raw = await got.client.listTasks(cred);
    const tasks = raw.map(shape);

    const pending = tasks.filter((t) => t.state === 'pending');
    const claimable = tasks.filter((t) => t.state === 'claimable');

    return {
      ok: true,
      tasks,
      summary: {
        total: tasks.length,
        pending: pending.length,
        claimable: claimable.length,
        claimed: tasks.filter((t) => t.state === 'claimed').length,
        locked: tasks.filter((t) => t.state === 'locked').length,
        // 未完成任务里「还能拿到的」总积分 —— 这是用户最关心的数字
        pendingCredit: pending.reduce((s, t) => s + t.credit, 0),
        claimableCredit: claimable.reduce((s, t) => s + t.credit, 0),
      },
    };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/**
 * 批量读多个账号的任务，只返回「未完成」和「可领取」两类。
 *
 * 默认只保留有未完成任务的账号，避免页面被已完成账号刷屏。
 *
 * @param {Array<{uid,nickname,credential}>} accounts
 * @param {object} [opts] { includeAll, concurrency }
 */
export async function pendingTasks(accounts, opts = {}) {
  const includeAll = opts.includeAll === true;
  const concurrency = Math.max(1, Math.min(4, opts.concurrency || 2));

  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < accounts.length) {
      const i = cursor++;
      const a = accounts[i];
      const r = await tasksForCredential(a.credential);
      if (!r.ok) {
        results[i] = { uid: a.uid, nickname: a.nickname, ok: false, error: r.error };
        continue;
      }
      const pending = r.tasks.filter((t) => t.state === 'pending');
      const claimable = r.tasks.filter((t) => t.state === 'claimable');
      results[i] = {
        uid: a.uid,
        nickname: a.nickname,
        ok: true,
        summary: r.summary,
        pending,
        claimable,
        // 只在需要完整列表时带上已完成
        ...(includeAll ? { all: r.tasks } : {}),
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, accounts.length) }, worker));

  const ok = results.filter((r) => r && r.ok);
  return {
    ok: true,
    checkedAt: Date.now(),
    accounts: results.filter(Boolean),
    totals: {
      accounts: ok.length,
      failed: results.filter((r) => r && !r.ok).length,
      pendingTasks: ok.reduce((s, r) => s + r.pending.length, 0),
      claimableTasks: ok.reduce((s, r) => s + r.claimable.length, 0),
      pendingCredit: ok.reduce((s, r) => s + (r.summary?.pendingCredit || 0), 0),
      claimableCredit: ok.reduce((s, r) => s + (r.summary?.claimableCredit || 0), 0),
    },
  };
}

/**
 * 领取一个任务的奖励。
 *
 * 复用插件的 claimTaskReward：它已经处理了两个易错点 ——
 * taskCode 走 PATH 而不是 body，且必须带 growth-center 的
 * Origin/Referer + x-client-platform: web。
 * 重复领取上游返回 already_claimed（0 积分），插件已视为成功。
 */
export async function claimTask(cred, taskCode) {
  const got = await getPoolClient();
  if (got.error) return { ok: false, error: got.error };
  if (!taskCode) return { ok: false, error: '缺少 taskCode' };

  try {
    const r = await got.client.claimTaskReward(cred, taskCode);
    return { ok: true, credit: r.credit || 0, energy: r.energy || 0 };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

//#endregion
