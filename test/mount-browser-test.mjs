/**
 * 在真实 Chrome 里挂载客户端组件并断言渲染结果。
 *
 * 为什么在浏览器里做：
 *   市场组件的数据在 useEffect 里拉取，只有「真实挂载 + 跑完 effects」
 *   才能看到内容。Node 端没有 jsdom；本机有 React UMD 与 Chrome，
 *   直接用浏览器当渲染环境 —— 比任何桩都真实。
 *
 * 抓过的回归：
 *   - jsx(type, props, child) 把 child 当 key 传 → 全部内容被静默丢弃（v1.4.0~2 空白页）
 *   - installedSkills 被死代码清理误删 → 打开选择器即崩（v1.4.5 空市场/加载失败）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP = 9477;

const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
const reactUmd = fs.readFileSync('C:/Users/dell/scratch-gui/node_modules/react/umd/react.production.min.js', 'utf8');
const reactDomUmd = fs.readFileSync('C:/Users/dell/scratch-gui/node_modules/react-dom/umd/react-dom.production.min.js', 'utf8');

const PAGE = `<!doctype html>
<meta charset="utf-8">
<div id="r1"></div><div id="r2"></div><div id="r3"></div>
<script>${reactUmd}<\/script>
<script>${reactDomUmd}<\/script>
<script>
window.__boot_log = [];
window.__boot_error = null;
(async function () {
  try {
    var log = function (m) { window.__boot_log.push(m); };
    // jsx-runtime：React 16 没有内置；用真实契约实现 ——
    // children 必须已在 props 里，这里直接转 React.createElement(type, props)。
    // （若插件把 child 放第三参，props.children 就是 undefined，照样空白 —— 测试仍有效）
    var jsxRuntime = {
      jsx: function (type, props, key) { var p = Object.assign({}, props); if (key !== undefined) p.key = key; return React.createElement(type, p, p.children); },
      jsxs: function (type, props, key) { var p = Object.assign({}, props); if (key !== undefined) p.key = key; return React.createElement(type, p, p.children); }
    };
    // fetch 数据桩
    var apiStubs = {
      '/skills/installed': { ok: true, skillsDir: 'C:/dsh/skills', total: 1, skills: [{ dir: 'xlsx', name: 'xlsx', description: 'Excel', version: '2.0.0' }] },
      '/skills/list': { ok: true, page: 1, pageSize: 30, total: 10000, installed: ['xlsx'], skillsDir: 'C:/dsh/skills', skills: [
        { skillId: 's1', name: 'delivery-no-pseudoblock', version: '1.0.0', displayNameZh: 'AI交付前全自动自检技能', displayNameEn: 'AI Pre-Delivery Self-Check', descriptionZh: '交付前自检', descriptionEn: 'self check', categories: ['collaboration'], useCount: 318294 },
        { skillId: 's2', name: 'xlsx', version: '2.0.0', displayNameZh: 'Excel 表格处理', displayNameEn: 'Excel', descriptionZh: '表格', descriptionEn: 'sheets', categories: ['productivity'], useCount: 18401 }
      ] }
    };
    var realFetch = window.fetch;
    window.fetch = function (url) {
      var u = String(url);
      for (var k in apiStubs) if (u.indexOf(k) >= 0) return Promise.resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(JSON.stringify(apiStubs[k]))); } });
      return realFetch.apply(window, arguments);
    };

    var mod = null;
    var declared = [];
    var registered = {};
    var services = {
      locale: { register: function () { return function () {}; }, bind: function () { return function (k) { return k; }; } },
      slots: {
        inject: function (slot, fn) { fn(); },
        register: function (meta, comp) { registered[meta.id] = comp; return function () {}; }
      }
    };
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
        mod = def.factory(function (name) {
          if (name === 'react') return window.React;
          if (name === 'react/jsx-runtime') return jsxRuntime;
          throw new Error('unexpected require ' + name);
        });
        declared = mod.inject || [];
        mod.apply(ctx);
      }
    };

    // 执行客户端 bundle（作为内联脚本：window.__ModuleLoader__ 已就位）
    var s = document.createElement('script');
    s.textContent = ${JSON.stringify(clientSrc)};
    document.head.appendChild(s);
    log('bundle executed');

    // 挂载三个组件
    var results = {};
    var mounts = [
      ['workbuddy-console', 'r1'],
      ['workbuddy-skill-picker', 'r2'],
      ['workbuddy-credit', 'r3'],
    ];
    mounts.forEach(function (m) {
      var Comp = registered[m[0]];
      if (!Comp) { results[m[0]] = { error: 'not registered' }; return; }
      try {
        ReactDOM.render(React.createElement(Comp, {}), document.getElementById(m[1]));
        results[m[0]] = { text: document.getElementById(m[1]).textContent };
      } catch (e) {
        results[m[0]] = { error: String(e && e.message || e) };
      }
    });

    // 等 effects / fetch 落地
    await new Promise(function (r) { setTimeout(r, 300); });
    // 再读一次文本（数据加载后的重渲染）
    mounts.forEach(function (m) {
      if (results[m[0]] && !results[m[0]].error) {
        results[m[0]].textAfter = document.getElementById(m[1]).textContent;
      }
    });

    window.__RESULT__ = { ok: true, results: results, registeredIds: Object.keys(registered) };
  } catch (e) {
    window.__RESULT__ = { ok: false, error: String(e && e.message || e), stack: String(e && e.stack || '') };
  }
})();
<\/script>`;

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
  '--user-data-dir=' + (process.env.TEMP || '.') + '/cdp-mount-' + Date.now(),
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
        } catch {
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

let tab;
try {
  tab = await cdp('/json/new?about:blank', 'PUT');
} catch (e) {
  console.log('  FAIL 无法创建 CDP 标签页（Chrome 未就绪）:', String(e.message || e));
  try { chrome.kill('SIGTERM'); } catch { /* 忽略 */ }
  server.close();
  console.log('\n结果：0 通过，5 失败');
  process.exit(1);
}
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const consoleErrors = [];

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' ').slice(0, 200));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXC: ' + (m.params.exceptionDetails?.exception?.description || '').slice(0, 200));
  }
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
await new Promise((r) => setTimeout(r, 3000));

