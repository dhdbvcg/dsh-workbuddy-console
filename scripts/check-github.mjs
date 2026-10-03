/**
 * 验证 apikey.md 里的 GitHub token 是否仍有效，并看清远端仓库状态。
 * 不打印 token 本身。
 */
import fs from 'node:fs';
import https from 'node:https';

const KEYFILE = 'C:/Users/dell/scratch-gui/apikey.md';
const IP = '20.205.243.168'; // api.github.com 真实 IP
const HOST = 'api.github.com';

const text = fs.readFileSync(KEYFILE, 'utf8');
const m = /(ghp_[A-Za-z0-9]{20,})/.exec(text);
if (!m) {
  console.error('✗ 没找到 token');
  process.exit(1);
}
const TOKEN = m[1];
console.log('token: ' + TOKEN.slice(0, 7) + '…' + TOKEN.slice(-4) + '（长度 ' + TOKEN.length + '）');

function api(path) {
  return new Promise((resolve) => {
    const q = https.request(
      { host: IP, port: 443, path, method: 'GET', servername: HOST,
        headers: { host: HOST, 'user-agent': 'wb-check', authorization: 'Bearer ' + TOKEN, accept: 'application/vnd.github+json' },
        timeout: 15000 },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      },
    );
    q.on('timeout', () => { q.destroy(); resolve({ status: 0, body: 'timeout' }); });
    q.on('error', (e) => resolve({ status: 0, body: e.code || e.message }));
    q.end();
  });
}

console.log('\n=== 1. 身份 /user ===');
const u = await api('/user');
if (u.status === 200) {
  const j = JSON.parse(u.body);
  console.log('  ✓ 有效，登录为: ' + j.login);
} else {
  console.log('  ✗ HTTP ' + u.status + '  ' + u.body.slice(0, 120));
  process.exit(1);
}

console.log('\n=== 2. token 权限（看有没有 repo / workflow 写权限）===');
const r = await api('/user/repos?per_page=100&sort=updated');
if (r.status === 200) {
  const repos = JSON.parse(r.body);
  const target = repos.find((x) => x.name === 'dsh-workbuddy-console');
  console.log('  可见仓库数: ' + repos.length);
  if (target) {
    console.log('  ✓ 找到目标仓库: ' + target.full_name);
    console.log('    默认分支: ' + target.default_branch);
    console.log('    私有: ' + target.private);
    console.log('    push 权限: ' + (target.permissions && target.permissions.push));
    console.log('    更新时间: ' + target.updated_at);
    console.log('    体积: ' + target.size + ' KB');
  } else {
    console.log('  ！ 列表里没有 dsh-workbuddy-console');
  }
} else {
  console.log('  ✗ HTTP ' + r.status + '  ' + r.body.slice(0, 150));
}

console.log('\n=== 3. 目标仓库的远端分支与最新提交 ===');
const br = await api('/repos/dhdbvcg/dsh-workbuddy-console/branches/main');
if (br.status === 200) {
  const j = JSON.parse(br.body);
  console.log('  main 最新: ' + j.commit.sha.slice(0, 10) + '  ' + j.commit.commit.message.split('\n')[0].slice(0, 70));
  console.log('  提交时间: ' + j.commit.commit.author.date);
} else {
  console.log('  ✗ HTTP ' + br.status + '  ' + br.body.slice(0, 150));
}
