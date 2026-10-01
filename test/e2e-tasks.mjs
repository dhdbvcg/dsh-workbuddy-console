/**
 * 浏览器 E2E：未完成任务面板。
 * 用真实 Chrome 打开页面、点「刷新任务」，断言渲染结果与零 JS 异常。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9224;
const BASE = process.env.WB_CONSOLE_URL || 'http://127.0.0.1:19387/wb-console';

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + process.env.TEMP + '/cdp-tasks-' + Date.now(),
  'about:blank',
], { stdio: 'ignore' });

function req(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path, method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b.slice(0, 80))); } });
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
const errors = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails?.exception?.description || 'unknown');
  }
});

function send(method, params = {}) {
  const myId = ++id;
  return new Promise((res) => { pending.set(myId, res); ws.send(JSON.stringify({ id: myId, method, params })); });
}
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: BASE });
await new Promise((r) => setTimeout(r, 6000));

async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}

console.log('\n=== 初始 ===');
console.log(await ev(`JSON.stringify({
  hasPanel: !!document.querySelector('#tasks-panel'),
  pendingBadge: document.querySelector('#tasks-pending-badge')?.textContent,
  rows: document.querySelectorAll('.row').length
})`));

console.log('\n=== 点「刷新任务」 ===');
await ev(`document.querySelector('#btn-tasks').click()`);
await new Promise((r) => setTimeout(r, 9000));

console.log(await ev(`JSON.stringify({
  pendingBadge: document.querySelector('#tasks-pending-badge')?.textContent,
  creditBadge: document.querySelector('#tasks-credit-badge')?.textContent,
  groups: document.querySelectorAll('.task-group').length,
  tasks: document.querySelectorAll('.task').length,
  firstGroup: document.querySelector('.task-group .task-acct')?.textContent.trim().replace(/\\s+/g,' '),
  firstTask: document.querySelector('.task .ttitle')?.textContent,
  firstProgress: document.querySelector('.task .tnum')?.textContent,
  bars: document.querySelectorAll('.tbar > i').length,
  claimButtons: document.querySelectorAll('.tclaim').length
})`));

console.log('\n=== JS 异常 ===');
console.log(errors.length === 0 ? '  无' : errors.map((e) => '  ' + e.split('\n')[0]).join('\n'));

ws.close();
chrome.kill();
process.exit(0);