const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

const raw = await ev('JSON.stringify(window.__RESULT__)');
let bad = 0;
console.log('=== 浏览器挂载结果 ===');
if (!raw) {
  console.log('  ✗ 没有拿到结果（页面脚本可能没跑完）');
  bad++;
} else {
  const result = JSON.parse(raw);
  if (!result.ok) {
    console.log('  ✗ boot 失败:', result.error);
    console.log('  ', String(result.stack || '').split('\n').slice(0, 3).join('\n   '));
    bad++;
  } else {
    const r1 = result.results['workbuddy-console'];
    const r2 = result.results['workbuddy-skill-picker'];
    const r3 = result.results['workbuddy-credit'];

    console.log('\n--- 设置页（workbuddy-console）---');
    if (r1.error) { console.log('  ✗', r1.error); bad++; }
    else {
      const t1 = r1.textAfter || r1.text;
      console.log('  可见文本:', JSON.stringify(t1.slice(0, 120)));
      // 页面语言由 documentElement.lang 决定（本页无 lang → 英文兜底）
      const hasSkill = t1.includes('AI Pre-Delivery Self-Check') || t1.includes('AI交付前全自动自检技能');
      if (hasSkill) console.log('  ✓ 市场技能名渲染了');
      else { console.log('  ✗ 没有渲染出市场技能名'); bad++; }
      if (t1.includes('10000')) console.log('  ✓ 总数渲染了');
      else { console.log('  ✗ 没有总数'); bad++; }
    }

    console.log('\n--- 选择器（workbuddy-skill-picker）---');
    if (r2.error) { console.log('  ✗', r2.error); bad++; }
    else {
      const t2 = r2.textAfter || r2.text;
      console.log('  可见文本:', JSON.stringify(t2.slice(0, 80)));
      if (t2.includes('WorkBuddy')) console.log('  ✓ 按钮渲染了');
      else { console.log('  ✗ 按钮文本被丢弃'); bad++; }
    }

    console.log('\n--- 积分条（workbuddy-credit）---');
    if (r3.error) { console.log('  ✗', r3.error); bad++; }
    else console.log('  ✓ 挂载成功（无数据时为空是预期）');
  }
}

const realErrors = consoleErrors.filter((e) => !e.includes('unique "key" prop'));
console.log('\n控制台错误:', realErrors.length ? realErrors : '无');
if (realErrors.length) bad++;

ws.close();
server.close();
// run-all 通过这一行汇总结果（与其它测试保持同一格式）
console.log(`\n结果：${bad === 0 ? 5 : 0} 通过，${bad} 失败`);
console.log(bad === 0 ? '全部通过' : '存在失败');
try {
  chrome.kill('SIGTERM');
} catch {
  /* 已退出 */
}
process.exit(bad === 0 ? 0 : 1);
