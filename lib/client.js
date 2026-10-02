/**
 * dsh-workbuddy-console —— 浏览器端。
 *
 * 三个功能：
 *   A. 输入框工具行的技能选择器（conversation.input.left）
 *   B. 输入框下方的积分消耗显示（conversation.composer.dock）
 *   C. 设置面板里的「WorkBuddy 技能市场」页（settings.section）
 *
 * 关键事实（都踩过坑）：
 *   1. exports.inject 必须导出 ['slots','locale']，否则 ctx.locale 抛错、apply 全崩。
 *   2. jsx-runtime 的签名是 jsx(type, props, key)：children 必须放 props.children。
 *      把 child 当第三参传会被静默丢弃 —— 曾造成连续四版空白页。
 *   3. conversation.input.left 的 renderSlot 传空 props：宿主不暴露 command()。
 *      所以「使用技能」走 DOM 方案 —— 把 /技能名 写进输入框并模拟回车，
 *      等价于用户手打，走 DSH 原生的用户显式技能调用路径。
 *   4. 弹层配色必须跟随宿主主题（浅色→白、深色→黑），检测逻辑见 detectTheme()。
 */

window.__ModuleLoader__.load({
  id: 'dsh-workbuddy-console',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let react = require('react');
    let jsxRuntime = require('react/jsx-runtime');

    const API = '/wb-console/api';
    const NS = 'workbuddy-console';
    /** 与 package.json 的 name 一致；cordis 用它定位模块 */
    const pkgName = 'dsh-workbuddy-console';

    //#region 样式（主题感知：dsh-wbc-light / dsh-wbc-dark）
    const STYLE_ID = 'dsh-wbconsole-style';
    let styleInjected = false;
    function ensureStyle() {
      if (styleInjected) return;
      if (typeof document === 'undefined') return;
      if (document.getElementById(STYLE_ID)) {
        styleInjected = true;
        return;
      }
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
.dsh-wbc-root{display:flex;flex-direction:column;gap:10px;min-width:0}
.dsh-wbc-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-wbc-input{flex:1;min-width:120px;border-radius:8px;padding:5px 9px;font-size:12px;border:1px solid}
.dsh-wbc-btn{display:inline-flex;align-items:center;gap:5px;background:transparent;
  border:1px solid;border-radius:8px;padding:4px 10px;font-size:12px;line-height:18px;cursor:pointer}
.dsh-wbc-btn:hover:not(:disabled){border-color:#5686fe}
.dsh-wbc-btn:disabled{opacity:.5;cursor:default}
.dsh-wbc-btn-primary{font-weight:600}
.dsh-wbc-btn-danger{color:#ef4444}
.dsh-wbc-meta{font-size:11px;line-height:16px}
.dsh-wbc-list{display:flex;flex-direction:column;max-height:340px;overflow:auto}
.dsh-wbc-row{display:flex;align-items:flex-start;gap:10px;padding:9px 2px;border-top:1px solid}
.dsh-wbc-row:first-child{border-top:none}
.dsh-wbc-rowmain{flex:1;min-width:0}
.dsh-wbc-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-wbc-desc{font-size:12px;line-height:16px;margin-top:2px;word-break:break-word}
.dsh-wbc-tag{font-family:ui-monospace,Consolas,monospace;font-size:11px}
.dsh-wbc-actions{display:flex;gap:6px;flex:0 0 auto;align-items:center}

/* 主题：深色（默认） */
.dsh-wbc-dark{background:#22252c;color:#e6e9ef}
.dsh-wbc-dark .dsh-wbc-input{background:#1b1d22;color:inherit;border-color:#3a3d45}
.dsh-wbc-dark .dsh-wbc-btn{color:inherit;border-color:#3a3d45}
.dsh-wbc-dark .dsh-wbc-btn-primary{background:#22a06b;border-color:transparent;color:#fff}
.dsh-wbc-dark .dsh-wbc-meta,.dsh-wbc-dark .dsh-wbc-desc{color:#9aa0a8}
.dsh-wbc-dark .dsh-wbc-tag{color:#9aa0a8}
.dsh-wbc-dark .dsh-wbc-row{border-color:#2c2f36}
.dsh-wbc-dark .dsh-wbc-empty{color:#9aa0a8}

/* 主题：浅色 */
.dsh-wbc-light{background:#ffffff;color:#1f2329}
.dsh-wbc-light .dsh-wbc-input{background:#f5f6f8;color:#1f2329;border-color:#d8dce3}
.dsh-wbc-light .dsh-wbc-btn{color:#1f2329;border-color:#c9cfda}
.dsh-wbc-light .dsh-wbc-btn:hover:not(:disabled){border-color:#2563eb;color:#2563eb}
.dsh-wbc-light .dsh-wbc-btn-primary{background:#22a06b;border-color:transparent;color:#fff}
.dsh-wbc-light .dsh-wbc-btn-primary:hover:not(:disabled){color:#fff}
.dsh-wbc-light .dsh-wbc-btn-danger{color:#ef4444}
.dsh-wbc-light .dsh-wbc-meta,.dsh-wbc-light .dsh-wbc-desc,.dsh-wbc-light .dsh-wbc-tag{color:#6b7280}
.dsh-wbc-light .dsh-wbc-row{border-color:#eceef2}
.dsh-wbc-light .dsh-wbc-empty{color:#6b7280}

/* 对话输入框下方的积分条 */
.dsh-wbcredit{display:flex;align-items:center;gap:6px;justify-content:center;padding:2px 0 0;
  font-size:11px;line-height:16px;font-variant-numeric:tabular-nums;user-select:none}
.dsh-wbcredit-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;background:#22a06b;opacity:.75}
.dsh-wbcredit-text{white-space:nowrap}
.dsh-wbcredit-calls{opacity:.7}

/* 输入框工具行的技能按钮 */
.dsh-wbc-trigger{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;
  border:1px solid;border-radius:13px;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.dsh-wbc-trigger:hover{border-color:#5686fe;color:#5686fe}
.dsh-wbc-trigger[data-active="1"]{border-color:#22a06b;color:#22a06b}
.dsh-wbc-trigger.dsh-wbc-dark{color:#c6c9d0;border-color:#3a3d45;background:transparent}
.dsh-wbc-trigger.dsh-wbc-light{color:#3a4150;border-color:#c9cfda;background:#fff}
.dsh-wbc-flash{font-size:11px;margin-left:6px}
.dsh-wbc-flash.dsh-wbc-dark{color:#9aa0a8}
.dsh-wbc-flash.dsh-wbc-light{color:#6b7280}

/* 选择器浮层 */
.dsh-wbc-pop{position:fixed;z-index:9000;width:min(460px,calc(100vw - 24px));
  max-height:min(62vh,480px);display:flex;flex-direction:column;border-radius:12px;overflow:hidden}
.dsh-wbc-pophead{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid}
.dsh-wbc-dark .dsh-wbc-pophead{border-color:#3a3d45}
.dsh-wbc-light .dsh-wbc-pophead{border-color:#eceef2}
.dsh-wbc-popbody{overflow:auto;padding:0 12px 10px}
.dsh-wbc-popfoot{padding:8px 12px;border-top:1px solid;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-wbc-dark .dsh-wbc-popfoot{border-color:#3a3d45}
.dsh-wbc-light .dsh-wbc-popfoot{border-color:#eceef2}
.dsh-wbc-empty{padding:18px 4px;font-size:12px;text-align:center}
.dsh-wbc-back{position:fixed;inset:0;z-index:8999}
.dsh-wbc-dark.dsh-wbc-pop{box-shadow:0 12px 32px rgba(0,0,0,.42)}
.dsh-wbc-light.dsh-wbc-pop{box-shadow:0 12px 32px rgba(15,23,42,.16)}
`;
      document.head.appendChild(style);
      styleInjected = true;
    }
    // apply 阶段就注入，不依赖组件挂载
    try {
      ensureStyle();
    } catch {
      /* 无 document 的环境忽略 */
    }
    //#endregion

    /**
     * 错误边界：组件抛错时显示可读信息而不是一片空白。
     */
    class ErrorBoundary extends react.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error, info) {
        console.error('[workbuddy-console] 组件渲染失败:', error, info && info.componentStack);
      }
      render() {
        if (this.state.error) {
          const msg = String((this.state.error && this.state.error.message) || this.state.error);
          return jsxRuntime.jsx('div', {
            className: 'dsh-wbc-empty',
            style: { color: '#ef4444', textAlign: 'left', whiteSpace: 'pre-wrap' },
            children: '技能市场渲染失败：' + msg,
          });
        }
        return this.props.children;
      }
    }

    /** 包一层边界 + 首帧前注入样式 */
    function guarded(Comp) {
      return function Guarded(props) {
        try {
          ensureStyle();
        } catch {
          /* 忽略 */
        }
        return jsxRuntime.jsx(ErrorBoundary, { children: jsxRuntime.jsx(Comp, { ...props }) });
      };
    }

    //#region 文案
    const ZH = {
      navLabel: 'WorkBuddy 技能市场',
      title: 'WorkBuddy 技能市场',
      search: '搜索技能…',
      load: '加载市场',
      loading: '加载中…',
      total: '共 {total} 个技能 · 已装 {installed} 个',
      installed: '已安装',
      install: '安装',
      installing: '安装中…',
      overwrite: '重装',
      uninstall: '卸载',
      empty: '没有找到技能。',
      dir: '安装位置：{dir}',
      hint: '安装后 DSH 会自动发现，无需重启。',
      invalidName: '命名不合规',
      pickerTitle: '选择要使用的技能',
      pickerEmpty: '还没有安装任何技能。先到设置里装一个。',
      pickerSearch: '筛选…',
      use: '使用',
      useHint: '点「使用」= 把 /技能名 填入输入框并调用',
      used: '已调用技能：{name}',
      filled: '已填入 /{name}，若未自动调用请按 Enter',
      noInput: '找不到输入框（会话可能还没就绪，稍后再试）',
      useFailed: '调用失败：{message}',
      close: '关闭',
      reload: '重新加载',
      failed: '加载失败：{message}',
      spent: '本对话消耗 {credit} 积分',
      calls: '{count} 次调用',
      noSpend: '本对话尚未产生消耗',
    };
    const EN = {
      navLabel: 'WorkBuddy skill market',
      title: 'WorkBuddy skill market',
      search: 'Search skills…',
      load: 'Load market',
      loading: 'Loading…',
      total: '{total} skills · {installed} installed',
      installed: 'Installed',
      install: 'Install',
      installing: 'Installing…',
      overwrite: 'Reinstall',
      uninstall: 'Uninstall',
      empty: 'No skills found.',
      dir: 'Install location: {dir}',
      hint: 'DSH discovers installed skills automatically — no restart needed.',
      invalidName: 'name not allowed',
      pickerTitle: 'Pick a skill to use',
      pickerEmpty: 'No skills installed yet. Install one from Settings first.',
      pickerSearch: 'Filter…',
      use: 'Use',
      useHint: 'Click "Use" to fill /skill into the composer and invoke it',
      used: 'Invoked skill: {name}',
      filled: 'Filled /{name} — press Enter if not invoked automatically',
      noInput: 'Composer not found (session may not be ready yet)',
      useFailed: 'Failed: {message}',
      close: 'Close',
      reload: 'Reload',
      failed: 'Load failed: {message}',
      spent: '{credit} credits this conversation',
      calls: '{count} calls',
      noSpend: 'No usage yet in this conversation',
    };

    /** 当前是否中文（用文档语言判断，不依赖 locale 服务） */
    function isZh() {
      if (typeof document === 'undefined') return true;
      return String(document.documentElement.lang || '').toLowerCase().startsWith('zh');
    }
    function tr(key, vars) {
      const dict = isZh() ? ZH : EN;
      const s = dict[key] || ZH[key] || key;
      if (!vars) return s;
      return String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] !== undefined ? String(vars[n]) : m));
    }
    //#endregion

    //#region 数据
    async function fetchJSON(url, init) {
      const r = await fetch(url, init);
      return r.json().catch(() => ({ ok: false, error: 'response not JSON' }));
    }
    const post = (p, body) =>
      fetchJSON(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const installedSkills = () => fetchJSON(API + '/skills/installed');
    const listSkills = (params) => fetchJSON(API + '/skills/list?' + new URLSearchParams(params || {}).toString());
    const installSkillApi = (body) => post('/skills/install', body);
    const uninstallSkillApi = (name) => post('/skills/uninstall', { name });
    //#endregion

    //#region 主题检测（浅色→白界面，深色→黑界面）
    /**
     * 判断宿主当前是浅色还是深色。
     * 依次看：data-theme/class 标记 → body 背景色亮度 → 系统偏好。
     * 检测不了的兜底是 dark（与 DSH 桌面端默认一致）。
     */
    function detectTheme() {
      try {
        const root = document.documentElement;
        const body = document.body;
        const marker = [root.getAttribute('data-theme'), root.getAttribute('class'), body && body.getAttribute('data-theme'), body && body.getAttribute('class')]
          .filter(Boolean)
          .join(' ');
        if (/\b(dark|night|black)\b/i.test(marker)) return 'dark';
        if (/\b(light|day|white)\b/i.test(marker)) return 'light';
        const el = body || root;
        const bg = typeof getComputedStyle === 'function' ? getComputedStyle(el).backgroundColor || '' : '';
        const m = bg.match(/-?\d+(\.\d+)?/g);
        if (m && m.length >= 3) {
          const lum = 0.2126 * Number(m[0]) + 0.7152 * Number(m[1]) + 0.0722 * Number(m[2]);
          return lum < 140 ? 'dark' : 'light';
        }
        if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
          return 'light';
        }
      } catch {
        /* 检测失败用默认 */
      }
      return 'dark';
    }
    //#endregion

    //#region 调用技能（DOM 方案）

    /**
     * 找到对话输入框。
     * renderSlot('conversation.input.left', {}) 传空 props，宿主不暴露 command，
     * 所以只能从 DOM 找：textarea 优先，其次 contenteditable，
     * 选视口里最靠底部的一个（composer 总在底部）。
     */
    function findComposerInput() {
      if (typeof document === 'undefined') return null;
      const cands = [];
      const visible = (el) => {
        try {
          const r = el.getBoundingClientRect();
          return r.width > 40 && r.height > 20;
        } catch {
          return false;
        }
      };
      if (document.querySelectorAll) {
        document.querySelectorAll('textarea').forEach((t) => {
          if (!t.disabled && visible(t)) cands.push({ el: t, kind: 'textarea' });
        });
        document.querySelectorAll('[contenteditable="true"]').forEach((t) => {
          if (visible(t)) cands.push({ el: t, kind: 'ce' });
        });
      }
      if (cands.length === 0) return null;
      cands.sort((a, b) => b.el.getBoundingClientRect().top - a.el.getBoundingClientRect().top);
      return cands[0];
    }

    /** 把命令文本写进输入框（React 受控组件需走原生 setter + input 事件） */
    function insertIntoInput(info, text) {
      const el = info.el;
      if (info.kind === 'textarea') {
        el.focus();
        const proto = typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const cur = el.value || '';
        const next = cur && !/\n\s*$/.test(cur) ? cur + '\n' + text : cur + text;
        if (desc && desc.set) desc.set.call(el, next);
        else el.value = next;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        try {
          el.selectionStart = el.selectionEnd = next.length;
        } catch {
          /* 忽略 */
        }
        return;
      }
      // contenteditable
      el.focus();
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        const ok = document.execCommand('insertText', false, text);
        if (!ok) throw new Error('execCommand failed');
      } catch {
        el.appendChild(document.createTextNode((el.textContent && !/\n\s*$/.test(el.textContent) ? '\n' : '') + text));
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    /** 模拟回车，让 composer 提交（提交 /技能名 即触发技能调用） */
    function pressEnter(el) {
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
      } catch {
        /* 模拟失败就让用户手按 */
      }
    }

    /**
     * 调用一个技能。
     * 1) 宿主若显式给了 command()（目前实测不給）就走它 —— 最正统；
     * 2) 否则把 /技能名 写进输入框并模拟回车 —— 等价手打，
     *    走 DSH 的用户显式技能调用（skill body 会作为 instructions 注入）。
     */
    async function invokeSkill(owner, name) {
      const line = '/' + name;
      if (owner && typeof owner.command === 'function') {
        try {
          const ok = await owner.command(line);
          if (ok) return { ok: true, via: 'command' };
        } catch {
          /* 落到 DOM 方案 */
        }
      }
      try {
        const info = findComposerInput();
        if (!info) return { ok: false, reason: 'no-input' };
        insertIntoInput(info, line);
        pressEnter(info.el);
        return { ok: true, via: 'dom' };
      } catch (e) {
        return { ok: false, reason: 'dom-error', error: (e && e.message) || String(e) };
      }
    }
    //#endregion

    //#region A. 输入框工具行：技能选择器

    function SkillPicker() {
      const [open, setOpen] = react.useState(false);
      const [state, setState] = react.useState({ loading: false, skills: [], error: '' });
      const [filter, setFilter] = react.useState('');
      const [flash, setFlash] = react.useState('');
      const [pos, setPos] = react.useState({ left: 12, bottom: 80 });
      const [theme, setTheme] = react.useState('dark');
      const btnRef = react.useRef(null);

      react.useEffect(() => {
        ensureStyle();
      }, []);

      const load = react.useCallback(async () => {
        setState((s) => ({ ...s, loading: true, error: '' }));
        try {
          const r = await installedSkills();
          if (!r.ok) setState({ loading: false, skills: [], error: r.error || 'failed' });
          else setState({ loading: false, skills: r.skills || [], error: '' });
        } catch (e) {
          setState({ loading: false, skills: [], error: (e && e.message) || String(e) });
        }
      }, []);

      react.useEffect(() => {
        if (!open) return;
        setTheme(detectTheme());
        const el = btnRef.current;
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect();
          setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 480)), bottom: Math.max(8, window.innerHeight - r.top + 8) });
        }
        load();
      }, [open, load]);

      const onUse = react.useCallback(async (skill) => {
        const res = await invokeSkill(null, skill.dir);
        if (res.ok) {
          setFlash(res.via === 'command' ? tr('used', { name: skill.dir }) : tr('filled', { name: skill.dir }));
          setOpen(false);
        } else if (res.reason === 'no-input') {
          setFlash(tr('noInput'));
        } else {
          setFlash(tr('useFailed', { message: res.error || res.reason }));
        }
      }, []);

      const h = jsxRuntime.jsx;
      const f = filter.trim().toLowerCase();
      const shown = f ? state.skills.filter((s) => (s.dir + ' ' + (s.description || '')).toLowerCase().includes(f)) : state.skills;
      const themeCls = theme === 'light' ? 'dsh-wbc-light' : 'dsh-wbc-dark';

      const list = shown.map((s) =>
        h('div', {
          className: 'dsh-wbc-row',
          key: s.dir,
          children: [
            h('div', {
              className: 'dsh-wbc-rowmain',
              key: 'main',
              children: [
                h('div', { className: 'dsh-wbc-name', key: 'n', children: s.dir }),
                h('div', { className: 'dsh-wbc-desc', key: 'd', children: String(s.description || '').slice(0, 140) }),
              ],
            }),
            h('div', {
              className: 'dsh-wbc-actions',
              key: 'act',
              children: h('button', { className: 'dsh-wbc-btn dsh-wbc-btn-primary', onClick: () => onUse(s), children: tr('use') }),
            }),
          ],
        }),
      );

      const trigger = h('button', {
        ref: btnRef,
        type: 'button',
        className: 'dsh-wbc-trigger ' + themeCls,
        'data-active': open ? '1' : '0',
        title: tr('pickerTitle'),
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          setFlash('');
          setOpen((v) => !v);
        },
        children: [
          h('span', { key: 'bolt', children: '⚡' }),
          h('span', { key: 'label', children: 'WorkBuddy' }),
        ],
      });

      const popup = open
        ? [
            h('div', { className: 'dsh-wbc-back', key: 'back', onClick: () => setOpen(false) }),
            h('div', {
              className: 'dsh-wbc-pop ' + themeCls,
              key: 'pop',
              style: { left: pos.left + 'px', bottom: pos.bottom + 'px' },
              children: [
                h('div', {
                  className: 'dsh-wbc-pophead',
                  key: 'head',
                  children: [
                    h('span', { style: { fontSize: '13px', fontWeight: 600, flex: 1 }, key: 't', children: tr('pickerTitle') }),
                    h('input', {
                      className: 'dsh-wbc-input',
                      key: 'q',
                      style: { flex: '0 1 160px', minWidth: '100px' },
                      placeholder: tr('pickerSearch'),
                      value: filter,
                      onChange: (e) => setFilter(e.target.value),
                    }),
                  ],
                }),
                h('div', {
                  className: 'dsh-wbc-popbody',
                  key: 'body',
                  children: state.loading
                    ? h('div', { className: 'dsh-wbc-empty', children: tr('loading') })
                    : state.error
                      ? h('div', { className: 'dsh-wbc-empty', children: tr('failed', { message: state.error }) })
                      : list.length === 0
                        ? h('div', { className: 'dsh-wbc-empty', children: tr('pickerEmpty') })
                        : list,
                }),
                h('div', {
                  className: 'dsh-wbc-popfoot',
                  key: 'foot',
                  children: [
                    h('span', { className: 'dsh-wbc-meta', style: { flex: 1 }, key: 'hint', children: tr('useHint') }),
                    h('button', { className: 'dsh-wbc-btn', onClick: load, key: 'r', children: tr('reload') }),
                    h('button', { className: 'dsh-wbc-btn', onClick: () => setOpen(false), key: 'c', children: tr('close') }),
                  ],
                }),
              ],
            }),
          ]
        : [];

      return h(react.Fragment, {
        children: [
          h('span', { key: 'triggerwrap', style: { display: 'inline-flex', alignItems: 'center' }, children: [trigger, flash ? h('span', { className: 'dsh-wbc-flash ' + themeCls, key: 'flash', children: flash }) : null] }),
          ...popup,
        ],
      });
    }

    //#endregion

    //#region B. 输入框下方：本对话积分消耗

    const POLL_MS = 3000;

    function CreditBadge(owner) {
      const sessionId = owner && (owner.sessionId || (owner.session && owner.session.id) || owner.id);
      const [state, setState] = react.useState({ credit: 0, calls: 0, ready: false });
      const alive = react.useRef(true);

      react.useEffect(() => {
        ensureStyle();
        alive.current = true;
        async function poll() {
          try {
            const url = API + '/credit' + (sessionId ? '?session=' + encodeURIComponent(sessionId) : '');
            const r = await fetch(url, { headers: { Accept: 'application/json' } });
            if (!r.ok) return;
            const d = await r.json();
            if (alive.current) setState({ credit: Number(d.credit) || 0, calls: Number(d.calls) || 0, ready: true });
          } catch {
            /* 宿主不可达时静默 */
          }
        }
        poll();
        const timer = setInterval(poll, POLL_MS);
        return () => {
          alive.current = false;
          clearInterval(timer);
        };
      }, [sessionId]);

      if (!state.ready) return null;

      const text = state.credit > 0 ? tr('spent', { credit: state.credit.toFixed(2) }) : tr('noSpend');
      return jsxRuntime.jsxs('div', {
        className: 'dsh-wbcredit',
        title: tr('calls', { count: state.calls }),
        children: [
          jsxRuntime.jsx('span', { className: 'dsh-wbcredit-dot' }),
          jsxRuntime.jsx('span', { className: 'dsh-wbcredit-text', children: text }),
          state.calls > 0 ? jsxRuntime.jsx('span', { className: 'dsh-wbcredit-calls', children: state.calls + '×' }) : null,
        ],
      });
    }

    //#endregion

    //#region C. 设置页：技能市场（原生组件，只显示市场）

    function SkillsSection() {
      const h = jsxRuntime.jsx;
      const [state, setState] = react.useState({
        loading: false, loaded: false, error: '', total: 0, page: 1,
        skills: [], installed: [], skillsDir: '',
      });
      const [keyword, setKeyword] = react.useState('');
      const [busy, setBusy] = react.useState('');
      const [theme, setTheme] = react.useState('dark');
      const alive = react.useRef(true);

      react.useEffect(() => {
        ensureStyle();
        alive.current = true;
        setTheme(detectTheme());
        return () => {
          alive.current = false;
        };
      }, []);

      const load = react.useCallback(async (kw, page) => {
        setState((s) => ({ ...s, loading: true, error: '' }));
        try {
          const params = { page: page || 1, pageSize: 30 };
          if (kw) params.keyword = kw;
          const r = await listSkills(params);
          if (!alive.current) return;
          if (!r.ok) {
            setState((s) => ({ ...s, loading: false, loaded: true, error: r.error || 'failed' }));
            return;
          }
          setState((s) => ({
            ...s,
            loading: false,
            loaded: true,
            error: '',
            total: r.total || 0,
            page: page || 1,
            skills: r.skills || [],
            installed: r.installed || [],
            skillsDir: r.skillsDir || '',
          }));
        } catch (e) {
          if (alive.current) setState((s) => ({ ...s, loading: false, loaded: true, error: (e && e.message) || String(e) }));
        }
      }, []);

      react.useEffect(() => {
        load('', 1);
      }, [load]);

      const onInstall = react.useCallback(
        async (skill, overwrite) => {
          setBusy(skill.name);
          try {
            const r = await installSkillApi({
              skillId: skill.skillId,
              name: skill.name,
              version: skill.version,
              overwrite: !!overwrite,
            });
            if (!r.ok) setState((s) => ({ ...s, error: r.error || 'install failed' }));
            await load(keyword, state.page);
          } finally {
            setBusy('');
          }
        },
        [keyword, state.page, load],
      );

      const onUninstall = react.useCallback(
        async (name) => {
          setBusy(name);
          try {
            const r = await uninstallSkillApi(name);
            if (!r.ok) setState((s) => ({ ...s, error: r.error || 'uninstall failed' }));
            await load(keyword, state.page);
          } finally {
            setBusy('');
          }
        },
        [keyword, state.page, load],
      );

      const h2 = jsxRuntime.jsxs;
      const installedSet = new Set(state.installed);
      const themeCls = theme === 'light' ? 'dsh-wbc-light' : 'dsh-wbc-dark';

      const rows = state.skills.map((s) => {
        const isIn = installedSet.has(s.name);
        const okName = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name || '');
        return h2('div', {
          className: 'dsh-wbc-row',
          key: s.skillId || s.name,
          children: [
            h('div', {
              className: 'dsh-wbc-rowmain',
              key: 'main',
              children: [
                h('div', {
                  className: 'dsh-wbc-name',
                  key: 'n',
                  children: [
                    h('span', { key: 'dn', children: isZh() ? s.displayNameZh || s.name : s.displayNameEn || s.name }),
                    h('span', { className: 'dsh-wbc-tag', key: 'id', children: s.name }),
                    isIn ? h('span', { className: 'dsh-wbc-meta', key: 'in', children: '· ' + tr('installed') }) : null,
                    !okName ? h('span', { className: 'dsh-wbc-meta', key: 'bad', children: tr('invalidName') }) : null,
                  ],
                }),
                h('div', {
                  className: 'dsh-wbc-desc',
                  key: 'd',
                  children: ((isZh() ? s.descriptionZh : s.descriptionEn) || '').slice(0, 180),
                }),
                h('div', {
                  className: 'dsh-wbc-meta',
                  key: 'm',
                  children: 'v' + (s.version || '?') + ' · ' + (s.categories || []).join(' / ') + ' · ' + (s.useCount || 0),
                }),
              ],
            }),
            h('div', {
              className: 'dsh-wbc-actions',
              key: 'act',
              children: [
                isIn
                  ? h('button', {
                      className: 'dsh-wbc-btn dsh-wbc-btn-danger',
                      key: 'del',
                      disabled: busy === s.name,
                      onClick: () => onUninstall(s.name),
                      children: busy === s.name ? tr('loading') : tr('uninstall'),
                    })
                  : null,
                h('button', {
                  className: isIn ? 'dsh-wbc-btn' : 'dsh-wbc-btn dsh-wbc-btn-primary',
                  key: 'add',
                  disabled: !okName || busy === s.name,
                  title: okName ? '' : tr('invalidName'),
                  onClick: () => onInstall(s, isIn),
                  children: busy === s.name ? tr('installing') : isIn ? tr('overwrite') : tr('install'),
                }),
              ],
            }),
          ],
        });
      });

      const canPrev = state.page > 1 && !state.loading;
      const canNext = state.skills.length >= 30 && !state.loading;

      return h('div', {
        className: 'dsh-wbc-root ' + themeCls,
        children: [
          h('div', {
            className: 'dsh-wbc-bar',
            key: 'bar',
            children: [
              h('input', {
                className: 'dsh-wbc-input',
                key: 'q',
                type: 'search',
                placeholder: tr('search'),
                value: keyword,
                onChange: (e) => setKeyword(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === 'Enter') load(keyword, 1);
                },
              }),
              h('button', {
                className: 'dsh-wbc-btn dsh-wbc-btn-primary',
                key: 'go',
                disabled: state.loading,
                onClick: () => load(keyword, 1),
                children: state.loading ? tr('loading') : tr('load'),
              }),
            ],
          }),
          state.error ? h('div', { className: 'dsh-wbc-meta', key: 'err', style: { color: '#ef4444' }, children: String(state.error).slice(0, 300) }) : null,
          state.loaded ? h('div', { className: 'dsh-wbc-meta', key: 'stat', children: tr('total', { total: state.total, installed: installedSet.size }) }) : null,
          state.loaded && rows.length === 0
            ? h('div', { className: 'dsh-wbc-empty', key: 'empty', children: tr('empty') })
            : h('div', { className: 'dsh-wbc-list', key: 'list', children: rows }),
          h2('div', {
            className: 'dsh-wbc-bar',
            key: 'pager',
            children: [
              h('button', { className: 'dsh-wbc-btn', key: 'prev', disabled: !canPrev, onClick: () => load(keyword, state.page - 1), children: '←' }),
              h('span', { className: 'dsh-wbc-meta', key: 'pg', children: state.page + ' / ' + Math.max(1, Math.ceil(state.total / 30)) }),
              h('button', { className: 'dsh-wbc-btn', key: 'next', disabled: !canNext, onClick: () => load(keyword, state.page + 1), children: '→' }),
            ],
          }),
          state.skillsDir ? h('div', { className: 'dsh-wbc-meta', key: 'dir', children: tr('dir', { dir: state.skillsDir }) + ' · ' + tr('hint') }) : null,
        ],
      });
    }

    //#endregion

    //#region 注册

    function apply(ctx) {
      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'workbuddy-console: locale');
        }
        const t = ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : undefined;

        try {
          ctx.effect(
            () =>
              ctx.slots.inject('conversation.input.left', () =>
                ctx.slots.register(
                  { name: 'conversation.input.left', id: 'workbuddy-skill-picker', order: 60, inject: (owner) => ({ ...(owner || {}) }) },
                  guarded(SkillPicker),
                ),
              ),
            'workbuddy-console: skill picker',
          );
        } catch (e) {
          console.error('[workbuddy-console] skill picker failed:', e);
        }

        try {
          ctx.effect(
            () =>
              ctx.slots.inject('conversation.composer.dock', () =>
                ctx.slots.register(
                  { name: 'conversation.composer.dock', id: 'workbuddy-credit', order: 100, inject: (owner) => ({ ...(owner || {}), t }) },
                  guarded(CreditBadge),
                ),
              ),
            'workbuddy-console: credit badge',
          );
        } catch (e) {
          console.error('[workbuddy-console] credit badge failed:', e);
        }

        // 设置页：对齐可工作插件的注册形态 —— 不自定义 inject，带 locale: NS
        try {
          ctx.effect(
            () =>
              ctx.slots.inject('settings.section', () =>
                ctx.slots.register(
                  {
                    name: 'settings.section',
                    id: 'workbuddy-console',
                    order: 460,
                    label: () => (t ? t('navLabel') : tr('navLabel')),
                    locale: NS,
                  },
                  (props) => SkillsSection({ ...(props || {}), t }),
                ),
              ),
            'workbuddy-console: settings section',
          );
        } catch (e) {
          console.error('[workbuddy-console] settings section failed:', e);
        }
      } catch (error) {
        console.error('[workbuddy-console] client apply failed:', error);
      }
    }

    //#endregion

    exports.apply = apply;
    exports.inject = ['slots', 'locale'];
    exports.name = pkgName;
    exports.SkillPicker = SkillPicker;
    exports.SkillsSection = SkillsSection;
    exports.CreditBadge = CreditBadge;
    // 测试挂钩（不进任何宿主路径）
    exports.__internals = { detectTheme, invokeSkill, findComposerInput, insertIntoInput, pressEnter };
    return module.exports;
  },
});
