/**
 * 在真实浏览器里验证 client bundle 的行为。
 *
 * 用假 __ModuleLoader__ 捕获注册，用一个极简的 DOM 环境，
 * 断言组件能被构造出来而不是抛异常。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP = 9455;

const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');

// 一个最小的测试页：加载 react 桩 + bundle，然后报告注册结果
const PAGE = `<!doctype html>
<meta charset="utf-8">
<div id="out">running</div>
<script>
window.__RESULT__ = null;
var registrations = [];
var injections = [];
window.__ModuleLoader__ = {
  load: function (def) {
    try {
      var mod = def.factory(function (name) {
        if (name === 'react') {
          return {
            useState: function (v) { return [typeof v === 'function' ? v() : v, function () {}]; },
            useEffect: function () {}, useCallback: function (f) { return f; },
            useRef: function (v) { return { current: v }; },
            Fragment: 'Fragment', createElement: function () { return null; },
            // ErrorBoundary 是 class 组件
            Component: function Component() {}
          };
        }
        if (name === 'react/jsx-runtime') {
          return { jsx: function () { return null; }, jsxs: function () { return null; } };
        }
        throw new Error('unexpected require: ' + name);
      });
      var services = {
        locale: { register: function () { return function () {}; }, bind: function () { return function (k) { return k; }; } },
        slots: {
          inject: function (slot, fn) { injections.push(slot); fn(); },
          register: function (meta, comp) {
            registrations.push({ name: meta.name, id: meta.id, order: meta.order, hasComp: typeof comp === 'function' });
            return function () {};
          }
        }
      };
      // 复刻 cordis 的 inject 门禁：未声明的 service 读属性即抛错。
      // 没有这层保护时，漏写 exports.inject 的 bug 在浏览器里也测不出来。
      var ctx = new Proxy({
        effect: function (fn) { var d = fn(); return typeof d === 'function' ? d : function () {}; },
        get: function (n) { return (mod.inject || []).indexOf(n) >= 0 ? services[n] : undefined; }
      }, {
        get: function (t, prop) {
          if (prop in t) return t[prop];
          if (typeof prop !== 'string') return t[prop];
          if ((mod.inject || []).indexOf(prop) >= 0) return services[prop];
          throw new Error('cannot get property "' + prop + '" without inject');
        }
      });
      mod.apply(ctx);
      window.__RESULT__ = { ok: true, inject: mod.inject || null, injections: injections, registrations: registrations, exports: Object.keys(mod) };
    } catch (e) {
      window.__RESULT__ = { ok: false, error: String(e && e.message || e), stack: String(e && e.stack || '') };
    }
  }
};
</script>
<script src="/client.js"></script>
<script>
if (!window.__RESULT__) {
  window.__RESULT__ = { ok: false, error: 'bundle 没有调用 __ModuleLoader__.load' };
}
document.getElementById('out').textContent = JSON.stringify(window.__RESULT__);
</script>`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/client.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'] });
    return res.end(clientSrc);
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'] });
  res.end(PAGE);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu',
  '--remote-debugging-port=' + CDP,
  '--user-data-dir=' + (process.env.TEMP || '.') + '/cdp-bundle-' + Date.now(),
  'about:blank',
], { stdio: 'ignore' });

function cdp(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: CDP, path: p, method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(b));
        } catch (e) {
          reject(new Error(String(b).slice(0, 80)));
        }
      });
    });
    r.on('error', reject);
    r.end();
  });
}

for (let i = 0; i < 60; i++) {
  try {
    await cdp('/json/version');
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 250));
  }
}

const tab = await cdp('/json/new?about:blank', 'PUT');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const errors = [];
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || '?');
});
const send = (method, params = {}) => {
  const myId = ++id;
  return new Promise((res) => {
    pending.set(myId, res);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
};
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await new Promise((r) => setTimeout(r, 2500));

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.value;
};

const raw = await ev('JSON.stringify(window.__RESULT__)');
console.log('=== 浏览器内执行结果 ===');
const result = JSON.parse(raw);
console.log(JSON.stringify(result, null, 2));
console.log('');
console.log('页面 JS 异常:', errors.length ? errors.map((e) => e.split('\n')[0]) : '无');

let bad = 0;
console.log('');
console.log('=== 断言 ===');
if (!result.ok) {
  console.log('  ✗ bundle 执行失败:', result.error);
  bad++;
} else {
  console.log('  ✓ bundle 执行成功');
}
const names = (result.registrations || []).map((r) => r.name);

// 回归：漏 exports.inject 会让 apply 在真实宿主里整体失败
if (!Array.isArray(result.inject) || !result.inject.includes('slots') || !result.inject.includes('locale')) {
  console.log('  ✗ 导出的 inject 不完整：' + JSON.stringify(result.inject));
  bad++;
} else console.log('  ✓ 导出了 inject = ' + JSON.stringify(result.inject));

for (const need of ['conversation.input.left', 'conversation.composer.dock', 'settings.section']) {
  if (names.includes(need)) console.log('  ✓ 注册了 ' + need);
  else {
    console.log('  ✗ 缺少注册 ' + need);
    bad++;
  }
}
if (errors.length) {
  console.log('  ✗ 存在 JS 异常');
  bad++;
} else console.log('  ✓ 无 JS 异常');

ws.close();
chrome.kill();
server.close();
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
setTimeout(() => process.exit(bad === 0 ? 0 : 1), 300);
