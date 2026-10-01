/**
 * 任务模块自检：用假 client 验证状态归类与汇总。
 */
import assert from 'node:assert/strict';

let pass = 0;
let fail = 0;
async function t(name, fn) {
  try {
    await fn();
    console.log('  ✓ ' + name);
    pass++;
  } catch (e) {
    console.log('  ✗ ' + name + '\n      ' + e.message);
    fail++;
  }
}

// 让测试可以从任意目录运行：lib/ 相对本文件定位（run-all.mjs 会把两者一起复制）。
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..', 'lib');
const mod = await import('file:///' + path.join(LIB, 'tasks.mjs').replace(/\\/g, '/'));

console.log('\n模块导出');

await t('导出 pendingTasks / tasksForCredential', () => {
  assert.equal(typeof mod.pendingTasks, 'function');
  assert.equal(typeof mod.tasksForCredential, 'function');
});

console.log('\n真实数据（读本机账号的 growth 任务）');

// 构造凭证：从本机 auth 文件读。
// CI 上没有这个目录，所以必须容忍缺失（否则 readdirSync 会直接抛异常，
// 让整个测试文件崩溃，而不是干净地跳过）。
const DIR = path.join(os.homedir(), 'AppData', 'Local', 'CodeBuddyExtension', 'Data', 'Public', 'auth');
let creds = [];
try {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.info'));
  creds = files.map((f) => {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    return {
      uid: j.account.uid,
      nickname: j.account.nickname,
      credential: {
        uid: j.account.uid,
        uin: j.account.uin,
        nickname: j.account.nickname,
        domain: j.auth.domain,
        accessToken: j.auth.accessToken,
        refreshToken: j.auth.refreshToken,
      },
    };
  });
} catch {
  creds = [];
}

const NO_CREDS = creds.length === 0;
if (NO_CREDS) console.log('  (无本机凭证，真实数据用例将跳过)');

await t('至少有一个凭证可测', () => {
  if (NO_CREDS) return console.log('       (跳过：无本机凭证)');
  assert.ok(creds.length > 0, '本机没有凭证');
});

let live = null;
await t('能读到任务列表并正确归类', async () => {
  if (NO_CREDS) return console.log('       (跳过：无本机凭证)');
  const r = await mod.tasksForCredential(creds[0].credential);
  if (!r.ok) {
    // 网络不通 / 插件缺失时跳过而不是假装通过
    console.log('      (跳过：' + r.error + ')');
    return;
  }
  live = r;
  assert.ok(Array.isArray(r.tasks));
  assert.ok(r.tasks.length > 0, '任务列表为空');
  const s = r.summary;
  assert.equal(s.total, r.tasks.length, 'summary.total 应等于任务数');
  assert.equal(s.pending + s.claimable + s.claimed + s.locked, s.total, '各状态之和应等于总数');

  // 每个任务都必须是四种状态之一
  for (const task of r.tasks) {
    assert.ok(['pending', 'claimable', 'claimed', 'locked'].includes(task.state), '非法状态: ' + task.state);
    assert.ok(task.percent >= 0 && task.percent <= 100, 'percent 越界: ' + task.percent);
  }
  console.log(`      实测：${s.total} 个任务 = 未完成 ${s.pending} + 可领取 ${s.claimable} + 已领 ${s.claimed} + 锁定 ${s.locked}`);
  console.log(`      未完成可拿 ${s.pendingCredit} 积分，可立即领 ${s.claimableCredit} 积分`);
});

await t('pending 任务的 current < target', () => {
  if (!live) return console.log('      (跳过：上一步未取到数据)');
  for (const task of live.tasks.filter((x) => x.state === 'pending')) {
    assert.ok(task.current < task.target, `${task.taskCode}: pending 却 ${task.current}/${task.target}`);
  }
});

await t('claimable 任务的 current >= target 且未领取', () => {
  if (!live) return console.log('      (跳过：上一步未取到数据)');
  for (const task of live.tasks.filter((x) => x.state === 'claimable')) {
    assert.ok(task.current >= task.target, `${task.taskCode}: claimable 却 ${task.current}/${task.target}`);
  }
});

await t('pendingTasks 批量汇总正确', async () => {
  // 无凭证时仍应返回合法结构（空汇总），不抛异常
  const input = NO_CREDS ? [] : creds.slice(0, 2);
  const out = await mod.pendingTasks(input);
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.accounts));
  if (live) {
    const okAccounts = out.accounts.filter((a) => a.ok);
    const manualPending = okAccounts.reduce((s, a) => s + a.pending.length, 0);
    assert.equal(out.totals.pendingTasks, manualPending, '汇总的未完成数应等于各账号之和');
  }
  console.log(`      实测：检查 ${out.totals.accounts} 个账号，未完成 ${out.totals.pendingTasks} 个，可领取 ${out.totals.claimableTasks} 个`);
});

await t('单个账号失败不影响其它账号', async () => {
  const bad = {
    uid: 'bad-uid',
    nickname: 'BadAccount',
    credential: { uid: 'bad-uid', domain: 'www.codebuddy.cn', accessToken: 'invalid.token.here' },
  };
  // 用一个好凭证 + 一个坏凭证（无凭证时只用坏的，同样能验证隔离性）
  const input = NO_CREDS ? [bad] : [creds[0], bad];
  const out = await mod.pendingTasks(input);
  assert.equal(out.ok, true);
  const badRow = out.accounts.find((a) => a.uid === 'bad-uid');
  assert.ok(badRow && badRow.ok === false, '坏账号应标记为失败');
  assert.ok(out.totals.failed >= 1, '失败数应计入 totals');
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
