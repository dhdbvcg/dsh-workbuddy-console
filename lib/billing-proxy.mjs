/**
 * 计费代理：包在 xdpool 的 shim 外面，旁听 SSE 抓取 credit。
 *
 * 为什么用代理而不是改 xdpool：
 *   xdpool 装在 profile 的 node_modules 里，升级会被覆盖。
 *   改它等于每次升级都要重新打补丁 —— 这正是我之前踩过的坑。
 *   代理方式对 xdpool 零改动。
 *
 * 数据流：
 *   DSH → 本代理(:free port) → xdpool shim → WorkBuddy 上游
 *                    ↓ 旁听 SSE，抓 usage.credit
 *                  按会话累加
 *
 * 认证：xdpool shim 用『进程内随机密钥』校验 Bearer。
 * 本代理转发时**原样透传**调用方的 Authorization 头，
 * 所以不需要知道那个密钥。
 */

import http from 'node:http';
import { teeForCredit, recordCredit } from './credit-meter.mjs';

/** 最多允许转发的路径（防止变成开放代理） */
const ALLOWED_PATHS = new Set(['/v1/chat/completions', '/v1/chat/completions/', '/v1/models', '/v1/models/', '/healthz', '/healthz/']);

const BODY_LIMIT = 32 * 1024 * 1024;

/**
 * 启动计费代理。
 *
 * @param {object} opts
 *   - upstream: xdpool shim 的 baseUrl（如 http://127.0.0.1:63622）
 *   - onReady: (baseUrl) => void
 *   - logger
 * @returns {Promise<{baseUrl:()=>string, close:()=>Promise<void>}>}
 */
export async function startBillingProxy(opts = {}) {
  const logger = opts.logger || { info() {}, warn() {} };
  let upstream = (opts.upstream || '').replace(/\/+$/, '');

  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    const pathOnly = url.split('?')[0];

    if (!ALLOWED_PATHS.has(pathOnly)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `no such route: ${req.method} ${pathOnly}`, type: 'not_found' } }));
      return;
    }
    if (!upstream) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'upstream shim not ready', type: 'unavailable' } }));
      return;
    }

    // 原样转发：方法、头、体。Authorization 由调用方带来，我们只需透传。
    const headers = { ...req.headers, host: new URL(upstream).host };

    const sessionId = pickSessionId(req);
    // 模型名要从请求体里读，但体是流式的 —— 边转发边攒一小段用于识别。
    // 只留前 8KB：model 字段在 JSON 开头，没必要缓存整个体。
    let headBuf = '';
    let headDone = false;

    const upstreamReq = http.request(
      upstream + url,
      { method: req.method, headers },
      (upstreamRes) => {
        const isStream = String(upstreamRes.headers['content-type'] || '').includes('text/event-stream');

        // 非流式：直接转发（models / healthz 走这里）
        if (!isStream) {
          res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
          upstreamRes.pipe(res);
          return;
        }

        // 流式：旁听 credit，同时原样转发
        const model = pickModel(req, headBuf || headDone ? headBuf : undefined);
        res.writeHead(upstreamRes.statusCode || 200, upstreamRes.headers);

        teeForCredit(upstreamRes, {
          sessionId,
          model,
          onCredit: (credit) => {
            logger.info?.(`[credit-meter] session=${sessionId} model=${model || '(unknown)'} +${credit} credit`);
          },
        })
          .then((spy) => spy.pipe(res))
          .catch((err) => {
            // 旁听建立失败也不能断流：直接把原始流接上
            logger.warn?.('[credit-meter] tee failed, falling back to raw pipe: ' + (err && err.message));
            try {
              upstreamRes.pipe(res);
            } catch {
              res.end();
            }
          });
      },
    );

    upstreamReq.on('error', (err) => {
      logger.warn?.('[credit-meter] upstream error: ' + (err && err.message));
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'upstream unreachable: ' + (err && err.message), type: 'bad_gateway' } }));
      } else {
        res.end();
      }
    });

    // 请求体限流，避免异常大的 body 占内存。
    // 同时攒下开头一小段，供识别 model 用。
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        upstreamReq.destroy();
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'request body too large', type: 'payload_too_large' } }));
        return;
      }
      if (headBuf.length < 8192) headBuf += chunk.toString('utf8');
      upstreamReq.write(chunk);
    });
    req.on('end', () => upstreamReq.end());
    req.on('error', () => upstreamReq.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl: () => baseUrl,
    /** xdpool shim 起来后调用，绑定上游 */
    setUpstream(next) {
      upstream = String(next || '').replace(/\/+$/, '');
      logger.info?.('[credit-meter] upstream set to ' + upstream);
    },
    hasUpstream: () => upstream !== '',
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

//#endregion

//#region 请求元信息

/**
 * 从请求里挑一个稳定的会话标识。
 *
 * 优先用上游约定的会话头；都没有就退到 model —— 至少能把
 * 「这个模型累计花了多少」归到一起，而不是全塞进 unknown。
 */
export function pickSessionId(req) {
  const h = req && req.headers ? req.headers : {};
  return (
    h['x-conversation-id'] ||
    h['x-session-id'] ||
    h['x-request-id'] ||
    'unknown'
  );
}

/**
 * 从请求体里读 model 名（只用于标注，不参与计费）。
 *
 * 注意竞态：上游可能在请求体读完之前就返回响应头，
 * 那时 bodyText 还是空的。所以这里失败就返回空串，
 * 不阻塞、不等待 —— 模型名只是标注，拿不到也不影响计费正确性。
 */
export function pickModel(req, bodyText) {
  try {
    if (bodyText) {
      const b = JSON.parse(bodyText);
      if (b && typeof b.model === 'string') return b.model;
    }
  } catch {
    // 体还没读完 / 不是 JSON —— 都正常，返回空串即可
  }
  return '';
}
