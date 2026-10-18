/**
 * DeepSeek DSML 工具调用的解析与流式改写。
 * 背景：
 *   WorkBuddy 网关对部分新的 DeepSeek 模型（如 deepseek-v4.1-flash）**不把
 *   工具调用转成结构化的 `tool_calls`**，而是把 DSML 标记直接写进正文：
 *
 *     <｜｜DSML｜｜ calls>
 *     <｜｜DSML｜｜ invoke name="pwsh">
 *     <｜｜DSML｜｜ parameter name="command" string="true">...</｜｜DSML｜｜ parameter>
 *     </｜｜DSML｜｜ invoke>
 *     </｜｜DSML｜｜ calls>
 *
 *   于是 DSH 把它当成普通文本渲染出来（用户看到一串 XML），工具根本没执行。
 *
 * 这里做两件事：
 *   1. parseDsmlCalls()  —— 纯函数：从一段文本里解析出工具调用
 *   2. DsmlStreamRewriter —— 流式改写：边收 SSE 边把 DSML 换成标准
 *      OpenAI `tool_calls` delta，并把 finish_reason 改成 "tool_calls"
 *
 * 设计原则：**没有检测到 DSML 时一个字节都不改**，把影响面限制在真正需要的
 * 那部分响应上。
 */

import { randomUUID } from 'node:crypto';

/** 全角竖线 U+FF5C —— 上游用的就是这个，不是 ASCII '|' */
const P = '\u{FF5C}';
export const DSML_START = `<${P}${P}DSML${P}${P} calls>`;
export const DSML_END = `</${P}${P}DSML${P}${P} calls>`;

const INVOKE_RE = new RegExp(
  `<${P}${P}DSML${P}${P} invoke name="([^"]+)">([\\s\\S]*?)<\\/${P}${P}DSML${P}${P} invoke>`,
  'g',
);
const PARAM_RE = new RegExp(
  `<${P}${P}DSML${P}${P} parameter name="([^"]+)"(?: string="(true|false)")?>([\\s\\S]*?)<\\/${P}${P}DSML${P}${P} parameter>`,
  'g',
);

/**
 * 从一段完整文本里解析出工具调用。
 *
 * @param {string} raw 含 DSML 块的文本
 * @returns {{ calls: Array<{name: string, arguments: string}>, text: string }}
 *   calls  —— 解析出的调用（arguments 是 JSON 字符串，符合 OpenAI 形状）
 *   text   —— 去掉 DSML 块之后剩下的正文
 */
export function parseDsmlCalls(raw) {
  const src = String(raw ?? '');
  const startIdx = src.indexOf(DSML_START);
  if (startIdx < 0) return { calls: [], text: src };

  const endIdx = src.indexOf(DSML_END, startIdx);
  const blockEnd = endIdx < 0 ? src.length : endIdx + DSML_END.length;
  const block = src.slice(startIdx, blockEnd);
  const text = (src.slice(0, startIdx) + src.slice(blockEnd)).trim();

  const calls = [];
  INVOKE_RE.lastIndex = 0;
  let m;
  while ((m = INVOKE_RE.exec(block)) !== null) {
    const name = m[1];
    const inner = m[2];
    const args = {};
    PARAM_RE.lastIndex = 0;
    let pm;
    while ((pm = PARAM_RE.exec(inner)) !== null) {
      const key = pm[1];
      const stringFlag = pm[2];
      const value = pm[3];
      if (stringFlag === 'false') {
        try {
          args[key] = JSON.parse(value);
        } catch {
          args[key] = value; // 上游标了非字符串但给的不是合法 JSON —— 按原文保留
        }
      } else {
        args[key] = value;
      }
    }
    calls.push({ name, arguments: JSON.stringify(args) });
  }
  return { calls, text };
}

/** 文本里是否含 DSML 起始标记 */
export function hasDsml(text) {
  return typeof text === 'string' && text.includes(DSML_START);
}

/**
 * 流式改写器。
 *
 * 用法：
 *   const rw = new DsmlStreamRewriter({ onEvent })
 *   rw.push(textDelta)   // 每收到一段正文就喂进来
 *   rw.flush()           // 流结束时调用，返回剩余要作为正文发出的文本
 *
 * onEvent(kind, payload)：
 *   'text'   —— 正常正文（payload 是字符串）
 *   'call'   —— 一个工具调用（payload 是 {name, arguments}）
 *
 * 关键点：因为标记可能被拆到多个 chunk 里，正文末尾要**回退**一段
 * （最多 DSML_START.length - 1 个字符）暂不发出去，直到确认它不是标记前缀。
 */
