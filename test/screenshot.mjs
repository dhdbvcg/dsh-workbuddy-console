/**
 * 截图：起静态预览服务 + CDP 驱动 Chrome，中英文各截一张。
 *
 * 为什么不用 `chrome --screenshot`：
 *   需要先写 localStorage 才能指定语言，而 file:// 页面再跳转 http:// 
 *   会让 headless Chrome 卡住不退出。改用 CDP：先导航、设 localStorage、再导航。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', 'web');
const OUT = path.resolve(HERE, '..', 'assets');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP = 9444;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const mock = JSON.parse(fs.readFileSync(path.join(HERE, 'mock-data.json'), 'utf8'));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/wb-console/api/')) {
    const key = Object.keys(mock).find((k) => url.pathname.endsWith(k));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(key ? mock[key] : { ok: true }));
    return;
  }
  let rel = url.pathname.replace(/^\/wb-console\/?/, '/');
  if (rel === '/') rel = '/index.html';
  const file = path.join(WEB, rel);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) return res.writeHead(404).end('nf');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
console.log('预览服务端口 ' + PORT);

const profile = path.join(process.env.TEMP || '.', 'shot-profile-' + Date.now());
const chrome = spawn(
  CHROME,
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1400,1800',
   '--remote-debugging-port=' + CDP, '--user-data-dir=' + profile, 'about:blank'],
  { stdio: 'ignore' },
);

function cdp(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: CDP, path: p, method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(String(b).slice(0, 80))); } });
    });
    r.on('error', reject);
    r.end();
  });
}

for (let i = 0; i < 60; i++) {
  try { await cdp('/json/version'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

fs.mkdirSync(OUT, { recursive: true });

for (const [lang, name] of [['zh', 'console.png'], ['en', 'console.en.png']]) {
  const tab = await cdp('/json/new?about:blank', 'PUT');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  });
  const send = (method, params = {}) => {
    const myId = ++id;
    return new Promise((res) => { pending.set(myId, res); ws.send(JSON.stringify({ id: myId, method, params })); });
  };
  await new Promise((r) => ws.addEventListener('open', r));

  await send('Page.enable');
  await send('Runtime.enable');

  // 1. 导航一次以拿到 origin，才能写 localStorage
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/wb-console/` });
  await new Promise((r) => setTimeout(r, 2000));
  await send('Runtime.evaluate', { expression: `localStorage.setItem('wb-console-lang','${lang}')` });

  // 2. 重新加载，让语言生效并渲染
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/wb-console/?lang=${lang}&t=${Date.now()}` });
  await new Promise((r) => setTimeout(r, 4000));

  // 3. 展开各面板（任务 / 历史 / 消耗 / 技能市场）
  await send('Runtime.evaluate', { expression: `document.querySelector('#btn-tasks')?.click()` });
  await new Promise((r) => setTimeout(r, 1500));
  await send('Runtime.evaluate', { expression: `document.querySelector('#btn-history')?.click()` });
  await new Promise((r) => setTimeout(r, 1500));
  await send('Runtime.evaluate', { expression: `document.querySelector('#btn-spend')?.click()` });
  await new Promise((r) => setTimeout(r, 1500));
  await send('Runtime.evaluate', { expression: `document.querySelector('#btn-skills')?.click()` });
  await new Promise((r) => setTimeout(r, 2500));

  // 4. 截图（整页）
  const metrics = await send('Page.getLayoutMetrics');
  const h = Math.ceil(metrics.cssContentSize?.height || 1800);
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1400, height: Math.min(h, 4000), scale: 1 },
  });
  const out = path.join(OUT, name);
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(`${name}: ${fs.statSync(out).size} bytes (${lang}, height ${h})`);

  ws.close();
}

chrome.kill();
server.close();
setTimeout(() => process.exit(0), 500);
