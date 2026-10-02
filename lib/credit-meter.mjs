/**
 * 对话积分消耗采集。
 *
 * 关键发现（实测得出，不是推测）：
 *   WorkBuddy 上游的 SSE 流里，最后一个 usage 帧带有 **真实计费值**：
 *
 *     data: {"usage":{ ..., "credit":0.08 }}
 *
 *   实测对照（同一个请求，只换模型）：
 *     glm-5.3-flash (x0.06) → credit: 0     （免费额度内）
 *     glm-5.3       (x0.79) → credit: 0.01
 *     kimi-k3-1     (x1.62) → credit: 0.08
 *
 *   所以**不需要用 token × 倍率去估算** —— 上游直接告诉我们准确值。
 *   估算会有误差（缓存命中、推理 token、倍率单位都不确定），而这里能拿到真值。
 *
 * 采集方式：
 *   拦截 xdpool 的 shim 响应流 —— 它已经是 SSE，且每个 chunk 都经过
 *   serveSuccessfulStream()。我们只**旁听**（tee），不改写任何字节，
 *   因此对流式输出零影响。如果上游格式变了导致解析失败，
 *   就静默放弃本次采集，绝不影响正常对话。
 *
 * 归属：
 *   按 sessionId 累加。DSH 的 shim 请求头里带 x-conversation-id /
 *   或由调用方按「当前会话」归集，见 recordCredit()。
 */

/** 每个会话的累计消耗：sessionId -> { credit, calls, updatedAt } */
const bySession = new Map();

/** 保留上限，避免长时间运行后 Map 无限增长 */
const MAX_SESSIONS = 200;

/** 单条保留的最大帧字节数，防止异常大帧占用内存 */
const MAX_FRAME_BYTES = 64 * 1024;

/** 当前正在采集的流数量（诊断用） */
let activeStreams = 0;

//#region SSE 解析

/**
 * 从一个 SSE 文本块中抽 usage.credit。
 *
 * 流可能把一帧切成多个 chunk，所以调用方需要跨 chunk 保留尾巴。
 * 这里只负责从「已经是完整行」的文本里找。
 *
 * @returns {number|null} credit 值；没找到返回 null
 */
function extractCreditFromChunk(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  if (!text.includes('credit')) return null; // 快速排除，绝大多数帧不含

  let found = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    let obj;
    try {
      obj = JSON.parse(payload);
    } catch {
      // 半截帧（被 chunk 切断）——跳过，等下一个 chunk 拼上再说
      continue;
    }
    const usage = obj && obj.usage;
    if (usage && typeof usage.credit === 'number' && Number.isFinite(usage.credit)) {
      found = usage.credit;
    }
  }
  return found;
}

//#endregion

//#region 记录

function prune() {
  if (bySession.size <= MAX_SESSIONS) return;
  // 丢掉最旧的
  const entries = [...bySession.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const drop = entries.length - MAX_SESSIONS;
  for (let i = 0; i < drop; i++) bySession.delete(entries[i][0]);
}

/**
 * 记录一次调用的积分消耗。
 * @param {string} sessionId
 * @param {number} credit
 * @param {{model?:string, account?:string}} [meta]
 */
export function recordCredit(sessionId, credit, meta = {}) {
  if (!Number.isFinite(credit) || credit < 0) return;
  const key = String(sessionId || 'unknown');
  const prev = bySession.get(key) || { credit: 0, calls: 0, updatedAt: 0, model: '', account: '' };
  const next = {
    credit: Math.round((prev.credit + credit) * 10000) / 10000,
    calls: prev.calls + 1,
    updatedAt: Date.now(),
    model: meta.model || prev.model,
    account: meta.account || prev.account,
  };
  bySession.set(key, next);
  prune();
}

/**
 * 读一个会话的累计消耗。
 */
export function getCredit(sessionId) {
  const v = bySession.get(String(sessionId || 'unknown'));
  return v ? { ...v } : { credit: 0, calls: 0, updatedAt: 0, model: '', account: '' };
}

/** 所有会话的消耗（诊断用） */
export function allCredits() {
  return [...bySession.entries()].map(([sessionId, v]) => ({ sessionId, ...v }));
}

/** 清空（测试用） */
export function reset() {
  bySession.clear();
}

/** 运行状态（诊断用） */
export function stats() {
  return { sessions: bySession.size, activeStreams };
}

//#endregion

//#region 流旁听

/**
 * 给一个 SSE 响应流挂上旁听器。
 *
 * 做法：把原始流包一层 Transform —— 数据**原样透传**，
 * 只在经过时顺带解析 credit。任何解析异常都被吞掉，
 * 绝不让采集影响对话本身。
 *
 * @param {import('node:stream').Readable} source 上游响应流
 * @param {object} opts { sessionId, model, account, onCredit }
 * @returns {Promise<import('node:stream').Transform>} 可安全 pipe 到 res 的流
 */
export async function teeForCredit(source, opts = {}) {
  const { Transform } = await import('node:stream');
  const { sessionId, model, account, onCredit } = opts;
  let tail = '';
  activeStreams++;

  const spy = new Transform({
    transform(chunk, _enc, cb) {
      try {
        // 只解析，不改写：原样推给下游
        const text = tail + chunk.toString('utf8');
        const credit = extractCreditFromChunk(text);
        if (credit !== null) {
          recordCredit(sessionId, credit, { model, account });
          if (typeof onCredit === 'function') {
            try {
              onCredit(credit);
            } catch {
              /* 回调异常不影响流 */
            }
          }
        }
        // 保留末尾未成行的部分，供下一个 chunk 拼接
        const lastNl = text.lastIndexOf('\n');
        tail = lastNl >= 0 ? text.slice(lastNl + 1) : text;
        if (tail.length > MAX_FRAME_BYTES) tail = tail.slice(-MAX_FRAME_BYTES);
      } catch {
        /* 采集失败就算了，绝不打断对话 */
      }
      cb(null, chunk);
    },
    flush(cb) {
      activeStreams = Math.max(0, activeStreams - 1);
      cb();
    },
  });

  // 关键：必须让 source 流进 spy。调用方之后会把返回值 pipe 给 res，
  // 但 source → spy 这一段要在这里接好，否则数据永远不会流动。
  source.pipe(spy);

  // source 出错时也要把计数减回去，否则会一直累加
  source.on('error', (err) => {
    activeStreams = Math.max(0, activeStreams - 1);
    spy.destroy(err);
  });

  return spy;
}

//#endregion

export const _internal = { extractCreditFromChunk };
