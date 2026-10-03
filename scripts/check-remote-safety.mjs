import fs from 'node:fs';
import https from 'node:https';

const KEYFILE = 'C:/Users/dell/scratch-gui/apikey.md';
const IP = '20.205.243.168';
const HOST = 'api.github.com';
const TOKEN = /(ghp_[A-Za-z0-9]{20,})/.exec(fs.readFileSync(KEYFILE, 'utf8'))[1];

function api(p) {
  return new Promise((resolve) => {
    const q = https.request(
      { host: IP, port: 443, path: p, method: 'GET', servername: HOST,
        headers: { host: HOST, 'user-agent': 'wb', authorization: 'Bearer ' + TOKEN, accept: 'application/vnd.github+json' },
        timeout: 15000 },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ s: res.statusCode, b })); },
    );
    q.on('error', (e) => resolve({ s: 0, b: e.code }));
    q.on('timeout', () => { q.destroy(); resolve({ s: 0, b: 'timeout' }); });
    q.end();
  });
}

const REPO = '/repos/dhdbvcg/dsh-workbuddy-console';

console.log('=== tag（强推可能让它们孤立）===');
const t = await api(REPO + '/tags');
if (t.s === 200) {
  const tags = JSON.parse(t.b);
  if (tags.length === 0) console.log('  无 tag');
  for (const x of tags) console.log('  ' + x.name + ' -> ' + x.commit.sha.slice(0, 10));
} else console.log('  HTTP ' + t.s + ' ' + t.b.slice(0, 100));

console.log('\n=== release ===');
const r = await api(REPO + '/releases');
if (r.s === 200) {
  const rel = JSON.parse(r.b);
  if (rel.length === 0) console.log('  无 release');
  for (const x of rel) console.log('  ' + x.tag_name + ' -> ' + x.target_commitish);
} else console.log('  HTTP ' + r.s + ' ' + r.b.slice(0, 100));

console.log('\n=== 其他分支（强推只影响 main）===');
const b = await api(REPO + '/branches');
if (b.s === 200) {
  for (const x of JSON.parse(b.b)) console.log('  ' + x.name + ' -> ' + x.commit.sha.slice(0, 10));
} else console.log('  HTTP ' + b.s + ' ' + b.b.slice(0, 100));

console.log('\n=== 协作者（有没有别人在推）===');
const c = await api(REPO + '/collaborators');
if (c.s === 200) {
  for (const x of JSON.parse(c.b)) console.log('  ' + x.login);
} else console.log('  HTTP ' + c.s + ' ' + c.b.slice(0, 100));

console.log('\n=== 有没有开着的 PR（强推会影响）===');
const p = await api(REPO + '/pulls?state=open');
if (p.s === 200) {
  const prs = JSON.parse(p.b);
  console.log(prs.length === 0 ? '  无开启的 PR' : '  ' + prs.length + ' 个 PR');
} else console.log('  HTTP ' + p.s + ' ' + p.b.slice(0, 100));
