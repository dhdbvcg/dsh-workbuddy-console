/**
 * 迷你 i18n 运行时 + DOM 绑定。
 *
 * 用在浏览器里（<script> 直接加载，无打包步骤）。
 *
 * 用法：
 *   t('btn.claim')                    → 取文案
 *   t('check.at', { time: '12:00' })  → 带插值
 *   applyI18n(document)               → 按 data-i18n* 属性回填 DOM
 *
 * DOM 约定（写在 index.html 里）：
 *   data-i18n="key"              → textContent
 *   data-i18n-html="key"         → innerHTML（文案里含 <b> 等标签时）
 *   data-i18n-title="key"        → title 属性
 *   data-i18n-placeholder="key"  → placeholder 属性
 */
(function (root) {
  'use strict';

  var STORE_KEY = 'wb-console-lang';

  /** 语言包由 i18n-dict.js 提供（挂到 window.WB_STRINGS） */
  var DICTS = root.WB_STRINGS || { en: {} };
  var FALLBACK = 'en';

  function detect() {
    try {
      var saved = root.localStorage && root.localStorage.getItem(STORE_KEY);
      if (saved && DICTS[saved]) return saved;
    } catch (e) {
      /* 隐私模式下 localStorage 可能抛异常 */
    }
    var nav = (root.navigator && (root.navigator.language || root.navigator.userLanguage)) || '';
    var lower = String(nav).toLowerCase();
    if (lower.indexOf('zh') === 0) return 'zh';
    if (lower.indexOf('en') === 0) return 'en';
    return FALLBACK;
  }

  var current = detect();

  /**
   * 取文案并插值。
   * 找不到 key 时回退到英文，再回退到 key 本身（而不是显示空白，
   * 这样漏翻的地方一眼就能看出来）。
   */
  function t(key, vars) {
    var dict = DICTS[current] || {};
    var s = dict[key];
    if (s === undefined) s = (DICTS[FALLBACK] || {})[key];
    if (s === undefined) return key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, name) {
      return vars[name] !== undefined && vars[name] !== null ? String(vars[name]) : m;
    });
  }

  /** 当前语言 */
  function lang() {
    return current;
  }

  /** 切换语言并重绘静态 DOM */
  function setLang(next) {
    if (!DICTS[next] || next === current) return current;
    current = next;
    try {
      root.localStorage && root.localStorage.setItem(STORE_KEY, next);
    } catch (e) {
      /* 忽略 */
    }
    applyI18n(root.document);
    root.document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en';
    if (typeof root.onLangChanged === 'function') root.onLangChanged(next);
    return current;
  }

  /** 按 data-i18n* 属性回填 DOM */
  function applyI18n(scope) {
    var rootEl = scope || root.document;
    if (!rootEl || !rootEl.querySelectorAll) return;

    rootEl.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    rootEl.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    rootEl.querySelectorAll('[data-i18n-title]').forEach(function (el) {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    rootEl.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
  }

  root.WB_I18N = { t: t, lang: lang, setLang: setLang, applyI18n: applyI18n, langs: Object.keys(DICTS) };
  root.t = t;
})(typeof window !== 'undefined' ? window : globalThis);
