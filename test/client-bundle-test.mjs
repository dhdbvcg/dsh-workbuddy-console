/**
 * 客户端 bundle 自检。
 *
 * 重点：验证 lib/client.js 能加载、注册到正确的插槽、
 * 且声明的 dsh.client.inject 覆盖了这些插槽的归属包。
 *
 * 为什么需要：客户端注册错误不会在单测阶段暴露 ——
 * 只有 DSH 启动或打开页面时才会报错。这类问题必须静态挡掉。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

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

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const clientSrc = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8');

console.log('\n加载协议');

t('使用 __ModuleLoader__.load 且声明了 id', () => {
  assert.match(clientSrc, /__ModuleLoader__\.load\(/);
  const m = /id:\s*['"]([^'"]+)['"]/.exec(clientSrc);
  assert.ok(m, '缺少 id');
  assert.equal(m[1], pkg.name, 'bundle 的 id 应与包名一致（DSH 用它定位模块）');
});

t('导出 apply 函数', () => {
  assert.match(clientSrc, /exports\.apply\s*=/);
});

console.log('\n插槽注册');

/**
 * 用一个假的 loader 执行 bundle，收集注册了哪些插槽。
 *
 * 关键：假的 ctx 必须**复刻 cordis 的 inject 门禁** ——
 * 没在 exports.inject 里声明的 service，访问时必须抛错。
 * 之前没模拟这个门禁，测试全绿但 DSH 里 ctx.locale 抛
 * "cannot get property locale without inject"，apply 整体失败，
 * 表现就是「设置里没有技能市场页、输入框没有按钮」。
 */
function loadBundle() {
  const registered = [];
  const injected = [];
  let declaredInject = null;

  const SERVICES = {
    locale: { register: () => () => {}, bind: () => (k) => k },
    slots: {
      inject(slot, fn) {
        injected.push(slot);
        fn();
      },
      register(meta) {
        registered.push(meta);
        return () => {};
      },
    },
  };

  /** 按 cordis 的规则造受门禁保护的 ctx：未声明的 service 读属性即抛错 */
  function makeCtx() {
    const declared = new Set(Array.isArray(declaredInject) ? declaredInject : []);
    const target = {
      effect(fn) {
        const d = fn();
        return typeof d === 'function' ? d : () => {};
      },
      get(name) {
        // cordis 的 ctx.get() 对未注册服务返回 undefined，不抛
        return declared.has(name) ? SERVICES[name] : undefined;
      },
    };
    return new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop !== 'string') return t[prop];
        if (declared.has(prop)) return SERVICES[prop];
        throw new Error(`cannot get property "${prop}" without inject`);
      },
    });
  }

  const sandbox = {
    window: {},
    document: {
      getElementById: () => null,
      createElement: () => ({ style: {}, dataset: {}, setAttribute() {} }),
      head: { appendChild() {} },
      documentElement: { lang: 'zh-CN' },
    },
    console,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    setInterval: () => 0,
    clearInterval: () => {},
  };
  sandbox.window.__ModuleLoader__ = {
    load: ({ id, factory }) => {
      assert.equal(id, 'dsh-workbuddy-console');
      const req = (name) => {
        if (name === 'react') {
          return {
            useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
            useEffect: () => {},
            useCallback: (fn) => fn,
            useRef: (v) => ({ current: v }),
            Fragment: 'Fragment',
            createElement: () => null,
            // ErrorBoundary 是 class 组件，需要 Component 基类
            Component: class Component {
              constructor(props) {
                this.props = props || {};
              }
            },
          };
        }
        if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null };
        throw new Error('未预期的依赖: ' + name);
      };
      const mod = factory(req);
      assert.ok(mod && typeof mod.apply === 'function', 'factory 应返回带 apply 的模块');
      declaredInject = mod.inject;
      mod.apply(makeCtx());
    },
  };

  vm.createContext(sandbox);
  vm.runInContext(clientSrc, sandbox, { filename: 'client.js' });
  return { registered, injected, declaredInject };
}

