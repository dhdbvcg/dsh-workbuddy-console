/**
 * DSML 工具调用解析 / 流式改写。
 *
 * 背景：WorkBuddy 网关对部分新模型不返回结构化 tool_calls，而是把 DSML
 * 写进正文，DSH 就当纯文本渲染出来了。这里验证解析器与流式改写器的行为，
 * 重点是**分块安全**（标记可能被拆到多个 SSE chunk 里）和**不丢数据**
 * （块没闭合时必须原样发出，绝不能吞掉内容）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { parseDsmlCalls, hasDsml, DsmlStreamRewriter, DSML_START, DSML_END, pipeUpstreamSse } from '../lib/dsml.mjs';

let total = 0;
let failed = 0;
const rows = [];
async function t(name, fn) {
  total++;
  try {
    await fn();
    rows.push(['OK  ', name]);
  } catch (e) {
    failed++;
    rows.push(['FAIL', name, e && e.message ? e.message : String(e)]);
  }
}

/** 真实抓到的样本（deepseek-v4.1-flash 经 WorkBuddy 网关返回的原文） */
const REAL = '先查看两个问题的相关代码：\n\n' +
  DSML_START + '\n' +
  '<\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} invoke name="pwsh">\n' +
  '<\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} parameter name="command" string="true">Select-String -Path calculator\\engine.py -Pattern "MAX_EXPONENT|溢出|overflow" | Select-Object -First 10\n' +
  '"---handwrite---"\n' +
  'Select-String -Path calculator\\handwrite\\evaluate.py -Pattern "MAX_EXPONENT|溢出" | Select-Object -First 10</\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} parameter>\n' +
  '<\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} parameter name="description" string="true">Find power limit code</\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} parameter>\n' +
  '<\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} parameter name="workdir" string="true">C:\\Users\\dell\\GitHub\\python-calculator</\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} parameter>\n' +
  '</\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} invoke>\n' +
  DSML_END;

const pipe = (text, sizes) => {
  const events = [];
  const rw = new DsmlStreamRewriter({ onEvent: (k, v) => events.push([k, v]) });
  let i = 0;
  let s = 0;
  while (i < text.length) {
    const n = sizes[s++ % sizes.length];
    rw.push(text.slice(i, i + n));
    i += n;
  }
  rw.flush();
  return events;
};

await t('识别 DSML 起始标记', () => {
  assert.equal(hasDsml(REAL), true);
  assert.equal(hasDsml('普通文本'), false);
});

await t('解析出 1 个 pwsh 调用，参数正确', () => {
  const { calls, text } = parseDsmlCalls(REAL);
  assert.equal(calls.length, 1, '应解析出 1 个调用');
  assert.equal(calls[0].name, 'pwsh');
  const args = JSON.parse(calls[0].arguments);
  assert.ok(args.command.includes('Select-String -Path calculator\\engine.py'), 'command 应完整保留');
  assert.ok(args.command.includes('"---handwrite---"'), '多行命令里的引号不能丢');
  assert.equal(args.description, 'Find power limit code');
  assert.equal(args.workdir, 'C:\\Users\\dell\\GitHub\\python-calculator');
  assert.equal(text, '先查看两个问题的相关代码：', 'DSML 之前的正文要保留、块本身要移除');
});

await t('流式：整段一次喂 → 先正文后调用', () => {
  const ev = pipe(REAL, [REAL.length]);
  assert.deepEqual(ev.filter(([k]) => k === 'text').map(([, v]) => v).join(''), '先查看两个问题的相关代码：\n\n');
  const calls = ev.filter(([k]) => k === 'call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].name, 'pwsh');
});

await t('流式：逐字符喂也不泄漏标记、不丢参数', () => {
  const ev = pipe(REAL, [1]);
  const texts = ev.filter(([k]) => k === 'text').map(([, v]) => v).join('');
  assert.ok(!texts.includes('DSML'), '正文里不能漏出 DSML 标记：' + JSON.stringify(texts.slice(-80)));
  assert.equal(texts, '先查看两个问题的相关代码：\n\n');
  const calls = ev.filter(([k]) => k === 'call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].name, 'pwsh');
});

await t('流式：1/3/7 字符混合切分结果与整段一致', () => {
  const a = pipe(REAL, [REAL.length]);
  const b = pipe(REAL, [1, 3, 7]);
  const norm = (ev) => JSON.stringify({
    text: ev.filter(([k]) => k === 'text').map(([, v]) => v).join(''),
    calls: ev.filter(([k]) => k === 'call').map(([, v]) => v),
  });
  assert.equal(norm(b), norm(a));
});

await t('没有 DSML 的正文原样通过（内容不变、无调用）', () => {
  const plain = '这是一段普通回答，没有工具调用。';
  const ev = pipe(plain, [1, 2, 5]);
  // 分块喂入会拆成多个 text 事件（SSE delta 本来就允许分段），
  // 但拼起来必须与原文逐字一致，且不能凭空产生调用。
  assert.equal(ev.filter(([k]) => k === 'call').length, 0, '不应产生调用');
  assert.equal(ev.filter(([k]) => k === 'text').map(([, v]) => v).join(''), plain);
});

await t('块未闭合（上游中途断）→ 原样作为正文发出，绝不吞内容', () => {
  const truncated = '开头\n' + DSML_START + '\n<\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} invoke name="pwsh">';
  const events = [];
  const rw = new DsmlStreamRewriter({ onEvent: (k, v) => events.push([k, v]) });
  rw.push(truncated);
  rw.flush();
  const texts = events.filter(([k]) => k === 'text').map(([, v]) => v).join('');
  assert.ok(texts.includes('开头'), '前面的正文要保留');
  assert.ok(texts.includes('invoke name="pwsh"'), '未闭合的块必须原样发出：' + JSON.stringify(texts.slice(-60)));
});

await t('多个 invoke → 多个调用', () => {
  const P = '\u{FF5C}';
  const two = DSML_START + '\n' +
    `<${P}${P}DSML${P}${P} invoke name="a"><${P}${P}DSML${P}${P} parameter name="x" string="true">1</${P}${P}DSML${P}${P} parameter></${P}${P}DSML${P}${P} invoke>\n` +
    `<${P}${P}DSML${P}${P} invoke name="b"><${P}${P}DSML${P}${P} parameter name="y" string="true">2</${P}${P}DSML${P}${P} parameter></${P}${P}DSML${P}${P} invoke>\n` +
    DSML_END;
  const { calls } = parseDsmlCalls(two);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].name, 'a');
  assert.deepEqual(JSON.parse(calls[0].arguments), { x: '1' });
  assert.equal(calls[1].name, 'b');
  assert.deepEqual(JSON.parse(calls[1].arguments), { y: '2' });
});

