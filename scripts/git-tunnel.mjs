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
/**
 * 域名 → 真实 IP 列表（DNS 被污染，所以写死）。
 *
 * 每个域名给多个 IP：实测单个 IP 会间歇性拒连，
 * 推送 5 次里 4 次报 "CONNECT tunnel failed, response 502"。
 * 换一个 IP 立刻就好，所以失败时轮换重试。
 *
 * 列表里的 IP 都逐个实测过（用 git-upload-pack 端点 + 证书校验）：
 *   github.com   → 20.205.243.166 / 140.82.121.3 / 140.82.113.4   全部 HTTP 200
 *   api.github.com → 20.205.243.168 / 140.82.121.6                HTTP 401（未鉴权，正常）
 *   codeload     → 140.82.121.9 / 140.82.113.9                    HTTP 200
 *
 * 注意：20.205.243.165 看着像但实测返回 HTTP 400，**不要加回来**。
 *       加错的 IP 会让 git 报 "The requested URL returned error: 400"。
 * 重验方法：对 <ip>/<owner>/<repo>.git/info/refs?service=git-upload-pack
 *           发请求，期望 200 + content-type: application/x-git-upload-pack-advertisement。
 */
const REAL_IP = {
  'github.com': ['20.205.243.166', '140.82.121.3', '140.82.113.4'],
  'api.github.com': ['20.205.243.168', '140.82.121.6'],
  'codeload.github.com': ['140.82.121.9', '140.82.113.9'],
  'objects.githubusercontent.com': ['185.199.108.133', '185.199.109.133', '185.199.110.133'],
  'raw.githubusercontent.com': ['185.199.108.133', '185.199.109.133', '185.199.110.133'],
};

/** 轮换游标：每次连接从"下一个"IP 开始，避免总撞同一个坏的 */
let ipCursor = 0;

export function startTunnel() {
  const proxy = http.createServer((req, res) => {
    res.writeHead(405);
    res.end('CONNECT only');
  });
  proxy.on('connect', (req, clientSocket, head) => {
    const [host, portStr] = req.url.split(':');
    const port = Number(portStr) || 443;
    const list = REAL_IP[host];
    if (!list || list.length === 0) {
      clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      return;
    }

    // 依次尝试该域名的各个 IP；全部失败才放弃
    let idx = ipCursor++ % list.length;
    let attempt = 0;
    let upstream = null;
    let established = false;

    const tryNext = () => {
      if (established) return;
      if (attempt >= list.length) {
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        return;
      }
      const ip = list[idx % list.length];
      idx++;
      attempt++;

      const sock = net.connect(port, ip);
      upstream = sock;
      // 只用于「建连阶段」的超时；连上后必须清掉，
      // 否则长时间传输会被当成空闲而断开
      sock.setTimeout(8000, () => sock.destroy(new Error('connect timeout')));

      sock.once('connect', () => {
        if (established) { sock.destroy(); return; }
        established = true;
        sock.setTimeout(0);

        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head && head.length) sock.write(head);

        // 用 pipe 的默认 end:true —— 源结束时对端会走 end()（TCP 半关闭，
        // 会正常发出 FIN）。之前用 destroy() 强杀，GitHub 侧看到的是
        // 连接被突然掐断，git 报 "schannel: server closed abruptly
        // (missing close_notify)"，并且有时直接挂住不动。
        sock.pipe(clientSocket);
        clientSocket.pipe(sock);
      });

      sock.once('error', (e) => {
        if (!established) {
          // 建连阶段失败 → 换下一个 IP
          sock.destroy();
          tryNext();
          return;
        }
        // 已经通了才出错 → 必须结束客户端，否则 git 一直等。
        // 用 end() 而不是 destroy()：destroy 会掐断 TLS，
        // git 侧报 "schannel: server closed abruptly (missing close_notify)"。
        console.error('  [tunnel] ' + host + ' 传输中断: ' + (e.code || e.message));
        if (!clientSocket.destroyed) clientSocket.end();
      });

      // 上游正常关闭 → 让客户端也结束（不 destroy，交给 pipe 收尾）
      sock.once('close', () => {
        if (established && !clientSocket.destroyed) clientSocket.end();
      });
    };

    tryNext();

    clientSocket.on('error', () => { if (upstream) upstream.destroy(); });
    clientSocket.on('close', () => { if (upstream && !upstream.destroyed) upstream.destroy(); });
  });
  return new Promise((resolve) => {
    proxy.listen(0, '127.0.0.1', () => resolve({ proxy, url: 'http://127.0.0.1:' + proxy.address().port }));
  });
}

/**
 * 跑一条 git 命令；stdio 继承，输出直接可见。
 *
 * 返回 { code, output }：output 是捕获到的 stderr/stdout 副本
 * （git 的进度走 stderr，用 pipe 捕获后再转发，便于判定是否瞬时错误）。
 */
export function gitViaTunnel(proxyUrl, args, extraEnv = {}, { capture = false } = {}) {
  return new Promise((resolve) => {
    const p = spawn('git', ['-c', 'http.proxy=' + proxyUrl, ...args], {
      cwd: ROOT,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      shell: false,
      env: { ...process.env, ...extraEnv },
    });

    if (!capture) {
      p.on('close', (code) => resolve({ code, output: '' }));
      return;
    }

    let out = '';
    p.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    p.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    p.on('close', (code) => resolve({ code, output: out }));
  });
}

/** 判断 git 失败是不是网络瞬断（重试即可，与仓库内容无关） */
export function isTransientNetworkError(output) {
  return /schannel|close_notify|CONNECT tunnel failed|502 Bad Gateway|Empty reply from server|early EOF|RPC failed|Could not resolve host|Connection reset|connection was reset|timed out|TLS|SSL_ERROR|EOF occurred|remote end hung up|Could not read from remote repository|unexpected disconnect|network is unreachable|The remote end hung up/i.test(
    String(output || ''),
  );
}

// 直接执行时：把参数当 git 参数跑一遍（瞬时网络错误自动重试）
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  let retries = 4;
  const ri = argv.indexOf('--retry');
  if (ri >= 0) {
    retries = Number(argv[ri + 1]) || 4;
    argv.splice(ri, 2);
  }
  const args = argv;
  if (args.length === 0) {
    console.error('用法: node scripts/git-tunnel.mjs [--retry N] <git 参数...>');
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

  // 瞬时网络错误自动重试：git 的推送/拉取是幂等的，
  // 失败重来不会写坏仓库；实测没有重试时失败率约 4/5。
  let code = 1;
  let output = '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (attempt > 1) console.log(`\n--- 第 ${attempt}/${retries} 次重试 ---`);
    const r = await gitViaTunnel(url, args, env, { capture: true });
    code = r.code;
    output = r.output;
    if (code === 0) break;
    if (!isTransientNetworkError(output)) {
      console.log('\n（不是网络错误，不重试）');
      break;
    }
    if (attempt < retries) {
      const wait = 3000 * attempt;
      console.log(`（瞬时网络错误，${wait / 1000}s 后重试）`);
      await new Promise((r2) => setTimeout(r2, wait));
    }
  }

  proxy.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  process.exit(code);
}