let loaded = null;
t('bundle 能被加载并调用 apply', () => {
  loaded = loadBundle();
  assert.ok(loaded.registered.length > 0, '应至少注册一个插槽');
});

// 回归：曾经漏了 exports.inject，导致 DSH 里
// "cannot get property locale without inject" —— apply 整体失败，
// 设置页与输入框按钮都不出现。
t('导出 inject 且包含 slots 与 locale', () => {
  assert.ok(Array.isArray(loaded.declaredInject), 'exports.inject 必须是数组');
  assert.ok(loaded.declaredInject.includes('slots'), 'inject 缺少 slots');
  assert.ok(loaded.declaredInject.includes('locale'), 'inject 缺少 locale');
});

t('apply 在 cordis 门禁下不抛错（未声明的 service 会抛）', () => {
  // loadBundle 内部的假 ctx 会对未声明的 service 抛错，
  // 所以能走到这里就说明 apply 没有越权访问
  assert.ok(loaded.registered.length >= 3, 'apply 应完成全部注册');
});

t('注册到 conversation.input.left（输入框技能选择器）', () => {
  const names = loaded.registered.map((r) => r.name);
  assert.ok(names.includes('conversation.input.left'), '缺少输入框插槽，实际: ' + names.join(', '));
});

t('注册到 conversation.composer.dock（积分显示）', () => {
  const names = loaded.registered.map((r) => r.name);
  assert.ok(names.includes('conversation.composer.dock'), '缺少 dock 插槽，实际: ' + names.join(', '));
});

t('注册到 settings.section（插件面板）', () => {
  const names = loaded.registered.map((r) => r.name);
  assert.ok(names.includes('settings.section'), '缺少设置插槽，实际: ' + names.join(', '));
});

t('每个注册都带 id 与 order', () => {
  for (const r of loaded.registered) {
    assert.ok(r.id, `插槽 ${r.name} 缺少 id`);
    assert.equal(typeof r.order, 'number', `插槽 ${r.name} 缺少 order`);
  }
});

t('注册的插槽名都在 injected 列表里（否则 DSH 会拒绝）', () => {
  for (const r of loaded.registered) {
    assert.ok(loaded.injected.includes(r.name), `注册了 ${r.name} 但没有 inject 它`);
  }
});

console.log('\ndsh.client.inject 覆盖');

t('inject 列表非空', () => {
  const list = pkg.dsh && pkg.dsh.client && pkg.dsh.client.inject;
  assert.ok(Array.isArray(list) && list.length > 0, '缺少 dsh.client.inject');
});

t('包含 ui-slots 与 locale（注册插槽的最小依赖）', () => {
  const list = pkg.dsh.client.inject;
  assert.ok(list.includes('@deepseek-ai/dsh-client-ui-slots'), '缺少 ui-slots');
  assert.ok(list.includes('@deepseek-ai/dsh-client-locale'), '缺少 locale');
});

t('包含 ui-conversation（它拥有输入框插槽）', () => {
  const list = pkg.dsh.client.inject;
  assert.ok(
    list.includes('@deepseek-ai/dsh-client-ui-conversation'),
    '注册 conversation.* 插槽必须 inject 拥有它的包，否则运行时拿不到插槽',
  );
});

t('包含 ui-settings（它拥有 settings.section）', () => {
  const list = pkg.dsh.client.inject;
  assert.ok(list.includes('@deepseek-ai/dsh-client-ui-settings'), '缺少 ui-settings');
});

console.log('\n源码卫生');

t('使用 command() 调用技能（DSH 原生命令接口）', () => {
  assert.match(clientSrc, /\.command\(/, '应通过 composer 的 command() 调用技能');
});

t('拿不到 command 时如实告知，不假装成功', () => {
  assert.match(clientSrc, /useUnavailable|no-command/, '应有「无法自动调用」的分支');
});

t('样式只注入一次（按 id 去重）', () => {
  assert.match(clientSrc, /getElementById\(STYLE_ID\)/, '应检查样式是否已注入');
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
