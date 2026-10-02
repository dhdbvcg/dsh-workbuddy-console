/**
 * 余额差值采集：不依赖代理也能算出的消耗。
 *
 * 为什么需要这个：
 *   「每次对话消耗多少」只能靠拦截 SSE 拿到（见 credit-meter.mjs），
 *   而那需要让 DSH 的模型流量经过我们的代理 —— 有链路风险。
 *   但「一段时间消耗了多少」不需要拦截：定期采样各账号余额，
 *   用差值就能算出来。这是零风险方案，可以先落地。
 *
 * 一个重要细节：余额会因为**签到、任务奖励**而增加，也会因为
 *   **对话消耗**而减少。所以差值不能直接当作消耗：
 *   要把「已知的入账」（签到/自动化收益）减掉。
 *   做不到精确归因时，宁可标注为「净变化」，不要谎称是消耗。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 采样保留上限（条），避免文件无限增长 */
const MAX_SAMPLES = 20000;
/** 保留天数 */
const RETAIN_DAYS = Number(process.env.WB_CONSOLE_CREDIT_DAYS || 90);

//#region 存储

export function dataDir() {
  if (process.env.WB_CONSOLE_DATA_DIR) return process.env.WB_CONSOLE_DATA_DIR;
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(dshHome, 'plugin-data', 'dsh-workbuddy-console');
}

/**
 * 是否允许写入。
 *
 * 测试环境（WB_CI=1）若没有显式指定数据目录，就拒绝写入 ——
 * 防止测试把假数据混进用户真实的余额历史。
 * 之前正是因此往用户的 credit-samples.jsonl 里写了 11 条 uid=a 的假记录。
 * 生产运行没有 WB_CI，不受影响。
 */
function writesAllowed() {
  if (!process.env.WB_CI) return true;
  return !!process.env.WB_CONSOLE_DATA_DIR;
}

export function sampleFile() {
  return path.join(dataDir(), 'credit-samples.jsonl');
}

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 记录一次余额快照。
 *
 * 带去重：距上次写入不足 minGapMs 且余额未变时跳过。
 *
 * 为什么需要：每次刷新页面会同时触发 /api/overview（自动采样）
 * 和 /api/credit/sample（「刷新消耗」按钮），两条入口各写一次，
 * 结果是同一秒内出现内容完全相同的两条记录 —— 会污染采样密度，
 * 也会让「采样点数」这个数字虚高。
 *
 * @param {Array<{uid,nickname,credit}>} accounts
 * @param {object} [opts] { minGapMs } 默认 3000ms
 */
export function recordSample(accounts, opts = {}) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return { ok: true, written: 0 };
  }
  if (!writesAllowed()) {
    return { ok: false, written: 0, error: '测试环境未指定 WB_CONSOLE_DATA_DIR，拒绝写入真实数据目录' };
  }

  const minGapMs = Number.isFinite(opts.minGapMs) ? opts.minGapMs : 3000;

  // 去重：与最后一条比较，时间够近且所有余额都没变就跳过
  if (minGapMs > 0) {
    const all = readSamples();
    const last = all[all.length - 1];
    if (last && Date.now() - last.ts < minGapMs) {
      const prev = new Map();
      // 取上一批（同一 ts 的所有行）用于比较
      for (let i = all.length - 1; i >= 0 && all[i].ts === last.ts; i--) prev.set(all[i].uid, all[i].credit);
      const unchanged =
        prev.size === accounts.length &&
        accounts.every((a) => prev.get(String(a.uid || '')) === (Number(a.credit) || 0));
      if (unchanged) {
        return { ok: true, written: 0, skipped: true, reason: '与上一条相同且间隔过短' };
      }
    }
  }

  const ts = Date.now();
  const day = dayKey(ts);
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    const lines = accounts
      .filter((a) => Number.isFinite(Number(a.credit)))
      .map((a) =>
        JSON.stringify({
          ts,
          day,
          uid: String(a.uid || ''),
          nickname: String(a.nickname || ''),
          credit: Number(a.credit) || 0,
        }),
      );
    if (lines.length === 0) return { ok: true, written: 0 };
    fs.appendFileSync(sampleFile(), lines.join('\n') + '\n', 'utf8');
    return { ok: true, written: lines.length, file: sampleFile() };
  } catch (e) {
    return { ok: false, written: 0, error: e && e.message ? e.message : String(e) };
  }
}

