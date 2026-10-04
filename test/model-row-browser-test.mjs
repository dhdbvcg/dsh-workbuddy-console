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
        // 计数：保存成功后必须立即刷一次 status（否则界面回落到最多
        // 30 秒前的旧状态，看起来像「点了保存好几秒才生效」）。
        window.__STATUS_FETCHES__ = (window.__STATUS_FETCHES__ || 0) + 1;
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(JSON.stringify(window.__STATUS__))); } });
      }
      return realFetch.apply(window, arguments);
    };

    var mod = null, declared = [], registered = {};
    // settingsScope 桩。
    //
    // 关键：writable: true 是这张卡片可写的**前提**（卡片用
    // settingsScope?.getSnapshot().writable === true 判定 modelsEditable）。
    // 之前这个桩没给 writable，导致 modelsEditable 恒为 false ——
    // 「只翻 Max 模式点保存」自然写不进任何东西，那是**桩不对**，
    // 不是被测代码的锅。桩必须对齐真实契约，否则测的是幻觉。
    window.__SCOPE__ = {
      getSnapshot: function () { return { writable: true, formStatus: 'idle' }; },
      set: function (k, v) { window.__SAVED__ = { key: k, value: v }; return Promise.resolve(); }
    };
    var settingsScope = window.__SCOPE__;
    // t 桩：**唯一一份**，props 与 locale.bind 都用它。
    //
    // 之前分成两套（props 传一个、locale.bind 另一个），行为还不一致：
    // props 那套只替换 key 里的占位符，而 key 里根本没有占位符 ——
    // 于是 row.modelReasoning 渲染成裸 key，档位信息整个消失。
    //
    // 真实的 t 是「按 key 取文案 → 替换 {占位符}」。这里没有文案表，
    // 就把 key 当模板；key 里没有占位符时把变量值追加到末尾，
    // 这样「档位 / 个数」这类信息仍会出现在文本里，断言才看得见。
    window.__T__ = function (key, vars) {
      var out = String(key);
      if (vars) {
        var replaced = false;
        for (var k in vars) {
          var token = '{' + k + '}';
          if (out.indexOf(token) >= 0) { out = out.split(token).join(String(vars[k])); replaced = true; }
        }
        if (!replaced) {
          out += ' ' + Object.keys(vars).map(function (k) { return String(vars[k]); }).join(' ');
        }
      }
      return out;
    };
    var configForms = {
      describe: function () { return { getSnapshot: function () { return { view: { namespaces: [{ ns: 'llm-workbuddy-xdpool' }] } }; } }; },
      get: function (id) { return settingsScope; }
    };
    var services = {
      locale: {
        register: function () { return function () {}; },
        bind: function () { return window.__T__; }
      },
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
      ReactDOM.render(React.createElement(Comp, { t: window.__T__, settingsScope: window.__SCOPE__ }), document.getElementById('r1'));
    } catch (e) {
      window.__RENDER_ERR__ = String(e && e.stack || e);
    }
    await new Promise(function (r) { setTimeout(r, 500); });
    window.__RENDER_ERR__ = window.__RENDER_ERR__ || null;

    var root = document.getElementById('r1');
    function snapshot() {
      var selects = Array.from(root.querySelectorAll('select'));
      var saveBtn = Array.from(root.querySelectorAll('button')).filter(function (b) {
        return /row\.modelsSave/.test(b.textContent || '');
      })[0];
      return {
        text: root.textContent,
        maxSwitches: root.querySelectorAll('.dsm-workbuddy-xdpool-maxmode input').length,
        effortSelects: root.querySelectorAll('.dsm-workbuddy-xdpool-model-effort select').length,
        effortDisabled: selects.map(function (s) { return s.disabled; }),
        effortValues: selects.map(function (s) { return s.value; }),
        effortOptions: selects.map(function (s) { return Array.from(s.options).map(function (o) { return o.value; }); }),
        budgetRadios: root.querySelectorAll('.dsm-workbuddy-xdpool-model-budget input[type=radio]').length,
        saveBtnFound: !!saveBtn,
        saveBtnDisabled: saveBtn ? saveBtn.disabled : null,
      };
    }
    window.__SNAP__ = snapshot;

    /**
     * 真实点一次「保存」，返回 settingsScope 实际收到的 payload。
     *
     * 这一步是必需的：Max 模式是区域级开关，单独翻它**不会创建模型草稿**。
     * 如果 saveModels 入口还写着 draft 为空就 return，那么
     * 「只开 Max 模式 → 点保存」会静默什么也不发生 —— 按钮是亮的（modelsDirty
     * 算上了 maxMode），点了没反应，也不报错。这个坑只能靠真点一次才看得见。
     */
    window.__SAVE__ = function () {
      window.__SAVED__ = undefined;
      var btn = Array.from(root.querySelectorAll('button')).filter(function (b) {
        return /row\.modelsSave/.test(b.textContent || '');
      })[0];
      if (!btn) return { clicked: false, reason: 'no save button' };
      if (btn.disabled) return { clicked: false, reason: 'save button disabled' };
      btn.click();
      return { clicked: true };
    };

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

    // 2) 思考强度下拉必须**不存在** —— 档位选择已搬去 DSH 自带的推理等级列表。
       // 插件卡片再放一套就是重复实现，且两套容易各说各话（用户明确要求删掉）。
    if (s.effortSelects === 0) ok('卡片里没有思考强度下拉（已交给 DSH 自带的推理等级列表）');
    else bad(`卡片里不该再有思考强度下拉，实际 ${s.effortSelects} 个`);

    // 3) 模型行仍要如实列出该模型支持的档位（供对照，不是选择器）
    //    t 桩回显 key，所以断言针对 key 文本；占位符已被替换成真实档位。
    const text = String(s.text);
    if (/row\.modelReasoning/.test(text)) ok('模型行仍列出各模型真实支持的思考档位');
    else bad('模型行没有显示思考档位信息');
    if (/\bhigh\b/.test(text)) ok('模型行显示了 high 档位（来自 supportedEfforts）');
    else bad('模型行没有显示 high 档位');

    // 5) 上下文单选仍在
    if (s.budgetRadios > 0) ok(`上下文窗口单选仍在（${s.budgetRadios} 个）`);
    else bad('上下文窗口单选消失了');

    // 6) 切到 Max 模式后：行内出现标记（不再有下拉需要禁用）
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
        ReactDOM.render(React.createElement(window.__CARD__, { t: window.__T__, settingsScope: window.__SCOPE__ }), el);
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 500));
    const snap2 = await evalJs('window.__SNAP__()');
    if (snap2.effortSelects === 0) ok('Max 模式下依然没有思考强度下拉');
    else bad(`Max 模式下不该出现下拉，实际 ${snap2.effortSelects}`);
    if (/row\.modelMaxMode/.test(String(snap2.text))) {
      ok('Max 模式打开后模型行出现标记');
    } else bad('Max 模式打开后模型行没有标记');

    // —— 7) 关键流程：只翻 Max 模式、一个模型都不改，直接点保存 ——
    // 这条路径不创建模型草稿，saveModels 若还用 `draft === void 0` 早退，
    // 就会「按钮亮着、点了没反应」。必须真点一次按钮看 payload 有没有到。
    await evalJs(`
      (function () {
        window.__STATUS__ = Object.assign({}, window.__STATUS__, {
          selection: Object.assign({}, window.__STATUS__.selection, { maxMode: false })
        });
        var el = document.getElementById('r1');
        ReactDOM.unmountComponentAtNode(el);
        ReactDOM.render(React.createElement(window.__CARD__, { t: window.__T__, settingsScope: window.__SCOPE__ }), el);
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 500));

    // 翻转 Max 模式开关（用原生 setter 触发 React 的 onChange）
    const flipped = await evalJs(`
      (function () {
        var cb = document.querySelector('.dsm-workbuddy-xdpool-maxmode input');
        if (!cb) return { ok: false, reason: 'no maxmode checkbox' };
        var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
        setter.call(cb, true);
        cb.dispatchEvent(new window.Event('click', { bubbles: true }));
        return { ok: true };
      })()
    `);
    if (!flipped.ok) bad('找不到 Max 模式开关：' + flipped.reason);

    await new Promise((r) => setTimeout(r, 250));
    const snap3 = await evalJs('window.__SNAP__()');
    if (snap3.saveBtnFound) ok('找到「保存」按钮');
    else bad('找不到「保存」按钮');
    if (snap3.saveBtnDisabled === false) {
      ok('只翻 Max 模式后保存按钮变为可用');
    } else {
      bad(`只翻 Max 模式后保存按钮应可用，实际 disabled=${snap3.saveBtnDisabled}`);
    }

    const clickRes = await evalJs('window.__SAVE__()');
    await new Promise((r) => setTimeout(r, 400));
    const saved = await evalJs('window.__SAVED__ || null');
    if (!clickRes.clicked) {
      bad('点保存没反应：' + clickRes.reason);
    } else if (!saved) {
      // 保存失败时卡片会把原因写进 error 状态；把它读出来才知道卡在哪。
      const errText = await evalJs(`
        (function () {
          var el = document.querySelector('.dsm-workbuddy-xdpool-error') ||
                   Array.from(document.querySelectorAll('*')).filter(function (n) {
                     return /失败|Could not save|error/i.test(n.className || '');
                   })[0];
          return el ? el.textContent : '(没有错误提示元素)';
        })()
      `);
      bad('只翻 Max 模式点保存，settingsScope 没收到任何写入（静默失败）。页面提示: ' + String(errText).slice(0, 200));
    } else {
      ok('只翻 Max 模式点保存，确实写入了设置');
      if (saved.key === 'modelSelectionCn') ok('写入的是 modelSelectionCn');
      else bad(`写入的键不对: ${saved.key}`);
      const v = saved.value || {};
      if (v.maxMode === true) ok('保存的 payload 里 maxMode = true');
      else bad(`payload 里 maxMode 应为 true，实际 ${JSON.stringify(v.maxMode)}`);
      if (Array.isArray(v.enabledModelIds)) {
        ok(`payload 里的启用列表没丢（${v.enabledModelIds.length} 个）`);
      } else bad('payload 里没有 enabledModelIds');
      if (v.reasoningEfforts && v.reasoningEfforts['hy4-preview'] === 'high') {
        ok('未触碰的思考档位被原样带回（没被这次保存冲掉）');
      } else {
        bad('思考档位在这次保存中丢了：' + JSON.stringify(v.reasoningEfforts));
      }

      // 保存后必须立即刷新 status（不等 30 秒轮询），否则界面回落到
      // 旧状态，用户看到的就是「点了保存好几秒才生效」。
      // 第一次保存后 maxMode 草稿已清、桩里的 savedMaxMode=false，
      // 开关回到未勾选 —— 再翻一次制造脏状态，按钮才可点。
      const flip2 = await evalJs(`
        (function () {
          var cb = document.querySelector('.dsm-workbuddy-xdpool-maxmode input');
          if (!cb) return { ok: false };
          var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'checked').set;
          setter.call(cb, true);
          cb.dispatchEvent(new window.Event('click', { bubbles: true }));
          return { ok: true };
        })()
      `);
      await new Promise((r) => setTimeout(r, 250));
      const fetchesBefore = await evalJs('window.__STATUS_FETCHES__ || 0');
      const click2 = await evalJs('window.__SAVE__()');
      await new Promise((r) => setTimeout(r, 600));
      const fetchesAfter = await evalJs('window.__STATUS_FETCHES__ || 0');
      if (flip2.ok && click2.clicked && fetchesAfter > fetchesBefore) {
        ok(`保存触发了立即刷新（status 请求 ${fetchesBefore} -> ${fetchesAfter}）`);
      } else if (!click2.clicked) {
        bad('第二次点保存没反应：' + click2.reason);
      } else {
        bad(`保存后没有立即刷新 status（${fetchesBefore} -> ${fetchesAfter}），界面要等下一轮 30s 轮询`);
      }
    }
  }
} catch (e) {
  bad('浏览器测试异常: ' + String(e && e.message ? e.message : e).slice(0, 200));
} finally {
  cleanup();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);