await t('string="false" 的参数按 JSON 解析', () => {
  const P = '\u{FF5C}';
  const one = DSML_START +
    `<${P}${P}DSML${P}${P} invoke name="t"><${P}${P}DSML${P}${P} parameter name="n" string="false">42</${P}${P}DSML${P}${P} parameter></${P}${P}DSML${P}${P} invoke>` +
    DSML_END;
  const { calls } = parseDsmlCalls(one);
  assert.deepEqual(JSON.parse(calls[0].arguments), { n: 42 });
});

await t('没有参数属性的参数按字符串处理', () => {
  const P = '\u{FF5C}';
  const one = DSML_START +
    `<${P}${P}DSML${P}${P} invoke name="t"><${P}${P}DSML${P}${P} parameter name="s">hi</${P}${P}DSML${P}${P} parameter></${P}${P}DSML${P}${P} invoke>` +
    DSML_END;
  const { calls } = parseDsmlCalls(one);
  assert.deepEqual(JSON.parse(calls[0].arguments), { s: 'hi' });
});

// ---------------------------------------------------------------------------
// 流式改造：pipeUpstreamSse —— 把上游 SSE 里的 DSML 换成标准 tool_calls delta
// ---------------------------------------------------------------------------

/** 伪造一个只记录写入的响应对象 */
function fakeRes() {
  const writes = [];
  return {
    writable: true,
    writes,
    write: (s) => { writes.push(String(s)); },
    end: (s) => { if (s) writes.push(String(s)); },
    /** 取出所有 SSE 事件的 data JSON */
    events() {
      return writes.join('').split('\n\n').filter(Boolean).map((e) => {
        const line = e.split('\n').find((l) => l.startsWith('data:'));
        if (!line) return null;
        const d = line.slice(5).trim();
        if (d === '[DONE]') return { done: true };
        try { return JSON.parse(d); } catch { return { raw: d }; }
      }).filter(Boolean);
    },
  };
}

/** 把一段文本切成若干 SSE chunk */
const sseChunks = (contents, extra = {}) => contents.map((c) =>
  'data: ' + JSON.stringify({
    id: 'chatcmpl-test', model: 'deepseek-v4.1-flash',
    choices: [{ index: 0, delta: { content: c }, finish_reason: null }],
  }) + '\n\n' + (extra.tail ?? ''));

const asBody = (parts) => (async function* () { for (const p of parts) yield Buffer.from(p); })();

