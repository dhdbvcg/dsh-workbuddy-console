/**
 * 经本地 CONNECT 隧道执行任意 git 命令（hosts 屏蔽 github.com 时用）。
 *
 *   WB_GH_TOKEN=xxx node scripts/git-tunnel.mjs fetch origin main
 *   WB_GH_TOKEN=xxx node scripts/git-tunnel.mjs push origin main
 *
 * 不需要 token 的命令（如 ls-remote 公开仓库、diff）也可以不带 env，
 * 只是推送时必须有。
 *
 * 隧道是纯 TCP 转发，TLS 端到端，证书校验照常。
 * token 只经环境变量交给临时 askpass，不落盘、不进命令行。
 */
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** DNS 被污染，写死真实 IP */
const REAL_IP = {
  'github.com': '20.205.243.166',
  'api.github.com': '20.205.243.168',
  'codeload.github.com': '20.205.243.166',
  'objects.githubusercontent.com': '185.199.108.133',
  'raw.githubusercontent.com': '185.199.108.133',
};

export function startTunnel() {
  const proxy = http.createServer((req, res) => {
    res.writeHead(405);
    res.end('CONNECT only');
  });
  proxy.on('connect', (req, clientSocket, head) => {
    const [host, portStr] = req.url.split(':');
    const port = Number(portStr) || 443;
    const ip = REAL_IP[host];
    if (!ip) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }
    const upstream = net.connect(port, ip, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
    clientSocket.on('error', () => upstream.destroy());
    upstream.on('close', () => clientSocket.destroy());
    clientSocket.on('close', () => upstream.destroy());
  });
  return new Promise((resolve) => {
    proxy.listen(0, '127.0.0.1', () => resolve({ proxy, url: 'http://127.0.0.1:' + proxy.address().port }));
  });
}

/** 跑一条 git 命令；stdio 继承，输出直接可见 */
export function gitViaTunnel(proxyUrl, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const p = spawn('git', ['-c', 'http.proxy=' + proxyUrl, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, ...extraEnv },
    });
    p.on('close', (code) => resolve(code));
  });
}

// 直接执行时：把参数当 git 参数跑一遍
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('用法: node scripts/git-tunnel.mjs <git 参数...>');
    process.exit(2);
  }

  const { proxy, url } = await startTunnel();
  console.log('隧道: ' + url);

  const TOKEN = process.env.WB_GH_TOKEN;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-git-'));
  const askpass = path.join(tmp, 'askpass.cmd');
  fs.writeFileSync(askpass, '@echo off\r\necho %WB_GH_TOKEN%\r\n');

  const env = TOKEN
    ? {
        WB_GH_TOKEN: TOKEN,
        GIT_ASKPASS: askpass,
        GIT_TERMINAL_PROMPT: '0',
        // 禁用 credential.helper（manager 会弹窗并抢先于 askpass）
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'credential.helper',
        GIT_CONFIG_VALUE_0: '',
      }
    : { GIT_TERMINAL_PROMPT: '0' };

  const code = await gitViaTunnel(url, args, env);

  proxy.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  process.exit(code);
}
