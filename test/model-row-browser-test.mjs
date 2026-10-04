/**
 * 在真实 Chrome 里挂载**模型选择卡片**，断言新增的三个控件真的渲染出来。
 *
 * 为什么非要浏览器：
 *   这张卡片的数据来自 useEffect 里的 fetch，只有真实挂载 + 跑完 effects
 *   才看得到内容。Node 端没有 jsdom，而桩渲染恰好会漏掉「选项渲染不出来」
 *   这类问题（本项目吃过空白页的亏）。
 *
 * 覆盖的三个控件：
 *   1. 上下文窗口选择（原本就有 200K/960K 单选，这次要确认没被改坏）
 *   2. 每模型「思考强度」下拉（新增）
 *   3. 区域级「Max 模式」开关（新增）
 *
 * 同时验证 Max 模式打开后：思考强度下拉被禁用、模型行出现 Max 标记。
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

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };

for (const p of [CHROME, 'C:/Users/dell/scratch-gui/node_modules/react/umd/react.production.min.js']) {
  if (!fs.existsSync(p)) {
    console.log('  跳过：缺少 ' + p);
    process.exit(0);
  }
}

const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');
const reactUmd = fs.readFileSync('C:/Users/dell/scratch-gui/node_modules/react/umd/react.production.min.js', 'utf8');
const reactDomUmd = fs.readFileSync('C:/Users/dell/scratch-gui/node_modules/react-dom/umd/react-dom.production.min.js', 'utf8');

// —— 假的池状态：一个有思考档位的模型 + 一个没有的 + 一个超大窗口的 ——
const STATUS = {
  ok: true,
  accounts: [],
  cooling: 0,
  region: 'cn',
  distribution: 'round-robin',
  regions: ['cn', 'global'],
  shim: { running: true, baseUrl: 'http://127.0.0.1:1' },
  models: [
    { id: 'hy4-preview', name: 'Hy4 preview', enabled: true, supportsImages: true, contextWindow: 960000, nativeContextWindow: 960000, maxOutputTokens: 64000, multiplier: 0, supportedEfforts: ['low', 'medium', 'high', 'shigh', 'max'] },
    { id: 'hy3', name: 'Hy3', enabled: true, supportsImages: false, contextWindow: 64000, nativeContextWindow: 64000, maxOutputTokens: 64000, multiplier: 0.05, supportedEfforts: ['low', 'high'] },
    { id: 'plain', name: 'Plain', enabled: false, supportsImages: false, contextWindow: 128000, nativeContextWindow: 128000, maxOutputTokens: 32000, multiplier: 1 },
  ],
  selection: {
    enabledModelIds: ['hy4-preview', 'hy3', 'plain'],
    imageModelIds: ['hy4-preview'],
    contextBudgets: {},
    reasoningEfforts: { 'hy4-preview': 'high' },
    maxMode: false,
  },
  automation: { enabled: false, hours: {}, earningsToday: {}, runInProgress: false },
  // 下面两个字段卡片会直接读 .length，缺一个就整页抛
  // "Cannot read properties of undefined (reading 'length')" ——踩过。
  ignored: [],
  creditReserves: [],
};

const PAGE = `<!doctype html>
<meta charset="utf-8">
<div id="r1"></div>
<script>${reactUmd}<\/script>
<script>${reactDomUmd}<\/script>
<script>
window.__boot_error = null;
(async function () {
  try {
    var jsxRuntime = {
      jsx: function (type, props, key) { var p = Object.assign({}, props); if (key !== undefined) p.key = key; return React.createElement(type, p, p.children); },
      jsxs: function (type, props, key) { var p = Object.assign({}, props); if (key !== undefined) p.key = key; return React.createElement(type, p, p.children); }
    };
    var STATUS = ${JSON.stringify(STATUS)};
    // 可变的 selection，用来测 Max 模式打开后的重渲染
    window.__STATUS__ = STATUS;
    var realFetch = window.fetch;
    window.fetch = function (url) {
      var u = String(url);
      if (u.indexOf('/status') >= 0) {
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(JSON.stringify(window.__STATUS__))); } });
      }
      return realFetch.apply(window, arguments);
    };

    var mod = null, declared = [], registered = {};
    var settingsScope = {
      getSnapshot: function () { return { formStatus: 'idle' }; },
      set: function (k, v) { window.__SAVED__ = { key: k, value: v }; return Promise.resolve(); }
    };
    var configForms = {
      describe: function () { return { getSnapshot: function () { return { view: { namespaces: [{ ns: 'llm-workbuddy-xdpool' }] } }; } }; },
      get: function (id) { return settingsScope; }
    };
    var services = {
      locale: { register: function () { return function () {}; }, bind: function () { return function (k) { return k; }; } },
      configForms: configForms,
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

    var s = document.createElement('script');
    s.textContent = ${JSON.stringify(clientSrc)};
    document.head.appendChild(s);

    // 找到**账号池卡片**组件（settings.section 注册的那个）。
    // 注意别用宽松的 /workbuddy/ 匹配：技能市场那张卡片也命中，会张冠李戴
    // ——踩过：挂到了技能市场上，模型区当然是空的。
    var Comp = registered['workbuddy-xdpool'];
    window.__CARD_ID__ = 'workbuddy-xdpool';
    if (!Comp) { window.__RESULT__ = { ok: false, error: 'workbuddy-xdpool not registered', ids: Object.keys(registered) }; return; }

    window.__CARD__ = Comp;
    window.__CONSOLE__ = [];
    var origErr = console.error;
    console.error = function () { window.__CONSOLE__.push(Array.from(arguments).map(String).join(' ')); origErr.apply(console, arguments); };
    try {
      ReactDOM.render(React.createElement(Comp, {}), document.getElementById('r1'));
    } catch (e) {
      window.__RENDER_ERR__ = String(e && e.stack || e);
    }
    await new Promise(function (r) { setTimeout(r, 500); });
    window.__RENDER_ERR__ = window.__RENDER_ERR__ || null;

    var root = document.getElementById('r1');
    function snapshot() {
      var selects = Array.from(root.querySelectorAll('select'));
      return {
        text: root.textContent,
        maxSwitches: root.querySelectorAll('.dsm-workbuddy-xdpool-maxmode input').length,
        effortSelects: root.querySelectorAll('.dsm-workbuddy-xdpool-model-effort select').length,
        effortDisabled: selects.map(function (s) { return s.disabled; }),
        effortValues: selects.map(function (s) { return s.value; }),
        effortOptions: selects.map(function (s) { return Array.from(s.options).map(function (o) { return o.value; }); }),
        budgetRadios: root.querySelectorAll('.dsm-workbuddy-xdpool-model-budget input[type=radio]').length,
      };
    }
    window.__SNAP__ = snapshot;

    window.__RESULT__ = { ok: true, cardId: window.__CARD_ID__, snap: snapshot(), renderErr: window.__RENDER_ERR__, console: window.__CONSOLE__ };
  } catch (e) {
    window.__RESULT__ = { ok: false, error: String(e && e.message || e), stack: String(e && e.stack || '') };
  }
})();
</script>`;

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// 用户数据目录放TEMP 且**不删除**：留在工作区里删目录会触发批量删除保护，
// 而一个几十 MB 的临时 profile 不值得为它绕一次沙箱（mount-browser-test 同款）。
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu',
  '--remote-debugging-port=' + CDP,
  '--user-data-dir=' + (process.env.TEMP || '.') + '/cdp-modelrow-' + Date.now(),
  '--no-first-run', '--no-default-browser-check',
  'about:blank',
], { stdio: 'ignore' });

function cdp(p, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: CDP, path: p, method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch { reject(new Error(String(b).slice(0, 80))); }
      });
    });
    r.on('error', reject);
    r.end();
  });
}

let sock = null;
const cleanup = () => {
  try { sock?.close(); } catch { /* 已关闭 */ }
  server.close();
  try { chrome.kill('SIGTERM'); } catch { /* 已退出 */ }
};

