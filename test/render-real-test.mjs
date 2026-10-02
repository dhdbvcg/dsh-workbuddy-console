/**
 * 用真实 React 渲染客户端组件（react-dom/server）。
 *
 * 为什么必须有这个测试：
 *   假渲染器只验证"元素创建不抛错"，不验证"渲染出内容"。
 *   v1.4.0~1.4.2 连续三版在真实 DSH 里渲染成空白页，
 *   原因是把 child 当 jsx() 第三参传（那是 key，会被静默丢弃），
 *   198 项测试全绿也没拦住 —— 因为没有一个测试真的渲染过组件。
 *
 * 本文件用 scratch-gui 里的真实 react + react-dom 渲染：
 *   - SkillsSection 必须输出 <iframe> 和可见文本
 *   - SkillPicker 必须输出 ⚡ WorkBuddy 按钮
 *   - CreditBadge 不崩（无数据时返回 null 是合法行为）
 *
 * 若 react/react-dom 不可用（如 CI 环境没有 scratch-gui），跳过并说明。
 */
import path from 'node:path';
import vm from 'node:vm';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const GUI = 'C:/Users/dell/scratch-gui/node_modules';
let React = null;
let renderToString = null;
let require2 = null;

try {
  const { createRequire } = await import('node:module');
  require2 = createRequire(path.join(GUI, 'noop.js'));
  React = require2('react');
  ({ renderToString } = require2('react-dom/server'));
} catch {
  console.log('跳过：本机没有可用的 react/react-dom（需要 C:/Users/dell/scratch-gui/node_modules）');
  process.exit(0);
}

const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message);
    fail++;
  }
}

/** 加载 bundle 并 apply 到一个受 inject 门禁保护的假 ctx */
function loadBundle() {
  let mod = null;
  let declared = [];
  const sandbox = {
    window: {},
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, dataset: {}, setAttribute() {} }),
      head: { appendChild() {} },
      documentElement: { lang: 'zh-CN' },
    },
    console,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    require: (name) => {
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require2('react/jsx-runtime');
      throw new Error('unexpected require ' + name);
    },
  };
  sandbox.window.__ModuleLoader__ = {
    load: ({ factory }) => {
      mod = factory(sandbox.require);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(clientSrc, sandbox, { filename: 'client.js' });

  const services = {
    locale: { register: () => () => {}, bind: () => (k) => k },
    slots: {
      inject: (slot, fn) => fn(),
      register: (meta, comp) => {
        mod.__registered = mod.__registered || [];
        mod.__registered.push({ meta, comp });
        return () => {};
      },
    },
  };
  const ctx = new Proxy(
    { effect: (fn) => fn(), get: (n) => (declared.includes(n) ? services[n] : undefined) },
    {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop !== 'string') return t[prop];
        if (declared.includes(prop)) return services[prop];
        throw new Error(`cannot get property "${prop}" without inject`);
      },
    },
  );
  declared = mod.inject || [];
  mod.apply(ctx);
  return mod;
}

const mod = loadBundle();
const byId = {};
for (const r of mod.__registered || []) byId[r.meta.id] = r.comp;

function renderToHtml(comp, props = {}) {
  return renderToString(React.createElement(comp, props));
}

function visibleText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

console.log('\n真实渲染（react-dom/server）');

t('SkillsSection 渲染出 <iframe>（设置页的核心内容）', () => {
  const html = renderToHtml(byId['workbuddy-console']);
  assertOK(html.includes('<iframe'), '没有 iframe 元素 —— children 又被丢了？\n  HTML: ' + html.slice(0, 200));
});

t('SkillsSection 渲染出可见文本', () => {
  const html = renderToHtml(byId['workbuddy-console']);
  assertOK(visibleText(html).length > 0, '没有任何可见文本');
});

t('iframe 的 src 指向 /wb-console/', () => {
  const html = renderToHtml(byId['workbuddy-console']);
  assertOK(html.includes('src="/wb-console/'), 'iframe src 不对');
});

t('SkillPicker 渲染出 ⚡ WorkBuddy 按钮', () => {
  const html = renderToHtml(byId['workbuddy-skill-picker']);
  assertOK(html.includes('WorkBuddy'), '按钮文本被丢弃（jsx 第三参陷阱）\n  HTML: ' + html.slice(0, 200));
  assertOK(html.includes('dsh-wbc-trigger'), '缺少按钮样式类');
});

t('CreditBadge 无数据时返回空（不崩即可）', () => {
  const html = renderToHtml(byId['workbuddy-credit']);
  assertOK(typeof html === 'string', '渲染失败');
});

t('所有渲染输出无 React key 警告（stderr 检查在运行器层面）', () => {
  // key 警告走 console.error；这里用一个捕获过的 console 再渲染一遍
  const warnings = [];
  const origErr = console.error;
  console.error = (...a) => warnings.push(a.join(' '));
  try {
    renderToHtml(byId['workbuddy-skill-picker']);
    renderToHtml(byId['workbuddy-console']);
  } finally {
    console.error = origErr;
  }
  const keyWarn = warnings.filter((w) => w.includes('unique "key" prop'));
  assertOK(keyWarn.length === 0, '存在 key 警告:\n  ' + keyWarn[0]?.slice(0, 200));
});

function assertOK(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
