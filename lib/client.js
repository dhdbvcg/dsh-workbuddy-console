/**
 * dsh-workbuddy-console —— 浏览器端。
 *
 * 三个功能：
 *   A. 输入框工具行的技能选择器（conversation.input.left）
 *   B. 输入框下方的积分消耗显示（conversation.composer.dock）
 *   C. 设置面板里的「WorkBuddy 技能市场」页（settings.section）
 *
 * 关于手写而不是打包：
 *   本插件没有构建步骤。好在 DSH 的客户端加载协议很简单
 *   （见 xdpool 的 lib/client.js）：调用 window.__ModuleLoader__.load()，
 *   在 factory 里用 require() 取 react 等共享依赖即可。
 *
 * 关于 A（点选技能后如何使用）：
 *   DSH 内置只有技能工具结果的展示（dsh-client-ui-skill 只注册了
 *   tool.call.toolview），**没有选择器**。所以这个按钮是新增能力。
 *   实测 composer 暴露了 `command(line)` —— 执行一行斜杠命令，
 *   与用户手打 /<name> 等价，这是最贴近原生的调用方式。
 *   拿不到 command 时如实告知，不假装成功。
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

    //#region 样式
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
.dsh-wbc-input{flex:1;min-width:120px;background:var(--dsw-alias-bg-base,#1b1d22);color:inherit;
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;padding:5px 9px;font-size:12px}
.dsh-wbc-btn{display:inline-flex;align-items:center;gap:5px;background:transparent;color:inherit;
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;padding:4px 10px;
  font-size:12px;line-height:18px;cursor:pointer}
.dsh-wbc-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#5686fe)}
.dsh-wbc-btn:disabled{opacity:.5;cursor:default}
.dsh-wbc-btn-primary{background:var(--dsw-alias-state-success-primary,#22a06b);border-color:transparent;color:#fff;font-weight:600}
.dsh-wbc-btn-danger{color:var(--dsw-alias-state-error-primary,#ef4444)}
.dsh-wbc-meta{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px}
.dsh-wbc-list{display:flex;flex-direction:column;max-height:340px;overflow:auto}
.dsh-wbc-row{display:flex;align-items:flex-start;gap:10px;padding:9px 2px;
  border-top:1px solid var(--dsw-alias-border-l2,#2c2f36)}
.dsh-wbc-row:first-child{border-top:none}
.dsh-wbc-rowmain{flex:1;min-width:0}
.dsh-wbc-name{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.dsh-wbc-desc{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:16px;margin-top:2px;word-break:break-word}
.dsh-wbc-tag{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dsh-wbc-actions{display:flex;gap:6px;flex:0 0 auto;align-items:center}

/* 对话输入框下方的积分条 */
.dsh-wbcredit{display:flex;align-items:center;gap:6px;justify-content:center;padding:2px 0 0;
  font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a8);
  font-variant-numeric:tabular-nums;user-select:none}
