/**
 * 单独验证：合并进来的账号池客户端是否真的被捕获并注册了设置卡片。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP = 9488;

const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
const reactUmd = fs.readFileSync('C:/Users/dell/scratch-gui/node_modules/react/umd/react.production.min.js', 'utf8');
const reactDomUmd = fs.readFileSync('C:/Users/dell/scratch-gui/node_modules/react-dom/umd/react-dom.production.min.js', 'utf8');

const PAGE = `<!doctype html>
<meta charset="utf-8">
<div id="r1"></div>
<script>${reactUmd}<\/script>
<script>${reactDomUmd}<\/script>
<script>
(async function () {
  var registered = {};
  var injections = [];
  var services = {
    locale: { register: function () { return function () {}; }, bind: function () { return function (k) { return k; }; } },
    slots: {
      inject: function (slot, fn) { injections.push(slot); fn(); },
      register: function (meta, comp) { registered[meta.id] = { slot: meta.name, order: meta.order, hasComp: typeof comp === 'function' }; return function () {}; }
    }
  };
  var declared = [];
  var ctx = new Proxy({
    effect: function (fn) { return fn(); },
    get: function (n) { return declared.indexOf(n) >= 0 ? services[n] : undefined; }
  }, {
    get: function (t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string') return t[prop];
      if (declared.indexOf(prop) >= 0) return services[prop];
      throw new Error('cannot get property "' + prop + '" without inject');
    }
  });

  window.__ModuleLoader__ = {
    load: function (def) {
      var mod = def.factory(function (name) {
        if (name === 'react') return window.React;
        if (name === 'react/jsx-runtime') return { jsx: function(t,p,k){var q=Object.assign({},p);if(k!==undefined)q.key=k;return React.createElement(t,q,q.children);}, jsxs: function(t,p,k){var q=Object.assign({},p);if(k!==undefined)q.key=k;return React.createElement(t,q,q.children);} };
        throw new Error('unexpected require ' + name);
      });
      if (def.id === 'dsh-workbuddy-console') { declared = mod.inject || []; mod.apply(ctx); }
    }
  };

  var s = document.createElement('script');
  s.textContent = ${JSON.stringify(clientSrc)};
  document.head.appendChild(s);
  await new Promise(function (r) { setTimeout(r, 500); });

  window.__RESULT__ = { ok: true, ids: Object.keys(registered), detail: registered, injections: injections };
})();
<\/script>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=' + CDP, '--user-data-dir=' + (process.env.TEMP || '.') + '/cdp-pool-' + Date.now(), 'about:blank'], { stdio: 'ignore' });

function cdp(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: CDP, path: p, method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error(b.slice(0, 60))); } });
    });
    r.on('error', reject);
    r.end();
  });
}
for (let i = 0; i < 60; i++) { try { await cdp('/json/version'); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

const tab = await cdp('/json/new?about:blank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errs = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push((m.params.args || []).map((a) => a.value || '').join(' ').slice(0, 200));
});
const send = (method, params = {}) => { const i = ++id; return new Promise((res) => { pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); }); };
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 3000));

const ev = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }))?.result?.value;
const raw = await ev('JSON.stringify(window.__RESULT__)');
const r = raw ? JSON.parse(raw) : { ok: false };

console.log('=== 注册到的插槽 ===');
if (r.ids) {
  for (const id of r.ids) {
    const d = r.detail[id];
    console.log(`  ${d.slot.padEnd(30)} #${id}  order=${d.order} 组件=${d.hasComp ? '✓' : '✗'}`);
  }
  console.log('\n=== 判定 ===');
  const hasPool = r.ids.includes('workbuddy-xdpool');
  const hasMarket = r.ids.includes('workbuddy-console');
  console.log('  ' + (hasPool ? '✓' : '✗') + ' 账号池卡片 (workbuddy-xdpool)');
  console.log('  ' + (hasMarket ? '✓' : '✗') + ' 技能市场页 (workbuddy-console)');
}
console.log('\n控制台错误:', errs.length ? errs : '无');

ws.close();
chrome.kill();
server.close();
process.exit(0);
