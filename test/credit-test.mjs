/**
 * 积分采集自检。
 *
 * 重点验证 SSE 解析：帧被 chunk 切断是最容易出错的地方。
 */
import assert from 'node:assert/strict';
import * as cm from '../lib/credit-meter.mjs';
import { Readable } from 'node:stream';

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  OK   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message);
    fail++;
  }
}

const { extractCreditFromChunk } = cm._internal;

console.log('\nSSE 解析');

await t('从完整 usage 帧取 credit', () => {
  const frame = 'data: {"usage":{"prompt_tokens":17,"credit":0.08}}\n\n';
  assert.equal(extractCreditFromChunk(frame), 0.08);
});

await t('credit 为 0 时返回 0（不是 null）', () => {
  const frame = 'data: {"usage":{"credit":0}}\n\n';
  assert.equal(extractCreditFromChunk(frame), 0, '0 是有效值，不能被当成「没找到」');
});

await t('无 usage 的普通帧返回 null', () => {
  assert.equal(extractCreditFromChunk('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'), null);
});

await t('[DONE] 帧安全跳过', () => {
  assert.equal(extractCreditFromChunk('data: [DONE]\n\n'), null);
});

await t('半截 JSON 不抛异常', () => {
  assert.equal(extractCreditFromChunk('data: {"usage":{"credit":0.0'), null);
});

await t('多个帧时取最后一个 credit', () => {
  const s = 'data: {"usage":{"credit":0.01}}\n\ndata: {"usage":{"credit":0.05}}\n\n';
  assert.equal(extractCreditFromChunk(s), 0.05);
});

await t('非数字 credit 被忽略', () => {
  assert.equal(extractCreditFromChunk('data: {"usage":{"credit":"0.08"}}\n\n'), null);
  assert.equal(extractCreditFromChunk('data: {"usage":{"credit":null}}\n\n'), null);
});

console.log('\n累加');

await t('同一会话多次累加', () => {
  cm.reset();
  cm.recordCredit('s1', 0.01);
  cm.recordCredit('s1', 0.02);
  const v = cm.getCredit('s1');
  assert.equal(v.credit, 0.03);
  assert.equal(v.calls, 2);
});

await t('不同会话互不影响', () => {
  cm.reset();
  cm.recordCredit('a', 0.5);
  cm.recordCredit('b', 0.25);
  assert.equal(cm.getCredit('a').credit, 0.5);
  assert.equal(cm.getCredit('b').credit, 0.25);
});

await t('浮点累加不产生 0.30000000000000004', () => {
  cm.reset();
  cm.recordCredit('f', 0.1);
  cm.recordCredit('f', 0.2);
  assert.equal(cm.getCredit('f').credit, 0.3, '实际: ' + cm.getCredit('f').credit);
});

await t('0 也会计入调用次数', () => {
  cm.reset();
  cm.recordCredit('z', 0);
  const v = cm.getCredit('z');
  assert.equal(v.credit, 0);
  assert.equal(v.calls, 1, '免费模型的调用也应计数');
});

await t('非法值被拒绝', () => {
  cm.reset();
  cm.recordCredit('x', NaN);
  cm.recordCredit('x', -1);
  cm.recordCredit('x', Infinity);
  assert.equal(cm.getCredit('x').calls, 0);
});

await t('未知会话返回零值而不是 undefined', () => {
  cm.reset();
  const v = cm.getCredit('never-seen');
  assert.equal(v.credit, 0);
  assert.equal(v.calls, 0);
});

console.log('\n流旁听');

await t('数据原样透传（不改写任何字节）', async () => {
  cm.reset();
  const frames =
    'data: {"choices":[{"delta":{"content":"你"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"好"}}]}\n\n' +
    'data: {"usage":{"credit":0.07}}\n\n' +
    'data: [DONE]\n\n';
  const src = Readable.from([Buffer.from(frames, 'utf8')]);
  const spy = await cm.teeForCredit(src, { sessionId: 'stream1' });

  const out = [];
  await new Promise((resolve, reject) => {
    spy.on('data', (c) => out.push(c));
    spy.on('end', resolve);
    spy.on('error', reject);
  });

  const got = Buffer.concat(out).toString('utf8');
  assert.equal(got, frames, '透传内容必须与输入完全一致');
  assert.equal(cm.getCredit('stream1').credit, 0.07, '应采集到 credit');
});

await t('帧被切成多个 chunk 时仍能解析', async () => {
  cm.reset();
  const full = 'data: {"usage":{"credit":0.09}}\n\n';
  // 故意在 JSON 中间切断
  const parts = [full.slice(0, 10), full.slice(10, 25), full.slice(25)];
  const src = Readable.from(parts.map((s) => Buffer.from(s, 'utf8')));
  const spy = await cm.teeForCredit(src, { sessionId: 'split' });

  await new Promise((resolve, reject) => {
    spy.on('data', () => {});
    spy.on('end', resolve);
    spy.on('error', reject);
  });
  assert.equal(cm.getCredit('split').credit, 0.09, '跨 chunk 的帧应能拼回来');
});

await t('空流不报错', async () => {
  cm.reset();
  const src = Readable.from([]);
  const spy = await cm.teeForCredit(src, { sessionId: 'empty' });
  await new Promise((resolve, reject) => {
    spy.on('data', () => {});
    spy.on('end', resolve);
    spy.on('error', reject);
  });
  assert.equal(cm.getCredit('empty').calls, 0);
});

await t('畸形输入不影响流透传', async () => {
  cm.reset();
  const junk = 'garbage not sse at all\n\nmoar junk\n';
  const src = Readable.from([Buffer.from(junk, 'utf8')]);
  const spy = await cm.teeForCredit(src, { sessionId: 'junk' });
  const out = [];
  await new Promise((resolve, reject) => {
    spy.on('data', (c) => out.push(c));
    spy.on('end', resolve);
    spy.on('error', reject);
  });
  assert.equal(Buffer.concat(out).toString('utf8'), junk);
});

await t('onCredit 回调抛异常不影响流', async () => {
  cm.reset();
  const frames = 'data: {"usage":{"credit":0.02}}\n\n';
  const src = Readable.from([Buffer.from(frames, 'utf8')]);
  const spy = await cm.teeForCredit(src, {
    sessionId: 'cb',
    onCredit: () => {
      throw new Error('回调故意抛错');
    },
  });
  const out = [];
  await new Promise((resolve, reject) => {
    spy.on('data', (c) => out.push(c));
    spy.on('end', resolve);
    spy.on('error', reject);
  });
  assert.equal(Buffer.concat(out).toString('utf8'), frames, '回调出错不应打断流');
  assert.equal(cm.getCredit('cb').credit, 0.02, '采集仍应成功');
});

await t('流结束后 activeStreams 归零', async () => {
  cm.reset();
  const src = Readable.from([Buffer.from('data: [DONE]\n\n')]);
  const spy = await cm.teeForCredit(src, { sessionId: 'c1' });
  await new Promise((resolve) => {
    spy.on('data', () => {});
    spy.on('end', resolve);
  });
  assert.equal(cm.stats().activeStreams, 0);
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