await t('流式改造：DSML 被换成 tool_calls，finish_reason 改为 tool_calls', async () => {
  // 把整段 DSML 切成很多小片，模拟真实 SSE 逐 token 下发
  const pieces = [];
  for (let i = 0; i < REAL.length; i += 9) pieces.push(REAL.slice(i, i + 9));
  const body = asBody(sseChunks(pieces).concat([
    'data: ' + JSON.stringify({ id: 'chatcmpl-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
    'data: [DONE]\n\n',
  ]));
  const res = fakeRes();
  await pipeUpstreamSse(body, res, null, { randomId: () => 'fixed' });
  const events = res.events();

  // 正文里不能漏出 DSML
  const text = events.map((e) => e?.choices?.[0]?.delta?.content ?? '').join('');
  assert.ok(!text.includes('DSML'), '正文不能漏出 DSML：' + JSON.stringify(text.slice(-60)));
  assert.equal(text, '先查看两个问题的相关代码：\n\n');

  // 必须产出 tool_calls
  const callDeltas = events.flatMap((e) => e?.choices?.[0]?.delta?.tool_calls ?? []);
  assert.equal(callDeltas.length, 1, '应产出 1 个工具调用');
  assert.equal(callDeltas[0].type, 'function');
  assert.equal(callDeltas[0].function.name, 'pwsh');
  assert.ok(JSON.parse(callDeltas[0].function.arguments).command.includes('Select-String'));

  // finish_reason 必须被改写
  const finish = events.filter((e) => e?.choices?.[0]?.finish_reason).map((e) => e.choices[0].finish_reason);
  assert.deepEqual(finish, ['tool_calls'], 'finish_reason 应为 tool_calls，实际 ' + JSON.stringify(finish));

  // 必须以 [DONE] 结束
  assert.equal(events[events.length - 1].done, true);
  // 调用必须在结束之前
  const callAt = events.findIndex((e) => e?.choices?.[0]?.delta?.tool_calls);
  const finishAt = events.findIndex((e) => e?.choices?.[0]?.finish_reason);
  assert.ok(callAt >= 0 && callAt < finishAt, '工具调用必须早于 finish_reason');
});

await t('流式改造：没有 DSML 的响应 → 正文与 finish_reason 原样保留', async () => {
  const parts = ['你好', '，', '世界'];
  const body = asBody(sseChunks(parts).concat([
    'data: ' + JSON.stringify({ id: 'chatcmpl-test', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n',
  ]));
  const res = fakeRes();
  await pipeUpstreamSse(body, res, null, { randomId: () => 'fixed' });
  const events = res.events();
  assert.equal(events.map((e) => e?.choices?.[0]?.delta?.content ?? '').join(''), '你好，世界');
  assert.equal(events.some((e) => e?.choices?.[0]?.delta?.tool_calls), false, '不应产出调用');
  const finish = events.filter((e) => e?.choices?.[0]?.finish_reason).map((e) => e.choices[0].finish_reason);
  assert.deepEqual(finish, ['stop'], 'finish_reason 应保持 stop');
});

await t('流式改造：DSML 未闭合（上游截断）→ 原样作为正文，不丢内容', async () => {
  const truncated = '前缀\n' + DSML_START + '\n' + '\u{FF5C}\u{FF5C}DSML\u{FF5C}\u{FF5C} invoke name="pwsh">';
  const body = asBody(sseChunks([truncated]));
  const res = fakeRes();
  await pipeUpstreamSse(body, res, null, { randomId: () => 'fixed' });
  const events = res.events();
  const text = events.map((e) => e?.choices?.[0]?.delta?.content ?? '').join('');
  assert.ok(text.includes('前缀'), '前面的正文要保留');
  assert.ok(text.includes('invoke name="pwsh"'), '未闭合的块必须原样发出：' + JSON.stringify(text.slice(-80)));
  assert.equal(events.some((e) => e?.choices?.[0]?.delta?.tool_calls), false, '不应凭空产出调用');
});

await t('能消费真正的 Node Readable（与 Readable.fromWeb 同形态）', async () => {
  // 回归：真实上游体是 Readable（fromWeb）。若调用方在同一个流上再挂
  // body.on("data")，流会进入 flowing 模式、与 pipeUpstreamSse 的
  // `for await` 抢消费，结果只剩 finish + [DONE] —— DSH 报
  // `returned a completed response with no content`(EMPTY_RESPONSE)。
  const pieces = [];
  for (let i = 0; i < REAL.length; i += 11) pieces.push(REAL.slice(i, i + 11));
  const body = Readable.from(sseChunks(pieces).map((s) => Buffer.from(s)));
  const res = fakeRes();
  await pipeUpstreamSse(body, res, null, { randomId: () => 'fixed' });
  const events = res.events();
  assert.equal(events.flatMap((e) => e?.choices?.[0]?.delta?.tool_calls ?? []).length, 1, 'Readable 上也要解析出 1 个调用');
});

await t('源码守卫：serveSuccessfulStream 不得给 body 挂 data 监听', () => {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const vendor = path.resolve(here, '..', 'vendor', 'xdpool', 'lib', 'index.js');
  const src = fs.readFileSync(vendor, 'utf8');
  const at = src.indexOf('async function serveSuccessfulStream(');
  assert.ok(at > 0, '找不到 serveSuccessfulStream');
  let i = src.indexOf('{', at);
  let depth = 0;
  let end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(at, end + 1);
  // 先剥掉行注释，否则守卫会被"不能挂 body.on(data)"这类说明文字误伤
  const code = body.split('\n').map((l) => l.replace(/\/\/.*$/u, '')).join('\n');
  assert.ok(!/body\.on\(\s*["']data["']/.test(code), '不能再给 body 挂 data 监听（会与 for await 抢消费）');
  assert.ok(/pipeUpstreamSse\(/.test(code), '应调用 pipeUpstreamSse');
});

for (const [tag, name, err] of rows) {
  console.log('  ' + tag + ' ' + name + (err ? '\n         ' + err : ''));
}
console.log('\n结果：' + (total - failed) + ' 通过，' + failed + ' 失败');
process.exit(failed === 0 ? 0 : 1);
