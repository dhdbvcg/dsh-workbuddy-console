/**
 * 历史记录自检。
 *
 * 用临时数据目录，不碰真实历史。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 必须在 import 模块前设置数据目录（模块读取 env 决定路径）
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-history-'));
process.env.WB_CONSOLE_DATA_DIR = TMP;

const hist = await import('../lib/history.mjs');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message);
    fail++;
  }
}

console.log('\n基础');

t('historyFile 落在指定数据目录', () => {
  assert.equal(hist.historyFile(), path.join(TMP, 'history.jsonl'));
});

t('初始无文件时 readAll 返回空数组', () => {
  assert.deepEqual(hist.readAll(), []);
});

t('dayKey 用本地时区', () => {
  const k = hist.dayKey(new Date(2026, 9, 1, 23, 30).getTime());
  assert.equal(k, '2026-10-01');
});

console.log('\n写入与读取');

t('记录一批快照', () => {
  const r = hist.recordSnapshot([
    { uid: 'u1', nickname: 'A', credit: 100, checkedIn: true, streakDays: 3, source: 'checkin' },
    { uid: 'u2', nickname: 'B', credit: 200, checkedIn: false, streakDays: 1, source: 'load' },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.written, 2);
});

t('读回的内容与写入一致', () => {
  const all = hist.readAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].uid, 'u1');
  assert.equal(all[0].credit, 100);
  assert.equal(all[0].checkedIn, true);
  assert.equal(all[1].nickname, 'B');
});

t('空数组写入不产生记录', () => {
  const before = hist.readAll().length;
  hist.recordSnapshot([]);
  assert.equal(hist.readAll().length, before);
});

t('字段缺失时不崩溃，转成安全默认值', () => {
  hist.recordSnapshot([{ uid: 'u3' }]);
  const all = hist.readAll();
  const last = all[all.length - 1];
  assert.equal(last.uid, 'u3');
  assert.equal(last.credit, 0);
  assert.equal(last.checkedIn, false);
  assert.equal(last.source, 'unknown');
});

console.log('\n容错');

t('损坏行被跳过，不影响其余记录', () => {
  const before = hist.readAll().length;
  fs.appendFileSync(hist.historyFile(), '{ this is not json }\n', 'utf8');
  const after = hist.readAll();
  assert.equal(after.length, before, '损坏行不应计入');
});

t('末尾半行（写入中断）被跳过', () => {
  const before = hist.readAll().length;
  fs.appendFileSync(hist.historyFile(), '{"ts":1,"day":"2026-10-01","uid":"trunc"', 'utf8');
  assert.equal(hist.readAll().length, before);
});

console.log('\n聚合');

t('同一天同一账号多次记录只算最后一次（不重复计数）', () => {
  hist.clear();
  const now = Date.now();
  // 同一账号同一天写三次，积分递增
  hist.recordSnapshot([{ uid: 'u1', nickname: 'A', credit: 100 }]);
  hist.recordSnapshot([{ uid: 'u1', nickname: 'A', credit: 150 }]);
  hist.recordSnapshot([{ uid: 'u1', nickname: 'A', credit: 180 }]);

  const s = hist.summarize({ days: 30 });
  assert.equal(s.series.length, 1, '应只有一天');
  assert.equal(s.series[0].credit, 180, '应取最后一次而不是求和（540）');
  assert.equal(s.series[0].accounts, 1);
});

t('多账号当天积分求和', () => {
  hist.clear();
  hist.recordSnapshot([
    { uid: 'u1', nickname: 'A', credit: 100, checkedIn: true },
    { uid: 'u2', nickname: 'B', credit: 250, checkedIn: true },
  ]);
  const s = hist.summarize({ days: 30 });
  assert.equal(s.series[0].credit, 350);
  assert.equal(s.series[0].accounts, 2);
  assert.equal(s.series[0].checkedIn, 2);
});

t('按账号汇总：统计观察天数与签到天数', () => {
  hist.clear();
  const d1 = hist.dayKey(Date.now());
  hist.recordSnapshot([{ uid: 'u1', nickname: 'A', credit: 100, checkedIn: true }]);
  const s = hist.summarize({ days: 30 });
  const a = s.accounts.find((x) => x.uid === 'u1');
  assert.ok(a, '应有 u1');
  assert.equal(a.checkedInDays, 1);
  assert.ok(a.observedDays >= 1);
  assert.equal(a.lastCredit, 100);
  assert.equal(a.lastDay, d1);
});

t('days 参数过滤掉窗口外的老记录', () => {
  hist.clear();
  // 手写一条 100 天前的记录
  const old = { ts: Date.now() - 100 * 86400000, day: hist.dayKey(Date.now() - 100 * 86400000), uid: 'old', nickname: 'Old', credit: 999 };
  fs.writeFileSync(hist.historyFile(), JSON.stringify(old) + '\n', 'utf8');
  hist.recordSnapshot([{ uid: 'new', nickname: 'New', credit: 50 }]);

  const s = hist.summarize({ days: 30 });
  assert.equal(s.series.length, 1, '只应剩今天');
  assert.equal(s.series[0].credit, 50, '不应包含 100 天前的 999');
  assert.equal(s.totalRecords, 2, 'totalRecords 反映文件总量');
});

console.log('\n裁剪');

t('prune 丢弃窗口外记录', () => {
  hist.clear();
  const oldDay = hist.dayKey(Date.now() - 200 * 86400000);
  fs.writeFileSync(
    hist.historyFile(),
    JSON.stringify({ ts: 1, day: oldDay, uid: 'old', credit: 1 }) + '\n' +
      JSON.stringify({ ts: 2, day: hist.dayKey(Date.now()), uid: 'now', credit: 2 }) + '\n',
    'utf8',
  );
  const r = hist.prune();
  assert.equal(r.ok, true);
  assert.equal(r.dropped, 1);
  assert.equal(hist.readAll().length, 1);
});

t('prune 后文件仍是合法 JSONL', () => {
  const all = hist.readAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].uid, 'now');
});

console.log('\n清空');

t('clear 删除文件', () => {
  hist.clear();
  assert.equal(hist.readAll().length, 0);
  assert.ok(!fs.existsSync(hist.historyFile()));
});

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
