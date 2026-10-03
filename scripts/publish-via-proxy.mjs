/**
 * 在国内 DNS 被污染的环境下发布 npm 包。
 *
 * 背景：registry.npmjs.org 被解析到 182.16.61.x / 141.193.154.x 等
 * 非 Cloudflare 的 IP，请求被导到别处（npm 报错里出现 m.baidu.com）。
 * 真实 Cloudflare 段（104.16.x.x）实测可用，返回正常 npm JSON。
 *
 * 做法：本地起一个转发代理
 *   本机 npm  --http-->  127.0.0.1:<port>  --https(正确 SNI)-->  104.16.x.x
 * npm 的 registry 指到本机代理，代理负责把 Host/SNI 都设成 registry.npmjs.org。
 *
 * 用法：
 *   WB_NPM_TOKEN=xxx node scripts/publish-via-proxy.mjs [--dry-run]
 *
 * token 只写进临时 .npmrc，脚本不打印、用完即删。
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DRY = process.argv.includes('--dry-run');

const REAL_IPS = ['104.16.4.34', '104.16.24.34', '104.16.25.34'];
const HOST = 'registry.npmjs.org';

const TOKEN = process.env.WB_NPM_TOKEN;
if (!TOKEN) {
  console.error('✗ 需要 WB_NPM_TOKEN');
  process.exit(1);
}

// ---------- 代理 ----------
let ipIndex = 0;
function pickIp() {
  const ip = REAL_IPS[ipIndex % REAL_IPS.length];
  ipIndex++;
  return ip;
}

const server = http.createServer((cReq, cRes) => {
  const forward = (target, depth = 0) => {
    if (depth > 3) {
      cRes.writeHead(508);
      cRes.end('too many redirects');
      return;
    }
    const headers = { ...cReq.headers, host: HOST };
    const uReq = https.request(
      {
        host: target,
        port: 443,
        path: cReq.url,
        method: cReq.method,
        headers,
        servername: HOST, // SNI 必须是真实域名，否则证书校验失败
        timeout: 120000,
      },
      (uRes) => {
        // 跟随重定向（Location 通常仍指向 registry.npmjs.org）
        if ([301, 302, 307, 308].includes(uRes.statusCode) && uRes.headers.location) {
          uRes.resume();
          forward(pickIp(), depth + 1);
          return;
        }
        cRes.writeHead(uRes.statusCode || 502, uRes.headers);
        uRes.pipe(cRes);
      },
    );
    uReq.on('timeout', () => { uReq.destroy(new Error('upstream timeout')); });
    uReq.on('error', (e) => {
      if (!cRes.headersSent) {
        cRes.writeHead(502, { 'Content-Type': 'application/json' });
        cRes.end(JSON.stringify({ error: 'proxy: ' + (e.code || e.message) }));
      } else cRes.end();
    });
    cReq.pipe(uReq);
  };
  forward(pickIp());
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const registry = `http://127.0.0.1:${port}/`;
console.log('转发代理已启动: ' + registry + '  ->  https://' + HOST + ' (真实 IP)');

// ---------- 临时 .npmrc（含 token，不打印）----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-pub-'));
const npmrc = path.join(tmp, '.npmrc');
fs.writeFileSync(
  npmrc,
  `registry=${registry}\n//127.0.0.1:${port}/:_authToken=${TOKEN}\n`,
  { mode: 0o600 },
);

function run(args) {
  return new Promise((resolve) => {
    const p = spawn('npm', args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_REGISTRY: registry },
    });
    p.on('close', (code) => resolve(code));
  });
}

console.log('\n=== 1. 验证 token（npm whoami）===');
const who = await run(['whoami']);

let pubCode = -1;
if (who === 0) {
  console.log('\n=== 2. 发布' + (DRY ? '（dry-run）' : '') + ' ===');
  pubCode = await run(['publish', '--access', 'public', ...(DRY ? ['--dry-run'] : [])]);
} else {
  console.log('  ✗ whoami 失败（退出码 ' + who + '），不继续发布');
}

// ---------- 清理 ----------
server.close();
try {
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\n临时 .npmrc 已删除');
} catch { /* 忽略 */ }

console.log('\n结果: whoami=' + who + ' publish=' + pubCode);
process.exit(who === 0 && (DRY || pubCode === 0) ? 0 : 1);