/** 读回全部样本（容忍损坏行） */
export function readSamples() {
  let text;
  try {
    text = fs.readFileSync(sampleFile(), 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object' && o.day && Number.isFinite(o.credit)) out.push(o);
    } catch {
      /* 损坏行跳过 */
    }
  }
  return out;
}

//#endregion

//#region 聚合

/**
 * 计算消耗。
 *
 * 算法：对每个账号，按时间排序采样点；
 *   相邻两点的差值 = 该区间的净变化。
 *   负值（余额减少）累加为「消耗」，正值累加为「入账」。
 *
 * 为什么不把正负净值直接当消耗：
 *   签到 +100 后对话 -30，净值 +70。若当消费就完全错了。
 *   分开累计才诚实 —— 界面上也应分别呈现。
 *
 * @param {object} opts { days }
 */
export function summarizeSamples(opts = {}) {
  const days = Math.max(1, Math.min(365, opts.days || 7));
  const cutoff = Date.now() - days * 86400000;
  const all = readSamples().filter((r) => r.ts >= cutoff);

  if (all.length === 0) {
    return { ok: true, days, samples: 0, spent: 0, gained: 0, net: 0, perAccount: [], spanDays: 0 };
  }

  // 按账号分组并按时间排序
  const byUid = new Map();
  for (const r of all) {
    if (!byUid.has(r.uid)) byUid.set(r.uid, []);
    byUid.get(r.uid).push(r);
  }

  let spent = 0;
  let gained = 0;
  const perAccount = [];

  for (const [uid, rows] of byUid) {
    rows.sort((a, b) => a.ts - b.ts);
    // 同一时刻只保留最后一条，避免并发采样造成抖动
    const dedup = [];
    for (const r of rows) {
      const last = dedup[dedup.length - 1];
      if (last && last.ts === r.ts) dedup[dedup.length - 1] = r;
      else dedup.push(r);
    }

    let aSpent = 0;
    let aGained = 0;
    for (let i = 1; i < dedup.length; i++) {
      const delta = dedup[i].credit - dedup[i - 1].credit;
      if (delta < 0) aSpent += -delta;
      else if (delta > 0) aGained += delta;
    }
    spent += aSpent;
    gained += aGained;
    perAccount.push({
      uid,
      nickname: dedup[dedup.length - 1].nickname,
      firstCredit: dedup[0].credit,
      lastCredit: dedup[dedup.length - 1].credit,
      samples: dedup.length,
      spent: round(aSpent),
      gained: round(aGained),
      firstTs: dedup[0].ts,
      lastTs: dedup[dedup.length - 1].ts,
    });
  }

  const spanDays = new Set(all.map((r) => r.day)).size;

  return {
    ok: true,
    days,
    samples: all.length,
    spanDays,
    spent: round(spent),
    gained: round(gained),
    net: round(gained - spent),
    perAccount: perAccount.sort((a, b) => b.spent - a.spent),
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}

/** 裁剪旧样本（原子替换） */
export function pruneSamples() {
  const file = sampleFile();
  const all = readSamples();
  if (all.length === 0) return { ok: true, kept: 0, dropped: 0 };
  if (!writesAllowed()) return { ok: false, kept: all.length, dropped: 0, error: '测试环境未指定数据目录，拒绝改写' };

  const cutoff = Date.now() - RETAIN_DAYS * 86400000;
  let kept = all.filter((r) => r.ts >= cutoff);
  if (kept.length > MAX_SAMPLES) kept = kept.slice(-MAX_SAMPLES);

  const dropped = all.length - kept.length;
  if (dropped > 0) {
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, kept.map((r) => JSON.stringify(r)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      return { ok: false, dropped, error: e && e.message ? e.message : String(e) };
    }
  }
  return { ok: true, kept: kept.length, dropped };
}

/** 清空 */
export function clearSamples() {
  try {
    fs.rmSync(sampleFile(), { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

//#endregion