try {
  // 等 DevTools 就绪
  let target = null;
  for (let i = 0; i < 40 && target === null; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const list = await cdp('/json');
      target = Array.isArray(list) ? list.find((t) => t.type === 'page') : null;
    } catch { /* 还没起来 */ }
  }
  if (target === null) { bad('Chrome DevTools 未就绪'); cleanup(); process.exit(1); }

  sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });

  let id = 0;
  const pending = new Map();
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id;
    pending.set(mid, res);
    sock.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
  await new Promise((r) => setTimeout(r, 3000));

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };

  const result = await evalJs('window.__RESULT__');
  if (!result || result.ok !== true) {
    bad('页面执行失败: ' + JSON.stringify(result).slice(0, 400));
    console.log('  诊断 text=', JSON.stringify(String(result?.snap?.text || '').slice(0, 300)));
  } else {
    ok(`模型卡片已挂载（${result.cardId}）`);
    const s = result.snap;
    // 诊断：模型区没渲染出来时，把实际文本打出来才知道是fetch 没命中还是选择器不对
    if (s.effortSelects === 0) {
      console.log('  诊断 text=', JSON.stringify(String(s.text).slice(0, 300)));
      if (result.renderErr) console.log('  诊断 renderErr=', String(result.renderErr).slice(0, 300));
      if (result.console?.length) console.log('  诊断 console=', JSON.stringify(result.console).slice(0, 300));
    }

    // 1) Max 模式开关
    if (s.maxSwitches === 1) ok('渲染出 1 个 Max 模式开关');
    else bad(`Max 模式开关数量应为 1，实际 ${s.maxSwitches}`);

    // 2) 思考强度下拉：只有两个模型有思考档位，所以应为 2 个
    if (s.effortSelects === 2) ok('两个支持思考的模型各有一个思考强度下拉');
    else bad(`思考强度下拉应为 2 个，实际 ${s.effortSelects}`);

    // 3) 选项内容：hy4-preview 有 low/medium/high/max，hy3 只有 low/high
    const opts = s.effortOptions;
    if (opts[0] && opts[0].includes('') && opts[0].includes('low') && opts[0].includes('max')) {
      ok('第一个下拉含「默认」与模型支持的档位');
    } else bad('第一个下拉的选项不对: ' + JSON.stringify(opts[0]));
    if (opts[1] && opts[1].includes('low') && opts[1].includes('high') && !opts[1].includes('medium')) {
      ok('第二个下拉只含该模型真实支持的档位（没有 medium）');
    } else bad('第二个下拉的选项不对: ' + JSON.stringify(opts[1]));

    // 4) 已保存的档位回显
    if (s.effortValues[0] === 'high') ok('已保存的 high 档位正确回显');
    else bad(`应回显 high，实际 ${s.effortValues[0]}`);

    // 5) 上下文单选仍在
    if (s.budgetRadios > 0) ok(`上下文窗口单选仍在（${s.budgetRadios} 个）`);
    else bad('上下文窗口单选消失了');

    // 6) 切到 Max 模式后：下拉禁用 + 行内出现标记
    await evalJs(`
      (function () {
        window.__STATUS__ = Object.assign({}, window.__STATUS__, {
          selection: Object.assign({}, window.__STATUS__.selection, { maxMode: true })
        });
        window.__REMOUNT__ = true;
        return true;
      })()
    `);
    // 用新数据重挂载（卡片只在挂载时拉一次状态）
    await evalJs(`
      (function () {
        var el = document.getElementById('r1');
        ReactDOM.unmountComponentAtNode(el);
        ReactDOM.render(React.createElement(window.__CARD__, {}), el);
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 500));
    const snap2 = await evalJs('window.__SNAP__()');
    if (snap2.effortDisabled.length === 2 && snap2.effortDisabled.every(Boolean)) {
      ok('Max 模式打开后思考强度下拉被禁用（不会与开关打架）');
    } else bad('Max 模式下应禁用思考强度下拉，实际 ' + JSON.stringify(snap2.effortDisabled));
    if (snap2.text.indexOf('Max mode') >= 0 || snap2.text.indexOf('Max 模式') >= 0) {
      ok('Max 模式打开后模型行出现标记');
    } else bad('Max 模式打开后模型行没有标记');
  }
} catch (e) {
  bad('浏览器测试异常: ' + String(e && e.message ? e.message : e).slice(0, 200));
} finally {
  cleanup();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);