.dsh-wbcredit-dot{width:6px;height:6px;border-radius:50%;flex:0 0 auto;
  background:var(--dsw-alias-state-success-primary,#22a06b);opacity:.75}
.dsh-wbcredit-text{white-space:nowrap}
.dsh-wbcredit-calls{opacity:.7}

/* 输入框工具行的技能按钮 */
.dsh-wbc-trigger{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 8px;
  background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:13px;
  font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.dsh-wbc-trigger:hover{border-color:var(--dsw-alias-brand-primary,#5686fe);
  color:var(--dsw-alias-brand-primary,#5686fe)}
.dsh-wbc-trigger[data-active="1"]{border-color:var(--dsw-alias-state-success-primary,#22a06b);
  color:var(--dsw-alias-state-success-primary,#22a06b)}
.dsh-wbc-flash{font-size:11px;color:var(--dsw-alias-label-tertiary,#9aa0a8);margin-left:6px}

/* 选择器浮层 */
.dsh-wbc-pop{position:fixed;z-index:9000;width:min(460px,calc(100vw - 24px));
  max-height:min(62vh,480px);display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-elevated,#22252c);color:var(--dsw-alias-label-primary,#e6e9ef);
  border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:12px;
  box-shadow:0 12px 32px rgba(0,0,0,.42);overflow:hidden}
.dsh-wbc-pophead{display:flex;gap:8px;align-items:center;padding:10px 12px;
  border-bottom:1px solid var(--dsw-alias-border-l2,#3a3d45)}
.dsh-wbc-popbody{overflow:auto;padding:0 12px 10px}
.dsh-wbc-popfoot{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2,#3a3d45);
  display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dsh-wbc-empty{padding:18px 4px;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;text-align:center}
.dsh-wbc-back{position:fixed;inset:0;z-index:8999}
`;
      document.head.appendChild(style);
      styleInjected = true;
    }
    // 在 apply 时就注入样式，而不是等组件挂载。
    // 之前只在 useEffect 里注入：如果组件渲染阶段就抛错，
    // 样式永远不会进来，页面看起来就是一片空白，还会误导排查方向。
    try {
      ensureStyle();
    } catch {
      /* 没有 document 的环境忽略 */
    }
    //#endregion

    /**
     * 错误边界：组件抛错时显示可读信息而不是一片空白。
     *
     * 为什么要它：之前设置页渲染抛错时页面就是白的，
     * 没有任何提示，只能去翻 renderer 日志才知道发生了什么。
     * React 的 class 组件才能做边界，函数组件不行 —— 所以这里用 class。
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
          // jsx 的 children 必须放在 props 里：jsx(type, props, key)，
          // 第三个参数是 key 不是 child —— 之前把文本当第三参传，
          // 被静默丢弃，这就是设置页空白的根因。
          return jsxRuntime.jsx('div', {
            className: 'dsh-wbc-empty',
            style: { color: 'var(--dsw-alias-state-error-primary,#ef4444)', textAlign: 'left', whiteSpace: 'pre-wrap' },
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
      pickerTitle: '选择要使用的技能',
      iframeFailed: '内嵌页面加载失败',
      iframeHint: '请确认 DSH 正在运行，然后单独打开 http://127.0.0.1:<DSH端口>/wb-console/ 查看',
      invalidName: '命名不合规',
      pickerEmpty: '还没有安装任何技能。先到设置里装一个。',
      pickerSearch: '筛选…',
      use: '使用',
      useHint: '点「使用」= 在本对话中调用该技能',
      used: '已调用技能：{name}',
      useFailed: '调用失败：{message}',
      useUnavailable: '这个输入框没有暴露命令接口，无法自动调用。技能已安装，可手动引用。',
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
      pickerTitle: 'Pick a skill to use',
      iframeFailed: 'The embedded page failed to load',
      iframeHint: 'Make sure DSH is running, then open http://127.0.0.1:<DSH port>/wb-console/ directly',
      invalidName: 'name not allowed',
      pickerEmpty: 'No skills installed yet. Install one from Settings first.',
      pickerSearch: 'Filter…',
      use: 'Use',
      useHint: 'Click "Use" to invoke this skill in the current conversation',
      used: 'Invoked skill: {name}',
      useFailed: 'Failed: {message}',
      useUnavailable: 'This composer does not expose a command interface, so it cannot invoke automatically. The skill is installed — reference it manually.',
      close: 'Close',
      reload: 'Reload',
      failed: 'Load failed: {message}',
      spent: '{credit} credits this conversation',
      calls: '{count} calls',
      noSpend: 'No usage yet in this conversation',
    };

    /** 没有 locale 座位时的兜底，保证在旧宿主上也能显示 */
    function tr(key, vars) {
      const dict = isZh() ? ZH : EN;
      const s = dict[key] || ZH[key] || key;
      if (!vars) return s;
      return String(s).replace(/\{(\w+)\}/g, (m, n) => (vars[n] !== undefined ? String(vars[n]) : m));
    }
    /** 当前是否中文（用文档语言判断，够用且不依赖 locale 服务） */
    function isZh() {
      if (typeof document === 'undefined') return true;
      return String(document.documentElement.lang || '').toLowerCase().startsWith('zh');
    }
    //#endregion

    //#region 数据
    async function fetchJSON(url, init) {
      const r = await fetch(url, init);
      return r.json().catch(() => ({ ok: false, error: 'response not JSON' }));
    }
    const post = (p, body) =>
      fetchJSON(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // 已安装技能列表（技能选择器用）。此前被一次死代码清理误删了定义，
    // 但调用还在 —— 结果选择器一打开就 "installedSkills is not defined"。
    const installedSkills = () => fetchJSON(API + '/skills/installed');
    const listSkills = (params) => fetchJSON(API + '/skills/list?' + new URLSearchParams(params || {}).toString());
    const installSkillApi = (body) => post('/skills/install', body);
    const uninstallSkillApi = (name) => post('/skills/uninstall', { name });
    //#endregion

    //#region 工具
    /**
     * 把选中的技能「用起来」。
     * 优先用 composer 的 command(line)：等价于用户手打 /<name>。
     */
    async function invokeSkill(owner, name) {
      const bar = owner || {};
      if (typeof bar.command === 'function') {
        try {
          const ok = await bar.command('/' + name);
          return ok ? { ok: true } : { ok: false, reason: 'rejected' };
        } catch (e) {
          return { ok: false, reason: 'error', error: (e && e.message) || String(e) };
        }
      }
      return { ok: false, reason: 'no-command' };
    }

    function SkillPicker(owner) {
      const [open, setOpen] = react.useState(false);
      const [state, setState] = react.useState({ loading: false, skills: [], error: '' });
      const [filter, setFilter] = react.useState('');
      const [flash, setFlash] = react.useState('');
      const [pos, setPos] = react.useState({ left: 12, bottom: 80 });
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
        const el = btnRef.current;
        if (el && el.getBoundingClientRect) {
          const r = el.getBoundingClientRect();
          setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 480)), bottom: Math.max(8, window.innerHeight - r.top + 8) });
        }
        load();
      }, [open, load]);

      const onUse = react.useCallback(
        async (skill) => {
          const res = await invokeSkill(owner, skill.dir);
          if (res.ok) {
            setFlash(tr('used', { name: skill.dir }));
            setOpen(false);
          } else if (res.reason === 'no-command') {
            setFlash(tr('useUnavailable'));
          } else {
            setFlash(tr('useFailed', { message: res.error || res.reason }));
          }
        },
        [owner],
      );

      const h = jsxRuntime.jsx;
      const f = filter.trim().toLowerCase();
      const shown = f
        ? state.skills.filter((s) => (s.dir + ' ' + (s.description || '')).toLowerCase().includes(f))
        : state.skills;

      // jsx 契约：children 必须放在 props 里。此前把 child 当第三参传，
      // 全部被静默丢弃 —— 输入框按钮因此渲染成空 Fragment（等于没有按钮）。
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
              children: h('button', {
                className: 'dsh-wbc-btn dsh-wbc-btn-primary',
                onClick: () => onUse(s),
                children: tr('use'),
              }),
            }),
          ],
        }),
      );

      const trigger = h('button', {
        ref: btnRef,
        type: 'button',
        className: 'dsh-wbc-trigger',
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
              className: 'dsh-wbc-pop',
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

      // Fragment 的 children 是数组，每个直接子元素都必须带 key（包括 trigger）
      return h(react.Fragment, {
        children: [
          h('div', { key: 'triggerwrap', children: trigger }),
          flash ? h('span', { className: 'dsh-wbc-flash', key: 'flash', children: flash }) : null,
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
            /* 宿主不可达时静默，不打扰对话 */
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
          // children 一律走 props，不作为第三参传（会被丢弃）
          jsxRuntime.jsx('span', { className: 'dsh-wbcredit-text', children: text }),
          state.calls > 0
            ? jsxRuntime.jsx('span', { className: 'dsh-wbcredit-calls', children: state.calls + '×' })
            : null,
        ],
      });
    }

    //#endregion

    //#region C. 设置页：技能市场（原生组件，只显示市场）

    /**
     * 用真实 React 渲染验证过（render-real-test.mjs）：
     * jsx 的 children 必须放 props.children。
     *
     * 内容只做「技能市场」：搜索 / 安装 / 重装 / 卸载 ——
     * 不嵌整个控制台页面（账号池、签到历史等去 /wb-console/ 看）。
     */
    function SkillsSection(props) {
      const h = jsxRuntime.jsx;
      const [state, setState] = react.useState({
        loading: false, loaded: false, error: '', total: 0, page: 1,
        skills: [], installed: [], skillsDir: '',
      });
      const [keyword, setKeyword] = react.useState('');
      const [busy, setBusy] = react.useState('');
      const alive = react.useRef(true);

      react.useEffect(() => {
        ensureStyle();
        alive.current = true;
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

      // 首次挂载自动加载
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
                    h('span', { key: 'dn', children: isZh() ? (s.displayNameZh || s.name) : (s.displayNameEn || s.name) }),
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
        className: 'dsh-wbc-root',
        children: [
          // 搜索行
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
          // 统计 / 错误
          state.error ? h('div', { className: 'dsh-wbc-meta', key: 'err', style: { color: '#ef4444' }, children: String(state.error).slice(0, 300) }) : null,
          state.loaded
            ? h('div', { className: 'dsh-wbc-meta', key: 'stat', children: tr('total', { total: state.total, installed: installedSet.size }) })
            : null,
          // 技能列表
          state.loaded && rows.length === 0
            ? h('div', { className: 'dsh-wbc-empty', key: 'empty', children: tr('empty') })
            : h('div', { className: 'dsh-wbc-list', key: 'list', children: rows }),
          // 翻页
          h2('div', {
            className: 'dsh-wbc-bar',
            key: 'pager',
            children: [
              h('button', {
                className: 'dsh-wbc-btn',
                key: 'prev',
                disabled: !canPrev,
                onClick: () => load(keyword, state.page - 1),
                children: '←',
              }),
              h('span', { className: 'dsh-wbc-meta', key: 'pg', children: state.page + ' / ' + Math.max(1, Math.ceil(state.total / 30)) }),
              h('button', {
                className: 'dsh-wbc-btn',
                key: 'next',
                disabled: !canNext,
                onClick: () => load(keyword, state.page + 1),
                children: '→',
              }),
            ],
          }),
          // 位置说明
          state.skillsDir
            ? h('div', { className: 'dsh-wbc-meta', key: 'dir', children: tr('dir', { dir: state.skillsDir }) + ' · ' + tr('hint') })
            : null,
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

        // A. 输入框工具行：技能选择器
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

        // B. 输入框下方：积分消耗
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

        // C. 设置面板：技能市场
        //
        // 完全对齐 xdpool 的注册形态（它是可工作的参照）：
        //   - 带 locale: NS（渲染器按命名空间取文案）
        //   - label 用 t
        //   - 组件收 props（里面含 t / renderSlot 等），我们把 NS 附加进去
        //   - **不要**自己 inject 一个只有 {t} 的 face ——
        //     设置区渲染器（PluginsSettingsSection）期望的 inject 里是 hooks.tabs，
        //     自己给的 face 缺 hooks 会让它渲染时直接崩掉，页面表现为空白。
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
                  (props) => SkillsSection({ ...(props || {}), t, localeNs: NS }),
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

    exports.apply = apply;
    // 关键：必须导出 inject，否则 cordis 不会把 slots / locale 注入进来，
    // 访问 ctx.locale 会抛 "cannot get property 'locale' without inject"，
    // apply 整体失败 —— 表现就是「设置里没有技能市场页、输入框没有按钮」。
    // 与 xdpool 的 exports.inject = ["slots", "locale"] 一致。
    exports.inject = ['slots', 'locale'];
    exports.name = pkgName;
    exports.SkillPicker = SkillPicker;
    exports.SkillsSection = SkillsSection;
    exports.CreditBadge = CreditBadge;
    return module.exports;
  },
});