export class DsmlStreamRewriter {
  #emit;
  /** 已收到、尚未判定归属的尾巴 */
  #pending = '';
  /** 是否已进入 DSML 块（收到 START、还没收到 END） */
  #inBlock = false;
  /** DSML 块内容（含起止标记） */
  #block = '';

  constructor({ onEvent } = {}) {
    this.#emit = typeof onEvent === 'function' ? onEvent : () => {};
  }

  /** 当前是否处于 DSML 块内部 */
  get inBlock() {
    return this.#inBlock;
  }

  push(delta) {
    if (typeof delta !== 'string' || delta === '') return;
    if (this.#inBlock) {
      this.#block += delta;
      const end = this.#block.indexOf(DSML_END);
      if (end >= 0) this.#finishBlock();
      return;
    }

    this.#pending += delta;
    const start = this.#pending.indexOf(DSML_START);
    if (start >= 0) {
      // 标记之前的内容照常发出去
      const before = this.#pending.slice(0, start);
      if (before) this.#emit('text', before);
      this.#block = this.#pending.slice(start);
      this.#pending = '';
      this.#inBlock = true;
      if (this.#block.indexOf(DSML_END) >= 0) this.#finishBlock();
      return;
    }

    // 没看到完整标记 —— 但尾巴可能是标记的**前缀**，先留住。
    //
    // 注意：不能拿整段待判定内容去比 startsWith —— 它前面往往已经混进了正常
    // 正文。要逐长度检查"后缀"，取最长的那个既是后缀又是 DSML_START 前缀的部分。
    let keep = 0;
    const maxKeep = Math.min(DSML_START.length - 1, this.#pending.length);
    for (let n = maxKeep; n > 0; n -= 1) {
      if (DSML_START.startsWith(this.#pending.slice(this.#pending.length - n))) {
        keep = n;
        break;
      }
    }
    const safe = keep === 0 ? this.#pending : this.#pending.slice(0, this.#pending.length - keep);
    this.#pending = keep === 0 ? '' : this.#pending.slice(this.#pending.length - keep);
    if (safe) this.#emit('text', safe);
  }

  /** 流结束：把还没发出去的内容按实际情况发掉（不丢数据） */
  flush() {
    if (this.#inBlock) {
      // 块没闭合 —— 说明上游中途断了或格式不同。原样当正文发，绝不吞内容。
      const raw = this.#block;
      this.#block = '';
      this.#inBlock = false;
      if (raw) this.#emit('text', raw);
      return;
    }
    if (this.#pending) {
      const raw = this.#pending;
      this.#pending = '';
      this.#emit('text', raw);
    }
  }

  #finishBlock() {
    const raw = this.#block;
    this.#block = '';
    this.#inBlock = false;
    const { calls, text } = parseDsmlCalls(raw);
    if (text) this.#emit('text', text);
    for (const call of calls) this.#emit('call', call);
    // 块之后若还有残留（比如多个块连着），继续按普通正文处理
    if (!calls.length) this.#emit('text', raw);
  }
}

/**
 * 把上游 SSE 转发给客户端，同时把 DSML 工具调用归一化成标准 `tool_calls` delta。
 *
 * 行为约定：
 *   - 没有 DSML 时与原 `body.pipe(res)` 等价：正文逐段原样转发（只是末尾可能
 *     回退几个字符用于判断标记前缀）；
 *   - 带 `finish_reason` 的 chunk 先扣住，收尾时再发 —— 因为上游的 finish 会
 *     早于我们解析出调用，直接转发会得到"先结束、后调用"的顺序；
 *   - 产出过调用时把 finish_reason 改成 `tool_calls`（否则 Harness 会当成
 *     回答结束而不是要执行工具）；
 *   - 任何异常/截断都不吞内容：未闭合的 DSML 块原样当正文发出。
 *
 * @param {AsyncIterable<Buffer|string>} body 上游响应体
 * @param {{ write: Function, end: Function, writable?: boolean }} res 目标响应
 * @param {object} [logger] 可选，需有 warn()
 * @param {{ randomId?: () => string }} [options] 便于测试注入 id 生成
 */
export async function pipeUpstreamSse(body, res, logger, options = {}) {
  const makeId = options.randomId ?? (() => randomUUID().replace(/-/gu, '').slice(0, 24));
  let buffer = '';
  let heldFinish = null;
  let madeCalls = false;
  let callSeq = 0;
  let sawDone = false;
  let textDeltas = 0;
  let eventCount = 0;
  const samples = [];
  const envelope = { id: 'chatcmpl-workbuddy', model: 'unknown' };

  const chunk = (delta, finishReason = null) => ({
    id: envelope.id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1e3),
    model: envelope.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
  const write = (obj) => {
    if (res.writable !== false) res.write('data: ' + JSON.stringify(obj) + '\n\n');
  };
  const writeDelta = (delta) => {
    if (typeof delta?.content === 'string') textDeltas += 1;
    write(chunk(delta));
  };

  const emitCall = (name, argsString) => {
    madeCalls = true;
    callSeq += 1;
    writeDelta({
      tool_calls: [{
        index: callSeq - 1,
        id: `call_${makeId()}`,
        type: 'function',
        function: { name, arguments: argsString },
      }],
    });
  };

  const rewriter = new DsmlStreamRewriter({
    onEvent: (kind, payload) => {
      if (kind === 'text') return writeDelta({ content: payload });
      emitCall(payload.name, payload.arguments);
    },
  });

  const handleEvent = (event) => {
    eventCount += 1;
    // 留前两条原始事件用于诊断"上游到底发了什么形状"
    if (samples.length < 2 && event.trim() !== '') samples.push(event.trim().slice(0, 400));
    const dataLines = event.split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) {
      if (res.writable !== false && event.trim() !== '') res.write(event + '\n\n');
      return;
    }
    const data = dataLines.join('\n');
    if (data === '[DONE]') {
      sawDone = true;
      return; // 收尾时由我们自己发
    }
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      if (res.writable !== false) res.write(event + '\n\n');
      return;
    }
    if (parsed?.id !== undefined) envelope.id = parsed.id;
    if (parsed?.model !== undefined) envelope.model = parsed.model;
    const choice = parsed?.choices?.[0];
    if (choice === undefined) {
      if (res.writable !== false) res.write(event + '\n\n');
      return;
    }
    const delta = choice.delta ?? {};
    const finish = choice.finish_reason ?? null;
    // 有些上游在 stream=true 时仍然回**非流式**形状（choices[0].message）。
    // 原样转发的话 pi-ai 只认 delta，会解析出空消息 —— DSH 报
    // "returned a completed response with no content"。这里把它翻译成 delta。
    const message = choice.message;
    if (message !== null && typeof message === 'object' && choice.delta === undefined) {
      if (typeof message.content === 'string' && message.content !== '') rewriter.push(message.content);
      for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
        if (typeof call?.function?.name === 'string') {
          emitCall(call.function.name, typeof call.function.arguments === 'string' ? call.function.arguments : JSON.stringify(call.function.arguments ?? {}));
        }
      }
      if (finish !== null) heldFinish = finish;
      return;
    }
    // 纯正文 delta 交给改写器；带 tool_calls 的 delta 原样转发
    if (typeof delta.content === 'string' && delta.tool_calls === undefined) {
      if (typeof delta.role === 'string') writeDelta({ role: delta.role });
      if (delta.content !== '') rewriter.push(delta.content);
      if (finish !== null) heldFinish = finish;
      return;
    }
    if (finish !== null) {
      heldFinish = finish;
      return;
    }
    if (res.writable !== false) res.write(event + '\n\n');
  };

  try {
    for await (const piece of body) {
      buffer += piece.toString('utf8');
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        const event = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handleEvent(event);
        index = buffer.indexOf('\n\n');
      }
    }
    if (buffer.trim() !== '') handleEvent(buffer);
  } catch (error) {
    logger?.warn?.('dsh-workbuddy-xdpool: 转发上游流时出错', error);
  }
  rewriter.flush();
  if (madeCalls) {
    write(chunk({}, 'tool_calls'));
  } else if (heldFinish !== null) {
    write(chunk({}, heldFinish));
  } else if (!sawDone) {
    write(chunk({}, 'stop'));
  }
  if (res.writable !== false) res.end('data: [DONE]\n\n');
  // 观测点：没有这个就只能靠猜"到底转发出了什么"
  try {
    options.summary?.({
      calls: callSeq,
      textDeltas,
      events: eventCount,
      samples,
      finish: madeCalls ? 'tool_calls' : (heldFinish ?? (sawDone ? 'upstream-done' : 'stop')),
      upstreamDone: sawDone,
    });
  } catch { /* 观测不能影响主流程 */ }
}
