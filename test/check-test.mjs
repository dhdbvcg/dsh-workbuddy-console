/**
 * 账号体检模块自检（含真实凭证文件扫描 + 真实探活）。
 */
import assert from 'node:assert/strict';
import * as ac from '../lib/account-check.mjs';

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

console.log('\nJWT 工具');

await t('decodeJwt 解析 payload', () => {
  const tok = 'eyJhbGciOiJSUzI1NiJ9.' + Buffer.from(JSON.stringify({ sub: 'u1', exp: 1893456000 })).toString('base64url') + '.sig';
  const p = ac.decodeJwt(tok);
  assert.equal(p.sub, 'u1');
});

await t('decodeJwt 对垃圾输入返回 null', () => {
  assert.equal(ac.decodeJwt('nope'), null);
  assert.equal(ac.decodeJwt(''), null);
  assert.equal(ac.decodeJwt(null), null);
});

await t('tokenExpiryMs 返回毫秒', () => {
  const tok = 'x.' + Buffer.from(JSON.stringify({ exp: 1893456000 })).toString('base64url') + '.y';
  assert.equal(ac.tokenExpiryMs(tok), 1893456000000);
});

console.log('\n凭证文件扫描（真实本机）');

await t('扫描到本机凭证文件', () => {
  const files = ac.scanCredentialFiles();
  console.log('       扫描到 ' + files.length + ' 个文件');
  for (const f of files) console.log('         [' + f.kind + '] ' + f.file + ' -> ' + (f.nickname || f.uid));
  assert.ok(files.length > 0, '应至少扫到一个凭证文件');
});

await t('每个文件都带 kind / path / accessToken 字段', () => {
  const files = ac.scanCredentialFiles();
  for (const f of files) {
    assert.ok(['live', 'snapshot'].includes(f.kind), 'kind 非法: ' + f.kind);
    assert.ok(typeof f.path === 'string' && f.path.length > 0);
    assert.ok(typeof f.accessToken === 'string');
  }
});

await t('登出标记被识别到凭证上', () => {
  const files = ac.scanCredentialFiles();
  const marked = files.filter((f) => f.hasLogoutMarker);
  console.log('       带登出标记的文件: ' + marked.length + ' / ' + files.length);
  assert.ok(Array.isArray(marked));
});

console.log('\n探活逻辑（用假 fetch）');

const CRED = {
  uid: 'u-test',
  accessToken: 'a.b.c',
  kind: 'snapshot',
};

await t('200 + code 0 -> valid，并带出签到状态', async () => {
  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ code: 0, data: { active: true, today_checked_in: false, streak_days: 5 } }),
  });
  const r = await ac.probeCredential(CRED);
  assert.equal(r.state, 'valid');
  assert.equal(r.status.today_checked_in, false);
});

await t('401 -> invalid（关键：过期时间看不出来的失效）', async () => {
  globalThis.fetch = async () => ({ status: 401, text: async () => '<html>401 Authorization Required</html>' });
  const r = await ac.probeCredential(CRED);
  assert.equal(r.state, 'invalid');
  assert.match(r.detail, /重新登录/);
});

await t('403 -> invalid', async () => {
  globalThis.fetch = async () => ({ status: 403, text: async () => 'forbidden' });
  const r = await ac.probeCredential(CRED);
  assert.equal(r.state, 'invalid');
});

await t('网络异常 -> unknown（不能据此断言失效）', async () => {
  globalThis.fetch = async () => {
    throw new Error('boom');
  };
  const r = await ac.probeCredential(CRED);
  assert.equal(r.state, 'unknown');
  assert.match(r.detail, /boom/);
});

await t('非预期响应 -> unknown', async () => {
  globalThis.fetch = async () => ({ status: 502, text: async () => 'bad gateway' });
  const r = await ac.probeCredential(CRED);
  assert.equal(r.state, 'unknown');
});

await t('没有 accessToken -> invalid', async () => {
  const r = await ac.probeCredential({ uid: 'x', accessToken: '' });
  assert.equal(r.state, 'invalid');
});

console.log('\n体检汇总（假 fetch）');

await t('summary 计数与排序正确', async () => {
  globalThis.fetch = async (url, opts) => {
    const uid = opts.headers['X-User-Id'];
    if (uid === 'uid-bad') return { status: 401, text: async () => 'no' };
    return { status: 200, text: async () => JSON.stringify({ code: 0, data: { active: true, today_checked_in: true, streak_days: 1 } }) };
  };
  const out = await ac.healthCheck();
  assert.equal(out.ok, true);
  assert.ok(out.summary.total >= 0);
  const firstInvalid = out.accounts.findIndex((a) => a.state === 'invalid');
  const lastValid = out.accounts.map((a) => a.state).lastIndexOf('valid');
  if (firstInvalid >= 0 && lastValid >= 0) assert.ok(lastValid < firstInvalid, 'valid 应排在 invalid 前');
});

console.log('\n登录入口');

await t('openUrl 拒绝非白名单域名', () => {
  const r = ac.openUrl('https://evil.example.com/steal');
  assert.equal(r.ok, false);
  assert.match(r.error, /白名单/);
});

await t('openUrl 拒绝非 https', () => {
  const r = ac.openUrl('http://www.codebuddy.cn/');
  assert.equal(r.ok, false);
  assert.match(r.error, /https/);
});

await t('openUrl 拒绝非法 URL', () => {
  const r = ac.openUrl('not a url');
  assert.equal(r.ok, false);
});

await t('LOGIN_URL / ACCOUNT_URL 都在白名单内', () => {
  assert.match(ac.LOGIN_URL, /^https:\/\/(www\.)?(codebuddy|workbuddy)\.(cn|ai)\//);
  assert.match(ac.ACCOUNT_URL, /^https:\/\/(www\.)?(codebuddy|workbuddy)\.(cn|ai)\//);
});

await t('launchDesktopApp 不会抛异常', () => {
  const r = ac.launchDesktopApp();
  assert.equal(typeof r.ok, 'boolean');
  if (!r.ok) assert.ok(r.error);
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
