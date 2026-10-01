/**
 * 端到端验证新增功能：检查账号 + 登录入口。
 * 用真实浏览器点按钮，确认没有 JS 报错且结果正确渲染。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9223;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/cdp-check-' + Date.now(),
  'about:blank',
], { stdio: 'ignore' });

function req(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b.slice(0, 100))); }
      });
    });
    r.on('error', reject);
    r.end();
  });
}

for (let i = 0; i < 40; i++) {
  try { await req('/json/version'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

const tab = await req('/json/new?about:blank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleErrors = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(m.params.exceptionDetails?.exception?.description || 'unknown');
  }
});

function send(method, params = {}) {
  const myId = ++id;
  return new Promise((res) => { pending.set(myId, res); ws.send(JSON.stringify({ id: myId, method, params })); });
}
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:19387/wb-console' });
await new Promise((r) => setTimeout(r, 6000));

async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}

console.log('\n=== 初始状态 ===');
console.log(await evaluate(`JSON.stringify({
  mode: document.querySelector('#mode-line').textContent,
  rows: document.querySelectorAll('.row').length,
  hasCheckBtn: !!document.querySelector('#btn-check'),
  hasLoginBtn: !!document.querySelector('#btn-login')
})`));

console.log('\n=== 点击「检查账号」 ===');
await evaluate(`document.querySelector('#btn-check').click()`);
await new Promise((r) => setTimeout(r, 6000));
console.log(await evaluate(`JSON.stringify({
  panelVisible: !document.querySelector('#check-panel').classList.contains('hidden'),
  checkTime: document.querySelector('#check-time').textContent,
  stats: [...document.querySelectorAll('.check-stat')].map(e => e.textContent.trim()),
  rows: [...document.querySelectorAll('.check-row .cname')].map(e => e.textContent.trim()),
  alert: document.querySelector('#alert').textContent
})`));

console.log('\n=== 点击「登录新账号」（只开弹窗，不真的打开浏览器） ===');
await evaluate(`document.querySelector('#btn-login').click()`);
await new Promise((r) => setTimeout(r, 600));
console.log(await evaluate(`JSON.stringify({
  modalVisible: !document.querySelector('#login-modal').classList.contains('hidden'),
  hasWeb: !!document.querySelector('#btn-login-web'),
  hasDesktop: !!document.querySelector('#btn-login-desktop'),
  hint: document.querySelector('#login-modal .hint')?.textContent.trim().slice(0,60)
})`));

console.log('\n=== JS 异常 ===');
console.log(consoleErrors.length === 0 ? '  无' : consoleErrors.map((e) => '  ' + e.split('\n')[0]).join('\n'));

ws.close();
chrome.kill();
process.exit(0);
