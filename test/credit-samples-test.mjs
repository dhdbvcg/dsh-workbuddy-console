/**
 * 余额差值采集自检。
 *
 * 核心：签到入账与对话消耗必须分开统计，
 * 否则「净值」会被当成消耗，数字完全错。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-credits-'));
process.env.WB_CONSOLE_DATA_DIR = TMP;

const cs = await import('../lib/credit-samples.mjs');

let pass = 0;
let fail = 0;
/** 支持同步与异步用例 */
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

/** 直接写样本（绕过 recordSample 的时间戳限制） */
function write(rows) {
  fs.writeFileSync(cs.sampleFile(), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

const NOW = Date.now();
const DAY = 86400000;

console.log('\n基础');

await t('初始无文件时返回空', () => {
  assert.deepEqual(cs.readSamples(), []);
});

await t('记录样本', () => {
  const r = cs.recordSample(
    [
      { uid: 'a', nickname: 'A', credit: 100 },
      { uid: 'b', nickname: 'B', credit: 200 },
    ],
    { minGapMs: 0 },
  );
  assert.equal(r.ok, true);
  assert.equal(r.written, 2);
  assert.equal(cs.readSamples().length, 2);
});

await t('去重：间隔过短且余额未变时不重复写入', () => {
  cs.clearSamples();
  const batch = [{ uid: 'a', nickname: 'A', credit: 100 }];
  const r1 = cs.recordSample(batch, { minGapMs: 3000 });
  const r2 = cs.recordSample(batch, { minGapMs: 3000 });
  assert.equal(r1.written, 1);
  assert.equal(r2.written, 0, '第二次应被去重跳过');
  assert.equal(r2.skipped, true);
  assert.equal(cs.readSamples().length, 1, '文件里只应有一条');
});

await t('去重：余额变化时必须记录（不能把真实变化也吞掉）', () => {
  cs.clearSamples();
  cs.recordSample([{ uid: 'a', nickname: 'A', credit: 100 }], { minGapMs: 3000 });
  const r = cs.recordSample([{ uid: 'a', nickname: 'A', credit: 50 }], { minGapMs: 3000 });
  assert.equal(r.written, 1, '余额变了就要记，否则会漏掉消耗');
  assert.equal(cs.readSamples().length, 2);
});

await t('去重：间隔足够长时即使余额未变也记录', () => {
  cs.clearSamples();
  cs.recordSample([{ uid: 'a', nickname: 'A', credit: 100 }], { minGapMs: 0 });
  const r = cs.recordSample([{ uid: 'a', nickname: 'A', credit: 100 }], { minGapMs: 0 });
  assert.equal(r.written, 1, 'minGapMs=0 时不做去重');
  assert.equal(cs.readSamples().length, 2);
});

await t('去重：账号集合变化时不跳过', () => {
  cs.clearSamples();
  cs.recordSample([{ uid: 'a', nickname: 'A', credit: 100 }], { minGapMs: 3000 });
  const r = cs.recordSample(
    [
      { uid: 'a', nickname: 'A', credit: 100 },
      { uid: 'b', nickname: 'B', credit: 200 },
    ],
    { minGapMs: 3000 },
  );
  assert.equal(r.written, 2, '多了一个账号，不能被当成重复');
});

await t('非法 credit 被过滤', () => {
  cs.clearSamples();
  const r = cs.recordSample(
    [
      { uid: 'a', nickname: 'A', credit: 100 },
      { uid: 'b', nickname: 'B', credit: 'not-a-number' },
    ],
    { minGapMs: 0 },
  );
  assert.equal(r.written, 1, '非数字应被丢掉');
});

await t('测试环境未指定数据目录时拒绝写入（防污染真实数据）', async () => {
  // 这个断言依赖 WB_CI 与 WB_CONSOLE_DATA_DIR 的组合，单独用子进程验证更可靠
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(
    process.execPath,
    [
      '-e',
      `
      process.env.WB_CI = '1';
      delete process.env.WB_CONSOLE_DATA_DIR;
      const m = await import(${JSON.stringify(new URL('../lib/credit-samples.mjs', import.meta.url).href)});
      const out = m.recordSample([{ uid: 'x', nickname: 'X', credit: 1 }]);
      console.log(JSON.stringify({ ok: out.ok, error: out.error || '' }));
      `,
    ],
    { encoding: 'utf8' },
  );
  const line = (r.stdout || '').trim().split('\n').pop();
  const parsed = JSON.parse(line);
  assert.equal(parsed.ok, false, '未指定数据目录时必须拒绝写入');
  assert.match(parsed.error, /拒绝写入/);
});

console.log('\n差值计算');

await t('余额下降＝消耗', () => {
  cs.clearSamples();
  write([
    { ts: NOW - 3 * DAY, day: 'd1', uid: 'a', nickname: 'A', credit: 500 },
    { ts: NOW - 2 * DAY, day: 'd2', uid: 'a', nickname: 'A', credit: 450 },
  ]);
  const s = cs.summarizeSamples({ days: 7 });
  assert.equal(s.spent, 50);
  assert.equal(s.gained, 0);
});

await t('余额上升＝入账（不是负消耗）', () => {
  cs.clearSamples();
  write([
    { ts: NOW - 3 * DAY, day: 'd1', uid: 'a', nickname: 'A', credit: 500 },
    { ts: NOW - 2 * DAY, day: 'd2', uid: 'a', nickname: 'A', credit: 600 },
  ]);
  const s = cs.summarizeSamples({ days: 7 });
  assert.equal(s.spent, 0, '上升不应算成消耗');
  assert.equal(s.gained, 100);
});

// 这是本模块存在的理由：签到 +100 后又花了 30，净值是 +70，
// 若把净值当消耗就完全错了。
await t('入账与消耗分开统计（签到 +100 后消费 30）', () => {
  cs.clearSamples();
  write([
    { ts: NOW - 3 * DAY, day: 'd1', uid: 'a', nickname: 'A', credit: 500 },
    { ts: NOW - 2 * DAY, day: 'd2', uid: 'a', nickname: 'A', credit: 600 }, // 签到 +100
    { ts: NOW - 1 * DAY, day: 'd3', uid: 'a', nickname: 'A', credit: 570 }, // 消费 -30
  ]);
  const s = cs.summarizeSamples({ days: 7 });
  assert.equal(s.spent, 30, '消耗应为 30，而不是净值');
  assert.equal(s.gained, 100, '入账应为 100');
  assert.equal(s.net, 70, '净值 = 100 - 30');
});

await t('多账号分别汇总后再合计', () => {
  cs.clearSamples();
  write([
    { ts: NOW - 2 * DAY, day: 'd1', uid: 'a', nickname: 'A', credit: 500 },
    { ts: NOW - 1 * DAY, day: 'd2', uid: 'a', nickname: 'A', credit: 480 },
    { ts: NOW - 2 * DAY, day: 'd1', uid: 'b', nickname: 'B', credit: 300 },
    { ts: NOW - 1 * DAY, day: 'd2', uid: 'b', nickname: 'B', credit: 250 },
  ]);
  const s = cs.summarizeSamples({ days: 7 });
  assert.equal(s.spent, 70, '20 + 50');
  assert.equal(s.perAccount.length, 2);
  assert.equal(s.perAccount[0].uid, 'b', '应按消耗降序');
});

await t('同一时刻的重复采样只取最后一条（防抖动）', () => {
  cs.clearSamples();
  const sameTs = NOW - DAY;
  write([
    { ts: sameTs, day: 'd1', uid: 'a', nickname: 'A', credit: 500 },
    { ts: sameTs, day: 'd1', uid: 'a', nickname: 'A', credit: 400 },
    { ts: sameTs, day: 'd1', uid: 'a', nickname: 'A', credit: 450 },
  ]);
  const s = cs.summarizeSamples({ days: 7 });
  assert.equal(s.spent, 0, '同一时刻的抖动不应被算成消耗');
});

await t('单点样本不产生消耗', () => {
  cs.clearSamples();
  write([{ ts: NOW - DAY, day: 'd1', uid: 'a', nickname: 'A', credit: 500 }]);
  const s = cs.summarizeSamples({ days: 7 });
  assert.equal(s.spent, 0);
  assert.equal(s.gained, 0);
  assert.equal(s.perAccount[0].samples, 1);
});

await t('排序打乱的样本也能正确处理', () => {
  cs.clearSamples();
  write([
    { ts: NOW - 1 * DAY, day: 'd3', uid: 'a', nickname: 'A', credit: 450 },
    { ts: NOW - 3 * DAY, day: 'd1', uid: 'a', nickname: 'A', credit: 500 },
    { ts: NOW - 2 * DAY, day: 'd2', uid: 'a', nickname: 'A', credit: 480 },
  ]);
  const s = cs.summarizeSamples({ days: 7 });
  // 500 -> 480 -> 450 = 50
  assert.equal(s.spent, 50, '必须先按时间排序');
});

await t('days 窗口过滤旧数据', () => {
  cs.clearSamples();
  write([
    { ts: NOW - 100 * DAY, day: 'old', uid: 'a', nickname: 'A', credit: 1000 },
    { ts: NOW - 99 * DAY, day: 'old2', uid: 'a', nickname: 'A', credit: 1 },
    { ts: NOW - 1 * DAY, day: 'new', uid: 'a', nickname: 'A', credit: 500 },
  ]);
  const s = cs.summarizeSamples({ days: 7 });
  assert.equal(s.spent, 0, '窗口外的大额变动不应计入');
});

await t('空数据返回零值而不是崩溃', () => {
  cs.clearSamples();
  const s = cs.summarizeSamples({ days: 7 });
  assert.equal(s.ok, true);
  assert.equal(s.spent, 0);
  assert.equal(s.samples, 0);
});

console.log('\n容错与维护');

await t('损坏行被跳过', () => {
  cs.clearSamples();
  write([{ ts: NOW - DAY, day: 'd1', uid: 'a', nickname: 'A', credit: 500 }]);
  fs.appendFileSync(cs.sampleFile(), '{ broken json\n', 'utf8');
  assert.equal(cs.readSamples().length, 1);
});

await t('prune 丢弃超期样本', () => {
  cs.clearSamples();
  write([
    { ts: NOW - 200 * DAY, day: 'old', uid: 'a', nickname: 'A', credit: 1 },
    { ts: NOW - 1 * DAY, day: 'new', uid: 'a', nickname: 'A', credit: 2 },
  ]);
  const r = cs.pruneSamples();
  assert.equal(r.ok, true);
  assert.equal(r.dropped, 1);
  assert.equal(cs.readSamples().length, 1);
});

await t('clear 清空文件', () => {
  cs.clearSamples();
  assert.equal(cs.readSamples().length, 0);
  assert.ok(!fs.existsSync(cs.sampleFile()));
});

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
