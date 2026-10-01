/**
 * 签到历史记录。
 *
 * 为什么需要：
 *   插件与控制台都只显示「当前状态」——今天签没签、现在有多少积分。
 *   一旦跨天，昨天的数字就没了，无法回答「这个月一共领了多少」「趋势如何」。
 *
 * 数据来源：每次页面加载/签到成功时，把当时的快照追加到本地 JSONL。
 *   只记录，不上传；文件在 <插件数据目录>/history.jsonl。
 *
 * 为什么用 JSONL 而不是 JSON 数组：
 *   追加写入不需要读全量、不需要重写整个文件，断电/中断最多丢最后一行，
 *   不会把已有历史全毁掉。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 保留天数：超过就裁剪，避免文件无限增长 */
const RETAIN_DAYS = Number(process.env.WB_CONSOLE_HISTORY_DAYS || 90);

/** 单条记录保留的最大条数，双保险 */
const MAX_RECORDS = Number(process.env.WB_CONSOLE_HISTORY_MAX || 5000);

/**
 * 数据目录。
 * 优先环境变量，其次 DSH 的 plugin data 目录，最后退回用户目录。
 */
export function historyDir() {
  if (process.env.WB_CONSOLE_DATA_DIR) return process.env.WB_CONSOLE_DATA_DIR;
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'plugin-data', 'dsh-workbuddy-console');
}

export function historyFile() {
  return path.join(historyDir(), 'history.jsonl');
}

/** 本地日期 key（YYYY-MM-DD），用本地时区而不是 UTC */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 追加一批快照。
 *
 * @param {Array<{uid,nickname,credit,checkedIn,streakDays,source}>} entries
 * @returns {{ok:boolean, written:number, file:string, error?:string}}
 */
export function recordSnapshot(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: true, written: 0, file: historyFile() };
  }

  const ts = Date.now();
  const day = dayKey(ts);

  try {
    fs.mkdirSync(historyDir(), { recursive: true });
    const lines = entries.map((e) =>
      JSON.stringify({
        ts,
        day,
        uid: String(e.uid || ''),
        nickname: String(e.nickname || ''),
        credit: Number(e.credit) || 0,
        checkedIn: !!e.checkedIn,
        streakDays: Number(e.streakDays) || 0,
        source: String(e.source || 'unknown'),
      }),
    );
    fs.appendFileSync(historyFile(), lines.join('\n') + '\n', 'utf8');
    return { ok: true, written: lines.length, file: historyFile() };
  } catch (e) {
    return { ok: false, written: 0, file: historyFile(), error: e && e.message ? e.message : String(e) };
  }
}

/** 读取全部记录（容忍末尾半行/损坏行） */
export function readAll() {
  const file = historyFile();
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object' && o.day) out.push(o);
    } catch {
      // 损坏行（比如写入时被中断）直接跳过，不影响其余历史
    }
  }
  return out;
}

/**
 * 聚合：按天汇总，并算出每个账号的趋势。
 *
 * 关键处理：同一天同一账号可能被记录多次（每次刷新页面都会记一次）。
 * 如果直接累加会严重重复计数。这里对每天每账号只取**最后一次**快照
 * 作为当天状态，而不是求和。
 */
export function summarize(opts = {}) {
  const days = Math.max(1, Math.min(365, opts.days || 30));
  const all = readAll();
  const now = Date.now();

  // 只保留最近 N 天
  const cutoffDay = dayKey(now - (days - 1) * 86400000);
  const recent = all.filter((r) => r.day >= cutoffDay);

  // 按 (day, uid) 取最后一次快照
  const latest = new Map();
  for (const r of recent) {
    const key = r.day + '\u0000' + r.uid;
    const prev = latest.get(key);
    if (!prev || r.ts >= prev.ts) latest.set(key, r);
  }

  // 按天聚合：当天的总积分（各账号最后一次快照之和）、签到账号数
  const byDay = new Map();
  for (const r of latest.values()) {
    if (!byDay.has(r.day)) byDay.set(r.day, { day: r.day, credit: 0, accounts: 0, checkedIn: 0 });
    const d = byDay.get(r.day);
    d.credit += r.credit;
    d.accounts += 1;
    if (r.checkedIn) d.checkedIn += 1;
  }

  const series = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));

  // 每天的总积分变化 = 当天总积分 - 前一天总积分（同账号集合可比时才有意义）
  for (let i = 0; i < series.length; i++) {
    const prev = i > 0 ? series[i - 1] : null;
    series[i].delta = prev ? Math.round((series[i].credit - prev.credit) * 100) / 100 : null;
  }

  // 每账号的最新状态与累计
  const perAccount = new Map();
  for (const r of recent) {
    const a = perAccount.get(r.uid) || { uid: r.uid, nickname: r.nickname, firstDay: r.day, lastDay: r.day, days: new Set(), checkedInDays: 0, lastCredit: 0 };
    a.nickname = r.nickname || a.nickname;
    if (r.day < a.firstDay) a.firstDay = r.day;
    if (r.day > a.lastDay) a.lastDay = r.day;
    a.days.add(r.day);
    if (r.checkedIn) a.checkedInDays += 1;
    a.lastCredit = r.credit;
    perAccount.set(r.uid, a);
  }

  return {
    ok: true,
    file: historyFile(),
    totalRecords: all.length,
    windowDays: days,
    series,
    accounts: [...perAccount.values()].map((a) => ({
      uid: a.uid,
      nickname: a.nickname,
      firstDay: a.firstDay,
      lastDay: a.lastDay,
      observedDays: a.days.size,
      checkedInDays: a.checkedInDays,
      lastCredit: a.lastCredit,
    })),
  };
}

/**
 * 裁剪历史：丢掉超过保留期的记录，必要时也按条数上限截断。
 * 返回 { kept, dropped }。
 */
export function prune() {
  const file = historyFile();
  const all = readAll();
  if (all.length === 0) return { ok: true, kept: 0, dropped: 0 };

  const cutoffDay = dayKey(Date.now() - RETAIN_DAYS * 86400000);
  let kept = all.filter((r) => r.day >= cutoffDay);
  // 仍超上限则保留最新的 MAX_RECORDS 条
  if (kept.length > MAX_RECORDS) kept = kept.slice(-MAX_RECORDS);

  const dropped = all.length - kept.length;
  if (dropped > 0) {
    try {
      // 原子替换：先写临时文件再 rename，避免裁剪过程中损坏
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      return { ok: false, kept: kept.length, dropped, error: e && e.message ? e.message : String(e) };
    }
  }
  return { ok: true, kept: kept.length, dropped };
}

/** 清空历史 */
export function clear() {
  try {
    fs.rmSync(historyFile(), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}
