/**
 * dsh-workbuddy-console —— 浏览器端。
 *
 * 合并了原先的 dsh-workbuddy-xdpool：账号池卡片由 vendor/xdpool 提供，
 * 控制台与技能市场由本文件提供。
 *
 * 三个功能：
 *   A. 输入框工具行的技能选择器（conversation.input.left）
 *   B. 输入框下方的积分消耗显示（conversation.composer.dock）
 *   C. 设置面板里的「WorkBuddy 技能市场」页（settings.section）
 *   （外加 vendor/xdpool 注册的账号池卡片）
 *
 * 关键事实（都踩过坑）：
 *   1. exports.inject 必须导出 ['slots','locale']，否则 ctx.locale 抛错、apply 全崩。
 *   2. jsx-runtime 的签名是 jsx(type, props, key)：children 必须放 props.children。
 *      把 child 当第三参传会被静默丢弃 —— 曾造成连续四版空白页。
 *   3. conversation.input.left 的 renderSlot 传空 props：宿主不暴露 command()。
 *      所以「使用技能」走 DOM 方案 —— 把 /技能名 写进输入框并模拟回车，
 *      等价于用户手打，走 DSH 原生的用户显式技能调用路径。
 *   4. 弹层配色必须跟随宿主主题（浅色→白、深色→黑），检测逻辑见 detectTheme()。
 *   5. 本文件是 classic script，**不能有顶层 import/export** ——
 *      宿主用 <script> 加载它。vendor 源码以字符串常量内联，见下方生成块。
 */

//#region BEGIN GENERATED: xdpool client source
// 本块由 scripts/gen-xdpool-client.mjs 生成，请勿手改。
// 内容：vendor/xdpool/lib/client.js（原样内联，MIT, (c) XDTrees — 上游 XDTrees/dsh-workbuddy-xdpool）
// 用途：在本 bundle 内执行一次，捕获它 factory 的产物并转发 apply，
//       这样账号池那张设置卡片就并入了本插件，无需改动上游代码。
const XDPOOL_CLIENT_SRC = "window.__ModuleLoader__.load({\n\tid: \"dsh-workbuddy-xdpool\",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: \"Module\" });\n\t\tlet react = require(\"react\");\n\t\tlet react_jsx_runtime = require(\"react/jsx-runtime\");\n\t\t//#region src/status-paths.ts\n\t\t/**\n\t\t* Node-free constants and types shared by the Host and browser halves of the\n\t\t* WorkBuddy XD Pool settings card.\n\t\t*\n\t\t* Pool's runtime state already lives in `src/status.ts` (`buildStatus` /\n\t\t* `WorkBuddyStatus`); this module only carves the cross-domain (Host→browser)\n\t\t* JSON document into a shape that stays token-free and matches what the\n\t\t* browser card renders. Route paths are plugin-owned and mounted on the Host's\n\t\t* same-origin web server (see `src/web-status.ts`).\n\t\t*\n\t\t* @module dsh-workbuddy-xdpool/status-paths\n\t\t*/\n\t\t/** Plugin-owned read-only pool status endpoint (account rows + models + shim). */\n\t\tconst POOL_STATUS_PATH = \"/plugins/dsh-workbuddy-xdpool/status\";\n\t\t/** Plugin-owned local account rescan endpoint (re-read desktop snapshots). */\n\t\tconst POOL_RESCAN_PATH = \"/plugins/dsh-workbuddy-xdpool/accounts/rescan\";\n\t\t/** Plugin-owned cooldown reset endpoint (clear all 429 cooldowns). */\n\t\tconst POOL_RESET_COOLDOWN_PATH = \"/plugins/dsh-workbuddy-xdpool/cooldowns/reset\";\n\t\t/** Plugin-owned daily check-in action endpoint (claim today's reward). */\n\t\tconst POOL_CHECKIN_PATH = \"/plugins/dsh-workbuddy-xdpool/checkin\";\n\t\t/**\n\t\t* Throw one account out of the pool for good, or take it back.\n\t\t*\n\t\t* Separate from the disable route because the semantics differ: disabling is a\n\t\t* rotation preference the account survives, ignoring survives the account.\n\t\t*/\n\t\tconst POOL_ACCOUNT_IGNORE_PATH = \"/plugins/dsh-workbuddy-xdpool/accounts/ignored\";\n\t\t/** Run one automation job immediately, so the card can verify it on demand. */\n\t\tconst POOL_AUTOMATION_RUN_PATH = \"/plugins/dsh-workbuddy-xdpool/automation/run\";\n\t\t/** Set or clear one account's reserved-credit floor. */\n\t\tconst POOL_CREDIT_RESERVE_PATH = \"/plugins/dsh-workbuddy-xdpool/accounts/credit-reserve\";\n\t\t/**\n\t\t* The schedule every automation job falls back to.\n\t\t*\n\t\t* Shared by both halves on purpose. The host uses it when a configured hour\n\t\t* list arrives empty (the settings schema materializes \"never configured\" into\n\t\t* `[]`), and the card uses it when it writes the `automation` block back, so a\n\t\t* document that already holds an empty list is healed instead of being saved\n\t\t* back as an unrunnable schedule.\n\t\t*\n\t\t* This lives here rather than in `scheduler.ts` because the browser half cannot\n\t\t* import the host module: `scheduler.ts` pulls in `node:crypto` and the whole\n\t\t* upstream client, none of which exists in the browser bundle. Two hand-written\n\t\t* copies would drift, and the drift is invisible — the card would write a\n\t\t* schedule the scheduler does not run.\n\t\t*/\n\t\tconst DEFAULT_AUTOMATION_HOURS = {\n\t\t\tcheckin: [9],\n\t\t\treport: [10],\n\t\t\ttasks: [11],\n\t\t\tstreak: [12],\n\t\t\ttravel: [9, 21]\n\t\t};\n\t\t//#endregion\n\t\t//#region src/client/icon.ts\n\t\t/**\n\t\t* Plugin card icon (data URI) for the WorkBuddy XD Pool card.\n\t\t*\n\t\t* A neutral, dependency-free 24px “pool / droplet stack” glyph kept as an SVG\n\t\t* data URI so the browser half never needs an external asset. Three stacked\n\t\t* droplet outlines + an encompassing orbit mark read as “rotating accounts\";\n\t\t* the line and fill colors stay inside the host’s accent family so the icon\n\t\t* sits naturally on the dark Plugin configuration surface.\n\t\t*\n\t\t* @module dsh-workbuddy-xdpool/client/icon\n\t\t*/\n\t\tconst POOL_PLUGIN_ICON = \"data:image/svg+xml;utf8,\" + encodeURIComponent([\n\t\t\t\"<svg xmlns=\\\"http://www.w3.org/2000/svg\\\" viewBox=\\\"0 0 24 24\\\" width=\\\"24\\\" height=\\\"24\\\">\",\n\t\t\t\"<g fill=\\\"none\\\" stroke=\\\"#5686fe\\\" stroke-width=\\\"1.6\\\" stroke-linecap=\\\"round\\\" stroke-linejoin=\\\"round\\\">\",\n\t\t\t\"<path d=\\\"M7 5.5C7 3.6 8.4 2.5 8.4 2.5S9.8 3.6 9.8 5.5A1.4 1.4 0 0 1 7 5.5Z\\\" fill=\\\"#5686fe\\\" fill-opacity=\\\".28\\\"/>\",\n\t\t\t\"<path d=\\\"M15 10.5C15 8.6 16.4 7.5 16.4 7.5S17.8 8.6 17.8 10.5a1.4 1.4 0 0 1-2.8 0Z\\\" fill=\\\"#5686fe\\\" fill-opacity=\\\".28\\\"/>\",\n\t\t\t\"<ellipse cx=\\\"12\\\" cy=\\\"14.5\\\" rx=\\\"5.6\\\" ry=\\\"4.4\\\" stroke-dasharray=\\\"2 2\\\" stroke-opacity=\\\".55\\\"/>\",\n\t\t\t\"</g>\",\n\t\t\t\"</svg>\"\n\t\t].join(\"\"));\n\t\t//#endregion\n\t\t//#region src/client/styles.ts\n\t\t/**\n\t\t* Client styles for the WorkBuddy XD Pool card.\n\t\t*\n\t\t* The card uses the same dark-theme token vocabulary as the built-in plugin\n\t\t* cards (`--dsw-alias-*`), so the pooled account and model directory sit\n\t\t* naturally next to the other configuration rows instead of looking like a\n\t\t* bright Google-Material block on top of DSH's dark surface.\n\t\t*\n\t\t* The page renders at full height with no collapse affordance, and its content is\n\t\t* split into cards: a header row with the primary actions, a status card (region\n\t\t* switch + distribution), then one card per feature area. The inner\n\t\t* workbuddy-specific classes are namespaced `dsm-workbuddy-xdpool-*`.\n\t\t*\n\t\t* @module dsh-workbuddy-xdpool/client/styles\n\t\t*/\n\t\tconst POOL_CARD_CSS = `\n/*\n * Page shell. The settings shell renders this inside its own scrollable content\n * column, so the page supplies only the rhythm and the cards — no outer border\n * and no extra margin (the column pads its own edges).\n */\n.dsm-workbuddy-xdpool-page{max-width:860px;flex-direction:column;gap:16px;display:flex}\n/*\n * Header row: identity on the left, primary actions on the right. Wraps so a\n * narrow panel drops the buttons below the title instead of squeezing it.\n */\n.dsm-workbuddy-xdpool-page-head{align-items:center;gap:12px;flex-wrap:wrap;display:flex}\n.dsm-workbuddy-xdpool-page-icon{width:32px;height:32px;flex:none;border-radius:7px}\n.dsm-workbuddy-xdpool-page-copy{flex-direction:column;gap:4px;min-width:0;flex:1 1 220px;display:flex}\n.dsm-workbuddy-xdpool-page-title{color:var(--dsw-alias-label-primary,#e6e6e6);margin:0;font-size:16px;font-weight:600;line-height:1.4}\n.dsm-workbuddy-xdpool-page-desc{color:var(--dsw-alias-label-tertiary,#999);margin:0;font-size:13px;line-height:1.5}\n.dsm-workbuddy-xdpool-page-actions{align-items:center;gap:8px;flex-wrap:wrap;flex:none;display:flex}\n/*\n * One feature area per card. The surface separates the sections the way the\n * built-in settings pages do; without it every panel ran together into a single\n * column of text with no visible boundary.\n */\n.dsm-workbuddy-xdpool-card{border:1px solid var(--dsw-alias-border-l2,#36373b);background:var(--dsw-alias-bg-layer-2,#232529);border-radius:14px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}\n/* Status card: the region switch sits above the state line, then the switch. */\n.dsm-workbuddy-xdpool-status{gap:14px}\n/* Reusable button primitives shared with the rest of the card body. */\n.dsm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}\n.dsm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}\n.dsm-btn:disabled{opacity:.4;cursor:default}\n.dsm-btn-outline{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:transparent;font-weight:500}\n.dsm-btn-outline:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed);background:rgba(255,255,255,.04)}\n.dsm-btn-primary{background:var(--dsw-alias-label-primary,#e6e6e6);color:var(--dsw-alias-bg-layer-3,#202126)}\n.dsm-btn-primary:hover:not(:disabled){opacity:.9}\n\n/* Region tabs: two independent suppliers, one shown at a time. */\n.dsm-workbuddy-xdpool-tabs{display:flex;gap:6px;padding:4px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}\n/* Empty-region guide: steps for signing in on the other gateway. */\n.dsm-workbuddy-xdpool-empty{gap:10px}\n.dsm-workbuddy-xdpool-empty-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}\n.dsm-workbuddy-xdpool-empty-steps{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-layer-3,#2a2c33)}\n.dsm-workbuddy-xdpool-empty-steps-title{margin:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;font-weight:600;line-height:18px}\n.dsm-workbuddy-xdpool-empty-list{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:5px;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}\n.dsm-workbuddy-xdpool-empty-list li{min-width:0}\n.dsm-workbuddy-xdpool-empty-note{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:17px}\n.dsm-workbuddy-xdpool-tab{appearance:none;font:inherit;cursor:pointer;flex:1;border:0;border-radius:7px;padding:7px 10px;color:var(--dsw-alias-label-tertiary,#999);font-size:13px;font-weight:500;line-height:18px;background:transparent;transition:color .16s,background .16s,box-shadow .16s}\n.dsm-workbuddy-xdpool-tab:hover:not(.dsm-workbuddy-xdpool-tab-active){color:var(--dsw-alias-label-primary,#e6e6e6)}\n.dsm-workbuddy-xdpool-tab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}\n.dsm-workbuddy-xdpool-tab-active{color:var(--dsw-alias-label-primary,#e6e6e6);background:var(--dsw-alias-bg-layer-2,#232529);box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,#3a3d45)}\n.dsm-workbuddy-xdpool-tab-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:baseline;background:var(--dsw-alias-state-success-primary,#22a06b)}\n.dsm-workbuddy-xdpool-tab-dot[data-state=\"error\"]{background:var(--dsw-alias-state-error-primary,#ef4444)}\n.dsm-workbuddy-xdpool-tab-dot[data-state=\"idle\"]{background:var(--dsw-alias-label-dimmed,#9aa0a6)}\n.dsm-workbuddy-xdpool-usage-head{display:flex;flex-direction:column;gap:12px;min-width:0}\n.dsm-workbuddy-xdpool-usage-copy{display:flex;flex-direction:column;gap:3px;min-width:0}\n.dsm-workbuddy-xdpool-usage-status{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}\n.dsm-workbuddy-xdpool-usage-dot{width:9px;height:9px;border-radius:50%;flex:0 0 auto}\n.dsm-workbuddy-xdpool-usage-hint{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px}\n/* Distribution switch: priority (drain one) vs round-robin (spread). */\n.dsm-workbuddy-xdpool-dist{display:flex;flex-direction:column;gap:7px}\n.dsm-workbuddy-xdpool-dist-title{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;font-weight:600}\n.dsm-workbuddy-xdpool-dist-option{appearance:none;font:inherit;cursor:pointer;text-align:left;display:flex;flex-direction:column;justify-content:center;gap:2px;min-height:44px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:8px;padding:6px 10px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}\n.dsm-workbuddy-xdpool-dist-option:hover:not(:disabled):not(.dsm-workbuddy-xdpool-dist-option-active){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}\n.dsm-workbuddy-xdpool-dist-option:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}\n.dsm-workbuddy-xdpool-dist-option-active{background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.14));border-color:var(--dsw-alias-state-success-primary,#22a06b);color:var(--dsw-alias-state-success-primary,#22a06b)}\n.dsm-workbuddy-xdpool-dist-option:disabled{cursor:default;opacity:.6}\n.dsm-workbuddy-xdpool-dist-option-name{font-size:11px;line-height:16px;font-weight:600}\n.dsm-workbuddy-xdpool-dist-option-hint{font-size:10px;line-height:14px;opacity:.8}\n.dsm-workbuddy-xdpool-dist-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}\n.dsm-workbuddy-xdpool-usage-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}\n\n/* Account list (each account = a labeled subpanel, same as dingminhua). */\n.dsm-workbuddy-xdpool-accounts{gap:14px}\n.dsm-workbuddy-xdpool-accounts-head{display:flex;align-items:center;justify-content:space-between;gap:12px}\n/* \"In use now\": answers which account is serving without scanning every row. */\n/* A hairline + tint reads as status; a filled bar would read as a call to action. */\n.dsm-workbuddy-xdpool-current{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:10px 0 0;padding:9px 13px;border:1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 32%, transparent);border-radius:12px;background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 9%, transparent)}\n.dsm-workbuddy-xdpool-current-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary,#22a06b);box-shadow:0 0 0 3px color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 18%, transparent)}\n.dsm-workbuddy-xdpool-current-label{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:11.5px;line-height:18px;font-weight:600;letter-spacing:.02em;flex:none}\n.dsm-workbuddy-xdpool-current-name{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;line-height:18px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.dsm-workbuddy-xdpool-current-note{color:var(--dsw-alias-state-warning-primary,#d97706);font-size:11px;line-height:16px}\n.dsm-workbuddy-xdpool-accounts-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}\n.dsm-workbuddy-xdpool-accounts-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}\n.dsm-workbuddy-xdpool-account{display:flex;flex-direction:column;gap:0;padding:0;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 55%, transparent);border-radius:16px;background:var(--dsw-alias-bg-layer-2,#24262c);box-shadow:0 1px 3px rgba(0,0,0,.04);overflow:hidden}\n/* Body row inside a card: identity on the left, credit panels on the right. */\n/* flex-wrap lets the panels drop below on a narrow card instead of squeezing both. */\n.dsm-workbuddy-xdpool-account-body{display:flex;align-items:stretch;gap:0;flex-wrap:wrap}\n.dsm-workbuddy-xdpool-account-copy{display:flex;flex-direction:column;align-items:flex-start;gap:6px;flex:1 1 200px;min-width:0;padding:14px 16px;justify-content:center}\n.dsm-workbuddy-xdpool-account-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.dsm-workbuddy-xdpool-account-head .dsm-workbuddy-xdpool-account-toggle{margin-left:auto}\n.dsm-workbuddy-xdpool-account-head{display:flex;align-items:center;gap:10px;min-width:0;padding:12px 16px;border-bottom:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 45%, transparent)}\n/* Account switched off on the card: still listed (so it can be turned back on) but visually muted. */\n.dsm-workbuddy-xdpool-account-off{opacity:.55}\n/* Small pill switch: \"in rotation\" vs \"off\". Native checkbox styled by the label. */\n.dsm-workbuddy-xdpool-account-toggle{appearance:none;font:inherit;display:inline-flex;align-items:center;gap:5px;cursor:pointer;flex:none;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 70%, transparent);border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}\n.dsm-workbuddy-xdpool-account-toggle:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}\n.dsm-workbuddy-xdpool-account-toggle:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}\n.dsm-workbuddy-xdpool-account-toggle:disabled{cursor:default;opacity:.6}\n.dsm-workbuddy-xdpool-account-toggle-on{background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);border-color:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);font-weight:600}\n.dsm-workbuddy-xdpool-account-toggle-dot{width:6px;height:6px;border-radius:50%;flex:none;background:currentColor;opacity:.9}\n/* \"Remove\" button: destructive and reversible, so it is quiet until hovered. */\n.dsm-workbuddy-xdpool-account-ignore{appearance:none;font:inherit;flex:none;cursor:pointer;border:1px solid transparent;border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0a8);transition:color .16s,border-color .16s,background .16s}\n.dsm-workbuddy-xdpool-account-ignore:hover:not(:disabled){color:var(--dsw-alias-state-error-primary,#ef4444);border-color:color-mix(in oklab, var(--dsw-alias-state-error-primary,#ef4444) 45%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-error-primary,#ef4444) 10%, transparent)}\n.dsm-workbuddy-xdpool-account-ignore:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}\n.dsm-workbuddy-xdpool-account-ignore:disabled{cursor:default;opacity:.6}\n/* Ignored-account list: visible proof that \"remove\" can be undone. */\n.dsm-workbuddy-xdpool-ignored-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 45%, transparent)}\n.dsm-workbuddy-xdpool-ignored-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:600;line-height:19px}\n.dsm-workbuddy-xdpool-ignored-summary{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:17px}\n.dsm-workbuddy-xdpool-ignored-list{display:flex;flex-direction:column}\n.dsm-workbuddy-xdpool-ignored-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px}\n.dsm-workbuddy-xdpool-ignored-row+.dsm-workbuddy-xdpool-ignored-row{border-top:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 30%, transparent)}\n.dsm-workbuddy-xdpool-ignored-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.dsm-workbuddy-xdpool-ignored-restore{appearance:none;font:inherit;flex:none;cursor:pointer;border:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 70%, transparent);border-radius:999px;padding:3px 10px;font-size:11px;line-height:17px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);transition:color .16s,border-color .16s}\n.dsm-workbuddy-xdpool-ignored-restore:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6e6e6);border-color:var(--dsw-alias-label-dimmed,#777)}\n.dsm-workbuddy-xdpool-ignored-restore:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}\n.dsm-workbuddy-xdpool-ignored-restore:disabled{cursor:default;opacity:.6}\n.dsm-workbuddy-xdpool-account-tags{display:flex;align-items:center;gap:6px;flex-wrap:wrap}\n.dsm-workbuddy-xdpool-account-tag{padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;background:var(--dsw-alias-state-success-subtle,rgba(34,160,107,.12));color:var(--dsw-alias-state-success-primary,#22a06b)}\n.dsm-workbuddy-xdpool-account-tag-cooling{background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.15));color:var(--dsw-alias-state-warning-primary,#d97706)}\n.dsm-workbuddy-xdpool-account-tag-error{background:var(--dsw-alias-state-error-subtle,rgba(239,68,68,.12));color:var(--dsw-alias-state-error-primary,#ef4444)}\n.dsm-workbuddy-xdpool-account-meta{color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:12px;line-height:18px;display:flex;flex-wrap:wrap;gap:10px}\n.dsm-workbuddy-xdpool-account-modelcool{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}\n.dsm-workbuddy-xdpool-account-modelcool-chip{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;background:var(--dsw-alias-state-warning-subtle,rgba(217,119,6,.12));color:var(--dsw-alias-state-warning-primary,#d97706)}\n.dsm-workbuddy-xdpool-account-error{margin:0;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:13px;line-height:20px}\n\n/* Two-column stats: packages on the left, total + check-in on the right. */\n.dsm-workbuddy-xdpool-stats{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(168px,.85fr);gap:0;flex:1 1 420px;min-width:0;max-width:660px;border-left:1px solid color-mix(in oklab, var(--dsw-alias-border-l2,#3a3d45) 45%, transparent)}\n.dsm-workbuddy-xdpool-panel{display:flex;flex-direction:column;min-width:0;gap:7px;padding:14px 16px}\n.dsm-workbuddy-xdpool-panel-title{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;letter-spacing:.03em;text-transform:uppercase;font-weight:600}\n.dsm-workbuddy-xdpool-panel-empty{color:var(--dsw-alias-label-tertiary,#999);font-size:14px;line-height:20px}\n.dsm-workbuddy-xdpool-panel-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:12px;line-height:18px;word-break:break-word}\n.dsm-workbuddy-xdpool-panel-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-top:9px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l2,#36373b);color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px}\n.dsm-workbuddy-xdpool-panel-foot strong{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:15px;font-variant-numeric:tabular-nums}\n.dsm-workbuddy-xdpool-packages{display:flex;flex-direction:column;gap:5px;margin:0;padding:0;list-style:none}\n/* One credit package: name + amount on the first line, its deadline beneath.\n   A two-row grid keeps the columns aligned across rows; a wrapping flex row\n   dropped the deadline onto a second line that started at the container edge,\n   so the list read as ragged text rather than a table. */\n.dsm-workbuddy-xdpool-packages li{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;row-gap:1px;align-items:baseline;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:18px}\n.dsm-workbuddy-xdpool-packages-name{grid-column:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.dsm-workbuddy-xdpool-packages-value{grid-column:2;justify-self:end;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-variant-numeric:tabular-nums}\n/* Per-package deadline: the upstream grants one-off packs at arbitrary clock\n   times, so each row carries its own timestamp; the soon ones are tinted and\n   fold onto their own line so a long package name cannot squeeze them out. */\n.dsm-workbuddy-xdpool-packages-when{grid-column:1/-1;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:15px;font-variant-numeric:tabular-nums}\n.dsm-workbuddy-xdpool-packages-when-soon{color:var(--dsw-alias-state-warning-primary,#d97706)}\n.dsm-workbuddy-xdpool-panel-total{position:relative;align-items:center;text-align:center;justify-content:center;overflow:hidden;background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 5%, transparent)}\n.dsm-workbuddy-xdpool-panel-total::before{content:\"\";position:absolute;top:0;left:0;right:0;height:3px;opacity:.9;background:var(--dsw-alias-state-success-primary,#22a06b)}\n.dsm-workbuddy-xdpool-total-value{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:28px;line-height:32px;font-weight:800;letter-spacing:-.02em;white-space:nowrap;font-variant-numeric:tabular-nums}\n\n/* Model directory list. */\n.dsm-workbuddy-xdpool-models{gap:10px}\n.dsm-workbuddy-xdpool-models-head{display:flex;align-items:center;justify-content:space-between;gap:12px}\n.dsm-workbuddy-xdpool-models-title{margin:0;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:20px}\n.dsm-workbuddy-xdpool-models-summary{margin:2px 0 0;color:var(--dsw-alias-label-tertiary,#999);font-size:12px;line-height:18px}\n.dsm-workbuddy-xdpool-model-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;overflow:hidden}\n.dsm-workbuddy-xdpool-model{display:grid;grid-template-columns:minmax(0,1fr);gap:7px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2,#232529);transition:opacity .16s}\n.dsm-workbuddy-xdpool-model+.dsm-workbuddy-xdpool-model{border-top:1px solid var(--dsw-alias-border-l2,#36373b)}\n.dsm-workbuddy-xdpool-model-head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}\n.dsm-workbuddy-xdpool-model-copy{display:flex;align-items:baseline;gap:8px;min-width:0;flex-wrap:wrap}\n.dsm-workbuddy-xdpool-model-name{display:inline-flex;align-items:baseline;gap:7px;color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:500;line-height:19px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.dsm-workbuddy-xdpool-model-name-rate{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;font-weight:400;line-height:16px;flex:none}\n.dsm-workbuddy-xdpool-model-id{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.dsm-workbuddy-xdpool-model-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px}\n.dsm-workbuddy-xdpool-model-meta-tag{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;background:rgba(174,179,187,.11);color:var(--dsw-alias-label-secondary,#c6c9d0)}\n.dsm-workbuddy-xdpool-model-cap{color:var(--dsw-alias-label-tertiary,#999);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}\n/* Model row: checkbox + image toggle + context-budget radios. */\n.dsm-workbuddy-xdpool-model-off{opacity:.55}\n.dsm-workbuddy-xdpool-model-check{display:flex;align-items:center;gap:8px;min-width:0;flex:1;cursor:pointer}\n.dsm-workbuddy-xdpool-model-check input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe);flex:none}\n.dsm-workbuddy-xdpool-model-controls{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap;justify-content:flex-end}\n.dsm-workbuddy-xdpool-model-image{display:inline-flex;align-items:center;gap:5px;flex:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}\n.dsm-workbuddy-xdpool-model-image input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}\n.dsm-workbuddy-xdpool-model-budget{display:flex;align-items:center;gap:9px;flex:none;margin:0;padding:0;border:0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:11px;line-height:16px}\n.dsm-workbuddy-xdpool-model-budget label{display:inline-flex;align-items:center;gap:4px;cursor:pointer}\n.dsm-workbuddy-xdpool-model-budget input{margin:0;accent-color:var(--dsw-alias-brand-primary,#5686fe)}\n.dsm-workbuddy-xdpool-models-heading{display:flex;flex-direction:column;gap:2px;min-width:0}\n.dsm-workbuddy-xdpool-models-actions{display:flex;align-items:center;gap:8px;flex:none}\n\n\n/* Automation: run-now button and the per-job progress line. */\n.dsm-workbuddy-xdpool-auto-run{flex:none}\n.dsm-workbuddy-xdpool-auto-job-detail{grid-column:1/-1;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:11px;line-height:16px}\n/* Credit packages panel heading inside the right-hand column. */\n.dsm-workbuddy-xdpool-panel-packages{display:flex;flex-direction:column;gap:7px;min-width:0}\n\n/* Check-in docked under the total, inside the right-hand panel. */\n.dsm-workbuddy-xdpool-checkin{display:flex;flex-direction:column;align-items:center;gap:7px;width:100%;margin-top:10px;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l2,#36373b)}\n.dsm-workbuddy-xdpool-checkin-meta{display:flex;flex-direction:column;align-items:center;gap:2px;width:100%}\n.dsm-workbuddy-xdpool-checkin-streak{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:17px;font-variant-numeric:tabular-nums}\n.dsm-workbuddy-xdpool-checkin-daily{color:var(--dsw-alias-state-success-primary,#22a06b);font-size:11px;line-height:16px;font-variant-numeric:tabular-nums}\n.dsm-workbuddy-xdpool-checkin-bonus{padding:1px 8px;border-radius:999px;font-size:11px;line-height:16px;background:var(--dsw-alias-state-success-subtle,rgba(51,160,107,.14));color:var(--dsw-alias-state-success-primary,#22a06b);text-align:center}\n.dsm-workbuddy-xdpool-checkin-btn{width:100%;padding:5px 10px;border-radius:8px;border:1px solid transparent;font-size:12px;font-weight:600;line-height:18px;cursor:pointer;background:var(--dsw-alias-state-success-primary,#22a06b);color:#fff;transition:opacity .16s,border-color .16s,background .16s}\n.dsm-workbuddy-xdpool-checkin-btn:hover:not(:disabled){opacity:.88}\n.dsm-workbuddy-xdpool-checkin-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}\n.dsm-workbuddy-xdpool-checkin-btn:disabled{cursor:default;background:transparent;border-color:var(--dsw-alias-border-l2,#3a3d45);color:var(--dsw-alias-label-tertiary,#9aa0a8);opacity:1}\n.dsm-workbuddy-xdpool-checkin-error{color:var(--dsw-alias-state-error-primary,#ef4444);font-size:11px;line-height:16px;text-align:center;word-break:break-word}\n\n/* Inline notes + error messages. */\n.dsm-workbuddy-xdpool-note{margin:0;color:var(--dsw-alias-label-tertiary,#9aa0a8);font-size:13px;line-height:20px}\n.dsm-workbuddy-xdpool-error{margin:0;color:var(--dsw-alias-state-error-primary,#ef4444);font-size:13px;line-height:20px}\n\n/* Responsive: stack the stats columns on narrow screens. */\n@media (max-width:760px){\n  .dsm-workbuddy-xdpool-stats{grid-template-columns:1fr}\n  .dsm-workbuddy-xdpool-panel-total{align-items:stretch;text-align:left}\n  .dsm-workbuddy-xdpool-total-value{text-align:left}\n  .dsm-workbuddy-xdpool-checkin{align-items:stretch}\n  .dsm-workbuddy-xdpool-checkin-meta{align-items:flex-start}\n  .dsm-workbuddy-xdpool-checkin-bonus{text-align:left}\n}\n\n/* Automation panel: schedule and last-run summary, collapsed behind a switch. */\n.dsm-workbuddy-xdpool-auto{margin-top:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:10px;background:var(--dsw-alias-bg-module-platform,#202126)}\n.dsm-workbuddy-xdpool-auto-head{display:flex;align-items:center;justify-content:space-between;gap:8px}\n.dsm-workbuddy-xdpool-auto-title{color:var(--dsw-alias-label-primary,#e8e8ea);font-size:12px;font-weight:600}\n.dsm-workbuddy-xdpool-auto-switch{padding:3px 12px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;cursor:pointer;transition:color .16s,border-color .16s,background .16s}\n.dsm-workbuddy-xdpool-auto-switch:hover:not(:disabled){border-color:var(--dsw-alias-label-dimmed,#777);color:var(--dsw-alias-label-primary,#e8e8ea)}\n.dsm-workbuddy-xdpool-auto-switch:disabled{opacity:.5;cursor:not-allowed}\n.dsm-workbuddy-xdpool-auto-switch-on{border-color:#28c8b4;color:#28c8b4;background:rgba(40,200,180,.12)}\n.dsm-workbuddy-xdpool-auto-hint{margin:6px 0 0;color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px;line-height:1.6}\n.dsm-workbuddy-xdpool-auto-total{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:8px;padding:6px 8px;border-radius:8px;background:rgba(40,200,180,.08);font-size:11px}\n.dsm-workbuddy-xdpool-auto-total-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}\n.dsm-workbuddy-xdpool-auto-total{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:6px 8px;border-radius:8px;background:rgba(40,200,180,.08);font-size:11px}\n.dsm-workbuddy-xdpool-auto-total-list{display:flex;flex-direction:column;gap:2px}\n.dsm-workbuddy-xdpool-auto-total-row{color:#28c8b4;font-variant-numeric:tabular-nums}\n.dsm-workbuddy-xdpool-earned{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b);font-size:11px}\n.dsm-workbuddy-xdpool-earned-label{color:var(--dsw-alias-label-secondary,#c6c9d0);font-size:12px}\n.dsm-workbuddy-xdpool-earned-list{display:flex;flex-direction:column;gap:2px}\n.dsm-workbuddy-xdpool-earned-row{color:#28c8b4;font-variant-numeric:tabular-nums}\n.dsm-workbuddy-xdpool-earned-value{color:#28c8b4;font-weight:600;font-variant-numeric:tabular-nums}\n.dsm-workbuddy-xdpool-auto-jobs{margin-top:8px;display:flex;flex-direction:column;gap:4px}\n.dsm-workbuddy-xdpool-auto-job{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary,#c6c9d0)}\n.dsm-workbuddy-xdpool-auto-job-name{flex:0 0 auto;min-width:72px;color:var(--dsw-alias-label-primary,#e8e8ea);font-weight:500}\n.dsm-workbuddy-xdpool-auto-job-when{flex:1 1 auto;color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums}\n.dsm-workbuddy-xdpool-auto-job-last{flex:0 0 auto;text-align:right;color:var(--dsw-alias-label-secondary,#c6c9d0);font-variant-numeric:tabular-nums;white-space:nowrap}\n.dsm-workbuddy-xdpool-auto-job-note{flex:0 0 auto;color:var(--dsw-alias-label-secondary,#c6c9d0)}\n/* Reserved credits: one inline number field per account. */\n.dsm-workbuddy-xdpool-reserve{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;border-top:1px dashed var(--dsw-alias-border-l2,#36373b);font-size:11px;color:var(--dsw-alias-label-dimmed,#8a97b5)}\n.dsm-workbuddy-xdpool-reserve-label{flex:0 0 auto}\n.dsm-workbuddy-xdpool-reserve-input{width:84px;padding:3px 8px;border:1px solid var(--dsw-alias-border-l2,#3a3d45);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#e8e8ea);font:inherit;font-variant-numeric:tabular-nums;transition:border-color .16s,background .16s}\n.dsm-workbuddy-xdpool-reserve-input:focus{outline:none;border-color:var(--dsw-alias-state-success-primary,#22a06b);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 7%, transparent)}\n.dsm-workbuddy-xdpool-reserve-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5686fe);outline-offset:1px}\n.dsm-workbuddy-xdpool-reserve-input:disabled{opacity:.6}\n.dsm-workbuddy-xdpool-reserve-unit{flex:0 0 auto}\n.dsm-workbuddy-xdpool-reserve-badge{flex:0 0 auto;padding:1px 7px;border-radius:999px;background:rgba(232,90,90,.14);color:#e85a5a;font-size:10px}\n/* Explicit Save: the field is a draft, so the button (not a blur) is what\n   commits it — and the outcome is reported right here, next to the control. */\n.dsm-workbuddy-xdpool-reserve-save{flex:0 0 auto;appearance:none;font:inherit;font-size:11px;font-weight:600;line-height:16px;padding:3px 12px;border-radius:6px;border:1px solid color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 55%, transparent);background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 14%, transparent);color:var(--dsw-alias-state-success-primary,#22a06b);cursor:pointer;transition:opacity .16s,background .16s,border-color .16s,color .16s}\n.dsm-workbuddy-xdpool-reserve-save:hover:not(:disabled){background:color-mix(in oklab, var(--dsw-alias-state-success-primary,#22a06b) 24%, transparent);border-color:var(--dsw-alias-state-success-primary,#22a06b)}\n.dsm-workbuddy-xdpool-reserve-save:disabled{cursor:default;border-color:var(--dsw-alias-border-l2,#3a3d45);background:transparent;color:var(--dsw-alias-label-tertiary,#8a90a0);opacity:.75}\n.dsm-workbuddy-xdpool-reserve-note{flex:0 0 auto;font-size:11px;line-height:16px}\n.dsm-workbuddy-xdpool-reserve-note-ok{color:var(--dsw-alias-state-success-primary,#22a06b)}\n.dsm-workbuddy-xdpool-reserve-note-bad{color:var(--dsw-alias-state-error-primary,#ef4444);font-weight:600}\n`.trim();\n\t\t//#endregion\n\t\t//#region src/client/PoolCard.tsx\n\t\t/**\n\t\t* WorkBuddy XD Pool card contributed to DSH Plugin configuration.\n\t\t*\n\t\t* The card body mirrors the LaoDing plugin family used by dingminhua's\n\t\t* `dsh-connect-workbuddy`: a small status row (dot + count + Rescan / Clear\n\t\t* cooldowns buttons), then a per-account panel showing label / status tag /\n\t\t* token expiry / cooldown info / credit packages, then the model directory\n\t\t* with per-model free/limited/night/image badges and context size.\n\t\t*\n\t\t* Rendered as a full settings page (see `client/index.tsx`): the shell gives it\n\t\t* a left-nav row and a scrollable content column, so everything is visible at\n\t\t* once — a fold inside the page only hid the pool behind a click.\n\t\t*\n\t\t* @module dsh-workbuddy-xdpool/client/PoolCard\n\t\t*/\n\t\t/**\n\t\t* Default context window the card offers as the \"capped\" choice, in tokens.\n\t\t* Mirrors the host-side DEFAULT_CONTEXT_BUDGET; declared here rather than\n\t\t* imported, because the browser bundle must not pull in the host entry.\n\t\t*/\n\t\tconst DEFAULT_CONTEXT_BUDGET = 2e5;\n\t\tconst POLL_INTERVAL_MS = 3e4;\n\t\t/** Inject or refresh the shared card CSS for the current client bundle. */\n\t\tif (typeof document !== \"undefined\") {\n\t\t\tconst cssId = \"dsh-workbuddy-xdpool/client.css\";\n\t\t\tconst existing = document.querySelector(`style[data-plugin-css=\"${cssId}\"]`);\n\t\t\tif (existing !== null) existing.textContent = POOL_CARD_CSS;\n\t\t\telse {\n\t\t\t\tconst styleTag = document.createElement(\"style\");\n\t\t\t\tstyleTag.dataset.plugin = \"dsh-workbuddy-xdpool\";\n\t\t\t\tstyleTag.dataset.pluginCss = cssId;\n\t\t\t\tstyleTag.textContent = POOL_CARD_CSS;\n\t\t\t\tdocument.head.appendChild(styleTag);\n\t\t\t}\n\t\t}\n\t\tfunction formatNumber(value) {\n\t\t\tif (value === void 0) return \"–\";\n\t\t\treturn new Intl.NumberFormat(void 0, { maximumFractionDigits: 0 }).format(value);\n\t\t}\n\t\tfunction formatTime(value) {\n\t\t\treturn new Intl.DateTimeFormat(void 0, {\n\t\t\t\tmonth: \"2-digit\",\n\t\t\t\tday: \"2-digit\",\n\t\t\t\thour: \"2-digit\",\n\t\t\t\tminute: \"2-digit\"\n\t\t\t}).format(new Date(value));\n\t\t}\n\t\tfunction formatDateTime(value) {\n\t\t\tif (value === void 0) return \"\";\n\t\t\tconst ms = Date.parse(value);\n\t\t\tif (Number.isNaN(ms)) return value;\n\t\t\treturn new Intl.DateTimeFormat(void 0, {\n\t\t\t\tmonth: \"2-digit\",\n\t\t\t\tday: \"2-digit\",\n\t\t\t\thour: \"2-digit\",\n\t\t\t\tminute: \"2-digit\"\n\t\t\t}).format(new Date(ms));\n\t\t}\n\t\t/**\n\t\t* The automation jobs, in the order they run.\n\t\t*\n\t\t* The order is the contract: the report has to land before the task pass, or\n\t\t* the task pass reads progress the report would have lit. `hoursOf` reads the\n\t\t* matching hour list off the status document so the panel stays in step with\n\t\t* whatever schedule the scheduler is actually running on.\n\t\t*/\n\t\t/**\n\t\t* How long to watch a manual run before giving up on it.\n\t\t*\n\t\t* A pass runs one upstream call per account per job, so ~30s for a handful of\n\t\t* accounts. The bound exists so a wedged run cannot spin the button forever;\n\t\t* the run itself keeps going in the background either way.\n\t\t*/\n\t\tconst AUTOMATION_POLL_MS = 2e3;\n\t\tconst AUTOMATION_POLL_ATTEMPTS = 90;\n\t\tconst AUTOMATION_JOBS = [\n\t\t\t\"checkin\",\n\t\t\t\"report\",\n\t\t\t\"tasks\",\n\t\t\t\"streak\",\n\t\t\t\"travel\"\n\t\t];\n\t\t/**\n\t\t* The hour list to save for one job: what the card holds, or the default.\n\t\t*\n\t\t* Mirrors the host's own fallback (`hoursOrDefault` in `scheduler.ts`). An\n\t\t* empty list must resolve to the default on BOTH sides, or the card would save\n\t\t* a schedule the scheduler then refuses to run — the exact silent standstill\n\t\t* this pair of fixes exists to remove.\n\t\t*/\n\t\tfunction hoursOrDefault(configured, fallback) {\n\t\t\treturn configured !== void 0 && configured.length > 0 ? [...configured] : [...fallback];\n\t\t}\n\t\t/** Read one job's configured hours off the status document. */\n\t\tfunction automationHours(status, kind) {\n\t\t\tconst automation = status.automation;\n\t\t\tif (automation === void 0) return [];\n\t\t\tswitch (kind) {\n\t\t\t\tcase \"report\": return automation.reportHours;\n\t\t\t\tcase \"tasks\": return automation.taskHours;\n\t\t\t\tcase \"checkin\": return automation.checkinHours;\n\t\t\t\tcase \"streak\": return automation.streakHours;\n\t\t\t\tcase \"travel\": return automation.travelHours;\n\t\t\t}\n\t\t}\n\t\t/** Read one job's last-run record off the status document. */\n\t\tfunction automationJob(status, kind) {\n\t\t\treturn status.automation?.jobs[kind];\n\t\t}\n\t\tfunction dotColor(status) {\n\t\t\treturn status === \"ok\" ? \"var(--dsw-alias-state-success-primary, #22a06b)\" : status === \"error\" ? \"var(--dsw-alias-state-error-primary, #ef4444)\" : \"var(--dsw-alias-label-dimmed, #9aa0a6)\";\n\t\t}\n\t\tfunction formatCapacity(value) {\n\t\t\tif (value === void 0) return \"\";\n\t\t\tif (value >= 1e6 && value % 1e6 === 0) return `${value / 1e6}M`;\n\t\t\tif (value >= 1e3 && value % 1e3 === 0) return `${value / 1e3}K`;\n\t\t\treturn String(value);\n\t\t}\n\t\t/** Build the draft from the server's selection + catalog flags. */\n\t\tfunction draftFromStatus(status) {\n\t\t\tconst selection = status.selection;\n\t\t\tconst enabled = selection.enabledModelIds;\n\t\t\tconst images = selection.imageModelIds;\n\t\t\tconst budgets = selection.contextBudgets;\n\t\t\tconst out = {};\n\t\t\tfor (const model of status.models) {\n\t\t\t\tconst entry = {\n\t\t\t\t\tenabled: enabled === void 0 || enabled.includes(model.id),\n\t\t\t\t\timages: images === void 0 ? model.supportsImages : images.includes(model.id)\n\t\t\t\t};\n\t\t\t\tconst budget = budgets?.[model.id];\n\t\t\t\tif (budget !== void 0) entry.budget = budget;\n\t\t\t\tout[model.id] = entry;\n\t\t\t}\n\t\t\treturn out;\n\t\t}\n\t\t/** True when the draft differs from what the server last reported. */\n\t\tfunction draftIsDirty(status, draft) {\n\t\t\tconst selection = status.selection;\n\t\t\tconst enabled = new Set(selection.enabledModelIds ?? status.models.filter((m) => m.enabled).map((m) => m.id));\n\t\t\tconst images = new Set(selection.imageModelIds ?? status.models.filter((m) => m.supportsImages).map((m) => m.id));\n\t\t\tconst budgets = selection.contextBudgets ?? {};\n\t\t\tfor (const model of status.models) {\n\t\t\t\tconst entry = draft[model.id];\n\t\t\t\tif (entry === void 0) continue;\n\t\t\t\tif (entry.enabled !== enabled.has(model.id)) return true;\n\t\t\t\tif (entry.images !== images.has(model.id)) return true;\n\t\t\t\tif ((budgets[model.id] ?? model.nativeContextWindow) !== (entry.budget ?? model.nativeContextWindow)) return true;\n\t\t\t}\n\t\t\treturn false;\n\t\t}\n\t\t/** Absolute expiry with the time of day: the upstream grants one-off packages at\n\t\t*  arbitrary clock times, so \"expires 09/19 15:36\" is what the user needs — a\n\t\t*  date alone would read as if it lapsed at midnight. */\n\t\tfunction formatExpiry(ms) {\n\t\t\tif (ms === void 0 || !Number.isFinite(ms)) return \"\";\n\t\t\treturn new Intl.DateTimeFormat(void 0, {\n\t\t\t\tmonth: \"2-digit\",\n\t\t\t\tday: \"2-digit\",\n\t\t\t\thour: \"2-digit\",\n\t\t\t\tminute: \"2-digit\",\n\t\t\t\thour12: false\n\t\t\t}).format(new Date(ms));\n\t\t}\n\t\t/** Whole days until `ms`, floored at 0; undefined when there is no deadline. */\n\t\tfunction daysUntil(ms) {\n\t\t\tif (ms === void 0 || !Number.isFinite(ms)) return void 0;\n\t\t\treturn Math.max(0, Math.floor((ms - Date.now()) / 864e5));\n\t\t}\n\t\t/** True when a one-off package lapses inside the \"expiring soon\" window. */\n\t\tfunction isExpiringSoon(pack) {\n\t\t\tif (pack.monthly === true) return false;\n\t\t\tconst days = daysUntil(pack.expiresAtMs);\n\t\t\treturn days !== void 0 && days <= 3;\n\t\t}\n\t\t/**\n\t\t* The promo badge for one model, or undefined when it has none.\n\t\t*\n\t\t* `free` is read off the CREDIT MULTIPLIER, not off a tag. Neither gateway ever\n\t\t* sends a literal `free` tag: the global roster marks its zero-cost models\n\t\t* (`hy3`, `hy4-preview-f`, `deepseek-v4.1-flash`) as `credits: \"x0.00\"`, so\n\t\t* waiting for a tag meant the badge NEVER appeared — including on models that\n\t\t* genuinely cost nothing.\n\t\t*\n\t\t* An explicit free-ish tag still wins when present, so a gateway that starts\n\t\t* tagging them keeps working without another change.\n\t\t*/\n\t\tfunction tagFor(model) {\n\t\t\tconst tags = model.tags ?? [];\n\t\t\tif (tags.includes(\"free\") || model.multiplier === 0) return \"free\";\n\t\t\tif (tags.includes(\"limited-free\")) return \"limited\";\n\t\t\tif (tags.includes(\"night-discount\")) return \"night\";\n\t\t}\n\t\t/** Render pool health, per-account credits/cooldown, and the model directory. */\n\t\tfunction PoolCard({ t, settingsScope }) {\n\t\t\tconst settingsWritable = settingsScope?.getSnapshot().writable === true;\n\t\t\t/** Which region tab is showing. A CN-only install never leaves this. */\n\t\t\tconst [activeRegion, setActiveRegion] = (0, react.useState)(\"cn\");\n\t\t\t/**\n\t\t\t* Last-known status per region. Kept per region (not a single slot) so\n\t\t\t* switching tabs shows the other side's last answer immediately instead of\n\t\t\t* a blank frame, and the tab dots stay meaningful while a tab is hidden.\n\t\t\t*/\n\t\t\tconst [statusByRegion, setStatusByRegion] = (0, react.useState)({});\n\t\t\t/** The document for the tab on screen; undefined until its first answer. */\n\t\t\tconst status = statusByRegion[activeRegion];\n\t\t\t/**\n\t\t\t* Today's automation take, summed across accounts.\n\t\t\t*\n\t\t\t* Summed from the per-account counters rather than kept separately, so the\n\t\t\t* panel total and the per-account lines can never disagree.\n\t\t\t*/\n\t\t\tconst automationTotals = Object.values(status?.automation?.earningsToday ?? {}).reduce((sum, entry) => ({\n\t\t\t\tcredit: sum.credit + entry.credit,\n\t\t\t\tenergy: sum.energy + entry.energy,\n\t\t\t\tclaimed: sum.claimed + entry.claimed,\n\t\t\t\tcheckinCredit: sum.checkinCredit + entry.checkinCredit,\n\t\t\t\tbonusCredit: sum.bonusCredit + entry.bonusCredit,\n\t\t\t\ttravelCredit: sum.travelCredit + entry.travelCredit\n\t\t\t}), {\n\t\t\t\tcredit: 0,\n\t\t\t\tenergy: 0,\n\t\t\t\tclaimed: 0,\n\t\t\t\tcheckinCredit: 0,\n\t\t\t\tbonusCredit: 0,\n\t\t\t\ttravelCredit: 0\n\t\t\t});\n\t\t\tconst [error, setError] = (0, react.useState)(void 0);\n\t\t\tconst [busy, setBusy] = (0, react.useState)(false);\n\t\t\tconst [cooldownBusy, setCooldownBusy] = (0, react.useState)(false);\n\t\t\tconst [automationBusy, setAutomationBusy] = (0, react.useState)(false);\n\t\t\t/** The automation job currently running from the card, if any. */\n\t\t\tconst [automationRun, setAutomationRun] = (0, react.useState)(void 0);\n\t\t\t/** Account id whose reserved-credit floor is being saved, if any. */\n\t\t\tconst [reserveBusy, setReserveBusy] = (0, react.useState)(void 0);\n\t\t\tconst [flash, setFlash] = (0, react.useState)(void 0);\n\t\t\t/** Account id whose daily claim is currently in flight. */\n\t\t\tconst [checkinBusyId, setCheckinBusyId] = (0, react.useState)(void 0);\n\t\t\t/** Account id whose enable/disable switch is in flight, if any. */\n\t\t\tconst [accountBusyId, setAccountBusyId] = (0, react.useState)(void 0);\n\t\t\t/**\n\t\t\t* Draft model selection. `undefined` means \"no local edits\"; once a checkbox\n\t\t\t* is touched the draft takes over and is what the Save button posts. Discard\n\t\t\t* drops it back to the copy the server last reported.\n\t\t\t*/\n\t\t\tconst [draftByRegion, setDraftByRegion] = (0, react.useState)({});\n\t\t\t/**\n\t\t\t* The draft for the tab on screen. Keyed by region: the two gateways have\n\t\t\t* different rosters, so edits made on one tab must not leak into the other\n\t\t\t* when the user switches tabs (or saves).\n\t\t\t*/\n\t\t\tconst draft = draftByRegion[activeRegion];\n\t\t\tconst setDraft = (next) => {\n\t\t\t\tsetDraftByRegion((prev) => ({\n\t\t\t\t\t...prev,\n\t\t\t\t\t[activeRegion]: next\n\t\t\t\t}));\n\t\t\t};\n\t\t\tconst [savingModels, setSavingModels] = (0, react.useState)(false);\n\t\t\tconst mounted = (0, react.useRef)(true);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tmounted.current = true;\n\t\t\t\treturn () => {\n\t\t\t\t\tmounted.current = false;\n\t\t\t\t};\n\t\t\t}, []);\n\t\t\t/**\n\t\t\t* Fetch one region's status. `region` is a parameter rather than a closure\n\t\t\t* read so the callback identity does not change with the tab: the polling\n\t\t\t* effect can key off it without restarting on every switch, and each region's\n\t\t\t* last answer stays in its own slot (see `statusByRegion`).\n\t\t\t*/\n\t\t\tconst refresh = (0, react.useCallback)(async (region, signal) => {\n\t\t\t\ttry {\n\t\t\t\t\tconst response = await fetch(`${POOL_STATUS_PATH}?region=${region}`, {\n\t\t\t\t\t\theaders: { accept: \"application/json\" },\n\t\t\t\t\t\tcredentials: \"same-origin\",\n\t\t\t\t\t\t...signal === void 0 ? {} : { signal }\n\t\t\t\t\t});\n\t\t\t\t\tconst value = await response.json().catch(() => void 0);\n\t\t\t\t\tif (!response.ok) throw new Error(`HTTP ${response.status}`);\n\t\t\t\t\tif (mounted.current && signal?.aborted !== true) {\n\t\t\t\t\t\tsetStatusByRegion((prev) => ({\n\t\t\t\t\t\t\t...prev,\n\t\t\t\t\t\t\t[region]: value\n\t\t\t\t\t\t}));\n\t\t\t\t\t\tsetError(void 0);\n\t\t\t\t\t}\n\t\t\t\t\treturn value;\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current && signal?.aborted !== true) setError(cause instanceof Error ? cause.message : String(cause));\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t}, []);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tconst controller = new AbortController();\n\t\t\t\trefresh(activeRegion, controller.signal);\n\t\t\t\tconst timer = window.setInterval(() => {\n\t\t\t\t\trefresh(activeRegion, controller.signal);\n\t\t\t\t}, POLL_INTERVAL_MS);\n\t\t\t\treturn () => {\n\t\t\t\t\twindow.clearInterval(timer);\n\t\t\t\t\tcontroller.abort();\n\t\t\t\t};\n\t\t\t}, [refresh, activeRegion]);\n\t\t\tconst rescan = async () => {\n\t\t\t\tsetBusy(true);\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tconst response = await fetch(POOL_RESCAN_PATH, {\n\t\t\t\t\t\tmethod: \"POST\",\n\t\t\t\t\t\theaders: { accept: \"application/json\" },\n\t\t\t\t\t\tcredentials: \"same-origin\"\n\t\t\t\t\t});\n\t\t\t\t\tconst body = await response.json();\n\t\t\t\t\tif (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t\tif (mounted.current) setFlash(t?.(\"row.accountsRescanned\", { count: body.accounts ?? 0 }) ?? \"\");\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setBusy(false);\n\t\t\t\t}\n\t\t\t};\n\t\t\tconst resetCooldowns = async () => {\n\t\t\t\tsetCooldownBusy(true);\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tconst response = await fetch(POOL_RESET_COOLDOWN_PATH, {\n\t\t\t\t\t\tmethod: \"POST\",\n\t\t\t\t\t\theaders: { accept: \"application/json\" },\n\t\t\t\t\t\tcredentials: \"same-origin\"\n\t\t\t\t\t});\n\t\t\t\t\tif (!response.ok) throw new Error(`HTTP ${response.status}`);\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t\tif (mounted.current) setFlash(t?.(\"row.resetCooldownsDone\") ?? \"\");\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setCooldownBusy(false);\n\t\t\t\t}\n\t\t\t};\n\t\t\t/**\n\t\t\t* Claim one account's daily check-in. The account id travels in the body so\n\t\t\t* the Host can never guess: a click on account B's button can only ever\n\t\t\t* collect account B's reward. The status is re-read afterwards so the card\n\t\t\t* reflects the new streak / total without waiting for the next poll.\n\t\t\t*/\n\t\t\tconst claimCheckin = async (accountId) => {\n\t\t\t\tsetCheckinBusyId(accountId);\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tconst response = await fetch(POOL_CHECKIN_PATH, {\n\t\t\t\t\t\tmethod: \"POST\",\n\t\t\t\t\t\theaders: {\n\t\t\t\t\t\t\taccept: \"application/json\",\n\t\t\t\t\t\t\t\"content-type\": \"application/json\"\n\t\t\t\t\t\t},\n\t\t\t\t\t\tcredentials: \"same-origin\",\n\t\t\t\t\t\tbody: JSON.stringify({ accountId })\n\t\t\t\t\t});\n\t\t\t\t\tconst body = await response.json().catch(() => void 0);\n\t\t\t\t\tif (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t\tconst credit = body?.claim?.credit ?? 0;\n\t\t\t\t\tif (mounted.current) setFlash(t?.(\"row.checkinClaimedReward\", { credit: formatNumber(credit) }) ?? `Claimed +${formatNumber(credit)} credits`);\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setCheckinBusyId(void 0);\n\t\t\t\t}\n\t\t\t};\n\t\t\t/**\n\t\t\t* Switch one account in or out of the pool.\n\t\t\t*\n\t\t\t* The id travels in the body and the host validates it against the accounts it\n\t\t\t* really knows, so a stale tab cannot write an orphan id. Disabling only stops\n\t\t\t* the account from being picked — it stays listed so it can be turned back on —\n\t\t\t* and the change is saved through the settings section, so it survives a\n\t\t\t* restart and is re-applied after every re-scan.\n\t\t\t*/\n\t\t\tconst toggleAccountDisabled = async (accountId, disabled) => {\n\t\t\t\tconst write = settingsScope?.set;\n\t\t\t\tif (write === void 0) {\n\t\t\t\t\tsetError(t?.(\"row.modelsSaveError\", { message: \"settings scope is read-only\" }) ?? \"settings scope is read-only\");\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tsetAccountBusyId(accountId);\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tconst current = (status?.accounts ?? []).filter((account) => account.disabled === true).map((account) => account.id);\n\t\t\t\t\tconst next = disabled ? current.includes(accountId) ? current : [...current, accountId] : current.filter((id) => id !== accountId);\n\t\t\t\t\tawait write.call(settingsScope, \"disabledAccountIds\", next);\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tconst message = cause instanceof Error ? cause.message : String(cause);\n\t\t\t\t\tif (mounted.current) setError(t?.(\"row.accountToggleError\", { message }) ?? \"Could not switch the account: \" + message);\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setAccountBusyId(void 0);\n\t\t\t\t}\n\t\t\t};\n\t\t\t/**\n\t\t\t* Throw one account out of the pool for good, or take it back.\n\t\t\t*\n\t\t\t* The host owns the ignore file, so this is a plain route call: no settings\n\t\t\t* scope is involved, which is also why it keeps working on a profile whose\n\t\t\t* settings section is read-only.\n\t\t\t*/\n\t\t\tconst setAccountIgnored = async (accountId, ignored) => {\n\t\t\t\tsetAccountBusyId(accountId);\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tconst response = await fetch(POOL_ACCOUNT_IGNORE_PATH, {\n\t\t\t\t\t\tmethod: \"POST\",\n\t\t\t\t\t\theaders: { \"Content-Type\": \"application/json\" },\n\t\t\t\t\t\tbody: JSON.stringify({\n\t\t\t\t\t\t\taccountId,\n\t\t\t\t\t\t\tignored\n\t\t\t\t\t\t})\n\t\t\t\t\t});\n\t\t\t\t\tif (!response.ok) {\n\t\t\t\t\t\tconst detail = await response.json().catch(() => ({}));\n\t\t\t\t\t\tthrow new Error(detail.error ?? `HTTP ${response.status}`);\n\t\t\t\t\t}\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tconst message = cause instanceof Error ? cause.message : String(cause);\n\t\t\t\t\tif (mounted.current) setError(t?.(\"row.accountIgnoreError\", { message }) ?? \"Could not change the ignore list: \" + message);\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setAccountBusyId(void 0);\n\t\t\t\t}\n\t\t\t};\n\t\t\t/** Keep the draft in step with the server copy while nothing is dirty. */\n\t\t\tconst modelDraft = draft ?? (status === void 0 ? {} : draftFromStatus(status));\n\t\t\t/** Model edits need a writable settings scope; otherwise the rows are read-only. */\n\t\t\tconst modelsEditable = settingsWritable;\n\t\t\tconst modelsDirty = draft !== void 0 && status !== void 0 && draftIsDirty(status, draft);\n\t\t\tconst enabledCount = Object.values(modelDraft).filter((entry) => entry.enabled).length;\n\t\t\tconst toggleModel = (id) => {\n\t\t\t\tif (status === void 0) return;\n\t\t\t\tconst base = draft ?? draftFromStatus(status);\n\t\t\t\tconst entry = base[id];\n\t\t\t\tif (entry === void 0) return;\n\t\t\t\tsetDraft({\n\t\t\t\t\t...base,\n\t\t\t\t\t[id]: {\n\t\t\t\t\t\t...entry,\n\t\t\t\t\t\tenabled: !entry.enabled\n\t\t\t\t\t}\n\t\t\t\t});\n\t\t\t};\n\t\t\tconst toggleModelImage = (id) => {\n\t\t\t\tif (status === void 0) return;\n\t\t\t\tconst base = draft ?? draftFromStatus(status);\n\t\t\t\tconst entry = base[id];\n\t\t\t\tif (entry === void 0) return;\n\t\t\t\tsetDraft({\n\t\t\t\t\t...base,\n\t\t\t\t\t[id]: {\n\t\t\t\t\t\t...entry,\n\t\t\t\t\t\timages: !entry.images\n\t\t\t\t\t}\n\t\t\t\t});\n\t\t\t};\n\t\t\tconst setModelBudget = (id, budget) => {\n\t\t\t\tif (status === void 0) return;\n\t\t\t\tconst base = draft ?? draftFromStatus(status);\n\t\t\t\tconst entry = base[id];\n\t\t\t\tif (entry === void 0) return;\n\t\t\t\tsetDraft({\n\t\t\t\t\t...base,\n\t\t\t\t\t[id]: {\n\t\t\t\t\t\t...entry,\n\t\t\t\t\t\tbudget\n\t\t\t\t\t}\n\t\t\t\t});\n\t\t\t};\n\t\t\tconst discardModels = () => {\n\t\t\t\tsetDraft(void 0);\n\t\t\t\tsetFlash(void 0);\n\t\t\t};\n\t\t\t/**\n\t\t\t* Persist the draft. The route validates the payload again on the host side,\n\t\t\t* so a malformed draft is rejected there rather than silently stored. The\n\t\t\t* card refuses to save an empty enable-list: that would leave the picker\n\t\t\t* with nothing to offer and no obvious way back.\n\t\t\t*/\n\t\t\t/**\n\t\t\t* Persist the draft into the plugin settings section.\n\t\t\t*\n\t\t\t* The write goes through `settingsScope` rather than a bespoke route: that is\n\t\t\t* the same document the model picker reads, so one save covers every account\n\t\t\t* and survives account rotation — the selection is a property of the pool,\n\t\t\t* not of whichever account happens to be serving right now.\n\t\t\t*\n\t\t\t* The card refuses an empty enable-list: saving one would leave the picker\n\t\t\t* with nothing to offer and no obvious way back.\n\t\t\t*/\n\t\t\t/**\n\t\t\t* Switch how the pool spreads requests. Written straight through the\n\t\t\t* settings scope (that is where the host keeps the pool options), so the\n\t\t\t* change lands without a restart and survives the next card refresh.\n\t\t\t*/\n\t\t\tconst setDistribution = async (next) => {\n\t\t\t\tconst write = settingsScope?.set;\n\t\t\t\tif (write === void 0) {\n\t\t\t\t\tsetError(t?.(\"row.modelsSaveError\", { message: \"settings scope is read-only\" }) ?? \"settings scope is read-only\");\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tawait write.call(settingsScope, \"distribution\", next);\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current) setError(String(cause));\n\t\t\t\t}\n\t\t\t};\n\t\t\t/**\n\t\t\t* Switch the daily-points automation on or off.\n\t\t\t*\n\t\t\t* The whole `automation` object is written as one key, because that is how the\n\t\t\t* settings document stores it: the schedule fields must be carried along, or a\n\t\t\t* save would drop the hour lists the scheduler is running on.\n\t\t\t*/\n\t\t\tconst setAutomationEnabled = async (enabled) => {\n\t\t\t\tconst write = settingsScope?.set;\n\t\t\t\tif (write === void 0) {\n\t\t\t\t\tsetError(t?.(\"row.modelsSaveError\", { message: \"settings scope is read-only\" }) ?? \"settings scope is read-only\");\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tconst existing = status?.automation;\n\t\t\t\tsetAutomationBusy(true);\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tawait write.call(settingsScope, \"automation\", {\n\t\t\t\t\t\tcheckinHours: hoursOrDefault(existing?.checkinHours, DEFAULT_AUTOMATION_HOURS.checkin),\n\t\t\t\t\t\treportHours: hoursOrDefault(existing?.reportHours, DEFAULT_AUTOMATION_HOURS.report),\n\t\t\t\t\t\ttaskHours: hoursOrDefault(existing?.taskHours, DEFAULT_AUTOMATION_HOURS.tasks),\n\t\t\t\t\t\tstreakHours: hoursOrDefault(existing?.streakHours, DEFAULT_AUTOMATION_HOURS.streak),\n\t\t\t\t\t\ttravelHours: hoursOrDefault(existing?.travelHours, DEFAULT_AUTOMATION_HOURS.travel),\n\t\t\t\t\t\tenabled\n\t\t\t\t\t});\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current) setError(String(cause));\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setAutomationBusy(false);\n\t\t\t\t}\n\t\t\t};\n\t\t\t/**\n\t\t\t/**\n\t\t\t* Run the whole automation pass now.\n\t\t\t*\n\t\t\t* The route only STARTS the pass: a full run takes tens of seconds, which is\n\t\t\t* far too long to hold a request open. This watches the scheduler status until\n\t\t\t* the run settles, so the panel can show \"running\" honestly and report the\n\t\t\t* result when it lands.\n\t\t\t*/\n\t\t\tconst runAutomationJob = async () => {\n\t\t\t\tsetAutomationRun(\"all\");\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tconst response = await fetch(POOL_AUTOMATION_RUN_PATH, {\n\t\t\t\t\t\tmethod: \"POST\",\n\t\t\t\t\t\theaders: {\n\t\t\t\t\t\t\t\"accept\": \"application/json\",\n\t\t\t\t\t\t\t\"content-type\": \"application/json\"\n\t\t\t\t\t\t},\n\t\t\t\t\t\tcredentials: \"same-origin\",\n\t\t\t\t\t\tbody: JSON.stringify({ job: \"all\" })\n\t\t\t\t\t});\n\t\t\t\t\tconst body = await response.json();\n\t\t\t\t\tif (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);\n\t\t\t\t\tif (body.started === false) {\n\t\t\t\t\t\tif (mounted.current) setFlash(t?.(\"row.autoAlreadyRunning\") ?? \"A run is already in progress\");\n\t\t\t\t\t}\n\t\t\t\t\tlet settled = false;\n\t\t\t\t\tfor (let attempt = 0; attempt < AUTOMATION_POLL_ATTEMPTS; attempt += 1) {\n\t\t\t\t\t\tawait new Promise((resolve) => setTimeout(resolve, AUTOMATION_POLL_MS));\n\t\t\t\t\t\tif (!mounted.current) return;\n\t\t\t\t\t\tif ((await refresh(activeRegion))?.automation?.runInProgress === false) {\n\t\t\t\t\t\t\tsettled = true;\n\t\t\t\t\t\t\tbreak;\n\t\t\t\t\t\t}\n\t\t\t\t\t}\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t\tif (mounted.current) setFlash(settled ? t?.(\"row.autoRunDone\") ?? \"Automation pass finished\" : t?.(\"row.autoRunTimeout\") ?? \"Still running; check back in a moment\");\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setAutomationRun(void 0);\n\t\t\t\t}\n\t\t\t};\n\t\t\t/**\n\t\t\t* Save one account reserved-credit floor.\n\t\t\t*\n\t\t\t* A reserve only protects credits if the pool knows the balance, so this\n\t\t\t* also refreshes the account list afterwards: the reserve badge appears\n\t\t\t* as soon as the reading crosses the floor.\n\t\t\t*/\n\t\t\t/**\n\t\t\t* Save one account reserved-credit floor.\n\t\t\t*\n\t\t\t* A reserve only protects credits if the pool knows the balance, so this also\n\t\t\t* refreshes the account list afterwards: the reserve badge appears as soon as\n\t\t\t* the reading crosses the floor.\n\t\t\t*\n\t\t\t* Returns whether the host CONFIRMED the write. The card keys its inline\n\t\t\t* \"saved / not saved\" note off this, so a failure is shown where the user is\n\t\t\t* looking instead of only in the card-level notice line.\n\t\t\t*/\n\t\t\tconst saveCreditReserve = async (accountId, reserve) => {\n\t\t\t\tsetReserveBusy(accountId);\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tconst response = await fetch(POOL_CREDIT_RESERVE_PATH, {\n\t\t\t\t\t\tmethod: \"POST\",\n\t\t\t\t\t\theaders: {\n\t\t\t\t\t\t\t\"accept\": \"application/json\",\n\t\t\t\t\t\t\t\"content-type\": \"application/json\"\n\t\t\t\t\t\t},\n\t\t\t\t\t\tcredentials: \"same-origin\",\n\t\t\t\t\t\tbody: JSON.stringify({\n\t\t\t\t\t\t\taccountId,\n\t\t\t\t\t\t\treserve\n\t\t\t\t\t\t})\n\t\t\t\t\t});\n\t\t\t\t\tconst body = await response.json();\n\t\t\t\t\tif (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);\n\t\t\t\t\tawait refresh(activeRegion);\n\t\t\t\t\tif (mounted.current) setFlash(reserve > 0 ? t?.(\"row.reserveSaved\", { credits: reserve }) ?? `Keeping ${reserve} credits` : t?.(\"row.reserveCleared\") ?? \"Reserve cleared\");\n\t\t\t\t\treturn true;\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));\n\t\t\t\t\treturn false;\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setReserveBusy(void 0);\n\t\t\t\t}\n\t\t\t};\n\t\t\tconst saveModels = async () => {\n\t\t\t\tif (draft === void 0 || status === void 0) return;\n\t\t\t\tif (enabledCount === 0) {\n\t\t\t\t\tsetError(t?.(\"row.modelsEmpty\") ?? \"No model enabled\");\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tconst write = settingsScope?.set;\n\t\t\t\tif (write === void 0) {\n\t\t\t\t\tsetError(t?.(\"row.modelsSaveError\", { message: \"settings scope is read-only\" }) ?? \"settings scope is read-only\");\n\t\t\t\t\treturn;\n\t\t\t\t}\n\t\t\t\tsetSavingModels(true);\n\t\t\t\tsetFlash(void 0);\n\t\t\t\ttry {\n\t\t\t\t\tconst enabledModelIds = Object.entries(draft).filter(([, e]) => e.enabled).map(([id]) => id);\n\t\t\t\t\tconst imageModelIds = Object.entries(draft).filter(([, e]) => e.images).map(([id]) => id);\n\t\t\t\t\tconst contextBudgets = {};\n\t\t\t\t\tfor (const [id, entry] of Object.entries(draft)) if (entry.budget !== void 0) contextBudgets[id] = entry.budget;\n\t\t\t\t\tconst key = activeRegion === \"cn\" ? \"modelSelectionCn\" : \"modelSelectionGlobal\";\n\t\t\t\t\tawait write.call(settingsScope, key, {\n\t\t\t\t\t\tenabledModelIds,\n\t\t\t\t\t\timageModelIds,\n\t\t\t\t\t\tcontextBudgets\n\t\t\t\t\t});\n\t\t\t\t\tsetDraft(void 0);\n\t\t\t\t\tif (mounted.current) setFlash(t?.(\"row.modelsSaved\") ?? \"Saved\");\n\t\t\t\t} catch (cause) {\n\t\t\t\t\tif (mounted.current) setError(t?.(\"row.modelsSaveError\", { message: cause instanceof Error ? cause.message : String(cause) }) ?? String(cause));\n\t\t\t\t} finally {\n\t\t\t\t\tif (mounted.current) setSavingModels(false);\n\t\t\t\t}\n\t\t\t};\n\t\t\tconst title = t?.(\"row.title\") ?? \"WorkBuddy XD Pool\";\n\t\t\tconst description = t?.(\"row.desc\") ?? \"\";\n\t\t\tconst accountCount = status?.accounts.length ?? 0;\n\t\t\tconst cooling = status?.cooling ?? 0;\n\t\t\tconst state = error !== void 0 ? \"error\" : status === void 0 && error === void 0 ? \"idle\" : accountCount > 0 && cooling < accountCount ? \"ok\" : \"idle\";\n\t\t\t/** Human label for the active tab, used inside the empty-state copy. */\n\t\t\tconst regionLabel = activeRegion === \"cn\" ? t?.(\"row.tabCn\") ?? \"CN\" : t?.(\"row.tabGlobal\") ?? \"Global\";\n\t\t\tconst stateLabel = error !== void 0 ? t?.(\"row.requestFailed\") ?? \"Request failed\" : accountCount === 0 ? t?.(\"row.regionEmpty\") ?? t?.(\"row.poolEmpty\") ?? \"No account yet\" : state === \"ok\" ? t?.(\"row.ok\") ?? \"Healthy\" : t?.(\"row.allCooling\") ?? \"All cooling\";\n\t\t\tconst shimRunning = status?.shim.running === true;\n\t\t\tconst shimHint = status === void 0 ? null : shimRunning ? `${t?.(\"row.shimRunning\") ?? \"Provider listening\"}${status.shim.baseUrl === void 0 ? \"\" : ` · ${status.shim.baseUrl}`}` : t?.(\"row.shimStopped\") ?? \"Provider loopback not running\";\n\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\tclassName: \"dsm-workbuddy-xdpool-page\",\n\t\t\t\tchildren: [\n\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"header\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-page-head\",\n\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"img\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-page-icon\",\n\t\t\t\t\t\t\t\tsrc: POOL_PLUGIN_ICON,\n\t\t\t\t\t\t\t\talt: \"\"\n\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"span\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-page-copy\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"h2\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-page-title\",\n\t\t\t\t\t\t\t\t\tchildren: title\n\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-page-desc\",\n\t\t\t\t\t\t\t\t\tchildren: description\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-page-actions\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-btn dsm-btn-outline\",\n\t\t\t\t\t\t\t\t\tdisabled: busy,\n\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\trescan();\n\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\tchildren: busy ? t?.(\"row.accountsScanning\") ?? \"Detecting…\" : t?.(\"row.accountsRescan\") ?? \"Detect accounts again\"\n\t\t\t\t\t\t\t\t}), cooling > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-btn dsm-btn-outline\",\n\t\t\t\t\t\t\t\t\tdisabled: cooldownBusy,\n\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\tresetCooldowns();\n\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\tchildren: cooldownBusy ? t?.(\"row.resetCooldownsBusy\") ?? \"Clearing…\" : t?.(\"row.resetCooldowns\") ?? \"Clear all cooldowns\"\n\t\t\t\t\t\t\t\t}) : null]\n\t\t\t\t\t\t\t})\n\t\t\t\t\t\t]\n\t\t\t\t\t}),\n\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-card dsm-workbuddy-xdpool-status\",\n\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-tabs\",\n\t\t\t\t\t\t\trole: \"tablist\",\n\t\t\t\t\t\t\tchildren: status?.regions.map((region) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"button\", {\n\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\trole: \"tab\",\n\t\t\t\t\t\t\t\t\"aria-selected\": region === activeRegion,\n\t\t\t\t\t\t\t\tclassName: `dsm-workbuddy-xdpool-tab${region === activeRegion ? \" dsm-workbuddy-xdpool-tab-active\" : \"\"}`,\n\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\tsetActiveRegion(region);\n\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-tab-dot\",\n\t\t\t\t\t\t\t\t\t\"data-state\": state\n\t\t\t\t\t\t\t\t}), region === \"cn\" ? t?.(\"row.tabCn\") ?? \"CN\" : t?.(\"row.tabGlobal\") ?? \"Global\"]\n\t\t\t\t\t\t\t}, region))\n\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-usage-head\",\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-usage-copy\",\n\t\t\t\t\t\t\t\trole: \"status\",\n\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-usage-status\",\n\t\t\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\t\"aria-hidden\": \"true\",\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-usage-dot\",\n\t\t\t\t\t\t\t\t\t\t\tstyle: { background: dotColor(state) }\n\t\t\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", { children: stateLabel })]\n\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\taccountCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-usage-hint\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.accountsSummary\", {\n\t\t\t\t\t\t\t\t\t\t\tcount: accountCount,\n\t\t\t\t\t\t\t\t\t\t\tcooling\n\t\t\t\t\t\t\t\t\t\t}) ?? `${accountCount} account(s) · ${cooling} cooling`\n\t\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t\tshimHint === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-usage-hint\",\n\t\t\t\t\t\t\t\t\t\tchildren: shimHint\n\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\tstatus === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-dist\",\n\t\t\t\t\t\t\t\t\t\trole: \"radiogroup\",\n\t\t\t\t\t\t\t\t\t\t\"aria-label\": t?.(\"row.distTitle\") ?? \"Account usage\",\n\t\t\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-dist-title\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.distTitle\") ?? \"Account usage\"\n\t\t\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-dist-options\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\t\t\t\t\"priority\",\n\t\t\t\t\t\t\t\t\t\t\t\t\"balanced\",\n\t\t\t\t\t\t\t\t\t\t\t\t\"round-robin\"\n\t\t\t\t\t\t\t\t\t\t\t].map((option) => {\n\t\t\t\t\t\t\t\t\t\t\t\tconst active = (status.distribution ?? \"priority\") === option;\n\t\t\t\t\t\t\t\t\t\t\t\tconst label = option === \"priority\" ? t?.(\"row.distPriority\") ?? \"Priority\" : option === \"balanced\" ? t?.(\"row.distBalanced\") ?? \"Balanced\" : t?.(\"row.distRoundRobin\") ?? \"Round-robin\";\n\t\t\t\t\t\t\t\t\t\t\t\tconst hint = option === \"priority\" ? t?.(\"row.distPriorityHint\") ?? \"\" : option === \"balanced\" ? t?.(\"row.distBalancedHint\") ?? \"\" : t?.(\"row.distRoundRobinHint\") ?? \"\";\n\t\t\t\t\t\t\t\t\t\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"button\", {\n\t\t\t\t\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\t\t\t\t\trole: \"radio\",\n\t\t\t\t\t\t\t\t\t\t\t\t\t\"aria-checked\": active,\n\t\t\t\t\t\t\t\t\t\t\t\t\ttitle: hint,\n\t\t\t\t\t\t\t\t\t\t\t\t\tdisabled: !modelsEditable,\n\t\t\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-dist-option\" + (active ? \" dsm-workbuddy-xdpool-dist-option-active\" : \"\"),\n\t\t\t\t\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tsetDistribution(option);\n\t\t\t\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-dist-option-name\",\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tchildren: label\n\t\t\t\t\t\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-dist-option-hint\",\n\t\t\t\t\t\t\t\t\t\t\t\t\t\tchildren: hint\n\t\t\t\t\t\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t\t\t\t\t\t}, option);\n\t\t\t\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-usage-actions\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-btn dsm-btn-outline\",\n\t\t\t\t\t\t\t\t\tdisabled: busy,\n\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\trescan();\n\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\tchildren: busy ? t?.(\"row.accountsScanning\") ?? \"Detecting…\" : t?.(\"row.accountsRescan\") ?? \"Detect accounts again\"\n\t\t\t\t\t\t\t\t}), cooling > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-btn dsm-btn-outline\",\n\t\t\t\t\t\t\t\t\tdisabled: cooldownBusy,\n\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\tresetCooldowns();\n\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\tchildren: cooldownBusy ? t?.(\"row.resetCooldownsBusy\") ?? \"Clearing…\" : t?.(\"row.resetCooldowns\") ?? \"Clear all cooldowns\"\n\t\t\t\t\t\t\t\t}) : null]\n\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t})]\n\t\t\t\t\t}),\n\t\t\t\t\tactiveRegion !== \"cn\" || status?.automation === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-card dsm-workbuddy-xdpool-auto\",\n\t\t\t\t\t\t\"aria-label\": t?.(\"row.autoTitle\") ?? \"Automation\",\n\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-head\",\n\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-title\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoTitle\") ?? \"Automation\"\n\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t!status.automation.enabled ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-btn dsm-btn-outline dsm-workbuddy-xdpool-auto-run\",\n\t\t\t\t\t\t\t\t\t\tdisabled: automationRun !== void 0,\n\t\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\t\trunAutomationJob();\n\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\tchildren: automationRun !== void 0 ? t?.(\"row.autoRunning\") ?? \"Running…\" : t?.(\"row.autoRunAll\") ?? \"Run all now\"\n\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\t\trole: \"switch\",\n\t\t\t\t\t\t\t\t\t\t\"aria-checked\": status.automation.enabled,\n\t\t\t\t\t\t\t\t\t\tdisabled: !settingsWritable || automationBusy,\n\t\t\t\t\t\t\t\t\t\tclassName: `dsm-workbuddy-xdpool-auto-switch${status.automation.enabled ? \" dsm-workbuddy-xdpool-auto-switch-on\" : \"\"}`,\n\t\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\t\tsetAutomationEnabled(!status.automation.enabled);\n\t\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\t\tchildren: automationBusy ? t?.(\"row.autoBusy\") ?? \"Saving…\" : status.automation.enabled ? t?.(\"row.autoOn\") ?? \"On\" : t?.(\"row.autoOff\") ?? \"Off\"\n\t\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-hint\",\n\t\t\t\t\t\t\t\tchildren: status.automation.enabled ? t?.(\"row.autoHintOn\") ?? \"Reports activity, claims task rewards and checks in once a day.\" : t?.(\"row.autoHintOff\") ?? \"Off: no background requests are made for you.\"\n\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\tautomationTotals.credit === 0 && automationTotals.checkinCredit === 0 && automationTotals.bonusCredit === 0 && automationTotals.travelCredit === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-total\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-total-label\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoToday\") ?? \"Today\"\n\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"span\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-total-list\",\n\t\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\t\tautomationTotals.credit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-total-row\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoFromTasks\", {\n\t\t\t\t\t\t\t\t\t\t\t\tcredit: automationTotals.credit,\n\t\t\t\t\t\t\t\t\t\t\t\tenergy: automationTotals.energy,\n\t\t\t\t\t\t\t\t\t\t\t\tcount: automationTotals.claimed\n\t\t\t\t\t\t\t\t\t\t\t}) ?? `Tasks +${automationTotals.credit}`\n\t\t\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t\t\tautomationTotals.checkinCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-total-row\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoFromCheckin\", { credit: automationTotals.checkinCredit }) ?? `Check-in +${automationTotals.checkinCredit}`\n\t\t\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t\t\tautomationTotals.bonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-total-row\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoFromBonus\", { credit: automationTotals.bonusCredit }) ?? `Streak +${automationTotals.bonusCredit}`\n\t\t\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t\t\tautomationTotals.travelCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-total-row\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoFromTravel\", { credit: automationTotals.travelCredit }) ?? `Buddy +${automationTotals.travelCredit}`\n\t\t\t\t\t\t\t\t\t\t}) : null\n\t\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\tstatus.automation.enabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-jobs\",\n\t\t\t\t\t\t\t\tchildren: AUTOMATION_JOBS.map((kind) => {\n\t\t\t\t\t\t\t\t\tconst job = automationJob(status, kind);\n\t\t\t\t\t\t\t\t\tconst hours = automationHours(status, kind);\n\t\t\t\t\t\t\t\t\tconst label = t?.(`row.autoJob_${kind}`) ?? kind;\n\t\t\t\t\t\t\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-job\",\n\t\t\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-job-name\",\n\t\t\t\t\t\t\t\t\t\t\t\tchildren: label\n\t\t\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-job-when\",\n\t\t\t\t\t\t\t\t\t\t\t\tchildren: hours.length === 0 ? t?.(\"row.autoHourNone\") ?? \"not scheduled\" : hours.map((hour) => `${String(hour).padStart(2, \"0\")}:00`).join(\" · \")\n\t\t\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-job-last\",\n\t\t\t\t\t\t\t\t\t\t\t\tchildren: job?.lastRunDate === void 0 ? t?.(\"row.autoNever\") ?? \"not run yet\" : `${job.lastRunDate} · ${job.ok}${job.failed > 0 ? `/${job.failed}` : \"\"}`\n\t\t\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t\t\tjob?.progress === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-job-note\",\n\t\t\t\t\t\t\t\t\t\t\t\tchildren: job.progress\n\t\t\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t\t\tjob?.detail === void 0 || job.detail.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-auto-job-detail\",\n\t\t\t\t\t\t\t\t\t\t\t\tchildren: job.detail.join(\" · \")\n\t\t\t\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t\t\t}, kind);\n\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t}) : null\n\t\t\t\t\t\t]\n\t\t\t\t\t}),\n\t\t\t\t\tflash === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-note\",\n\t\t\t\t\t\tchildren: flash\n\t\t\t\t\t}),\n\t\t\t\t\terror === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-error\",\n\t\t\t\t\t\tchildren: t?.(\"row.error\", { message: error }) ?? `Pool status unavailable: ${error}`\n\t\t\t\t\t}),\n\t\t\t\t\taccountCount === 0 && error === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-card dsm-workbuddy-xdpool-empty\",\n\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-empty-title\",\n\t\t\t\t\t\t\t\tchildren: t?.(\"row.regionEmptyTitle\", { region: regionLabel }) ?? t?.(\"row.regionEmpty\") ?? \"No account yet\"\n\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-empty-steps\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-empty-steps-title\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.regionHowToTitle\", { region: regionLabel }) ?? `How to sign in to the ${regionLabel} version`\n\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"ol\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-empty-list\",\n\t\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"li\", { children: t?.(\"row.regionHowTo1\") ?? \"\" }),\n\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"li\", { children: t?.(\"row.regionHowTo2\") ?? \"\" }),\n\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"li\", { children: t?.(\"row.regionHowTo3\") ?? \"\" }),\n\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"li\", { children: t?.(\"row.regionHowTo4\") ?? \"\" })\n\t\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-empty-note\",\n\t\t\t\t\t\t\t\tchildren: t?.(\"row.regionHowToNote\") ?? \"\"\n\t\t\t\t\t\t\t})\n\t\t\t\t\t\t]\n\t\t\t\t\t}) : null,\n\t\t\t\t\taccountCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-card dsm-workbuddy-xdpool-accounts\",\n\t\t\t\t\t\t\"aria-label\": t?.(\"row.accountsTitle\") ?? \"Accounts\",\n\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-accounts-head\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"h3\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-accounts-title\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.accountsTitle\") ?? \"Accounts in the pool\"\n\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-accounts-summary\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.accountsSummary\", {\n\t\t\t\t\t\t\t\t\t\tcount: accountCount,\n\t\t\t\t\t\t\t\t\t\tcooling\n\t\t\t\t\t\t\t\t\t}) ?? `${accountCount} account(s) · ${cooling} cooling`\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t(() => {\n\t\t\t\t\t\t\t\tconst active = status?.activeAccountId === void 0 ? void 0 : status.accounts.find((account) => account.id === status.activeAccountId);\n\t\t\t\t\t\t\t\tif (active === void 0) return null;\n\t\t\t\t\t\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-current\",\n\t\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", { className: \"dsm-workbuddy-xdpool-current-dot\" }),\n\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-current-label\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.currentAccount\") ?? \"In use now\"\n\t\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-current-name\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: active.label\n\t\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t\tactive.disabled === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-current-note\",\n\t\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.currentAccountDisabled\") ?? \"disabled — will switch on the next request\"\n\t\t\t\t\t\t\t\t\t\t}) : null\n\t\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t\t});\n\t\t\t\t\t\t\t})(),\n\t\t\t\t\t\t\tstatus?.accounts.map((account) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountBlock, {\n\t\t\t\t\t\t\t\taccount,\n\t\t\t\t\t\t\t\t...checkinBusyId === void 0 ? {} : { checkinBusyId },\n\t\t\t\t\t\t\t\tonClaimCheckin: (accountId) => {\n\t\t\t\t\t\t\t\t\tclaimCheckin(accountId);\n\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\tonSaveCreditReserve: (accountId, reserve) => saveCreditReserve(accountId, reserve),\n\t\t\t\t\t\t\t\tonToggleDisabled: (accountId, disabled) => {\n\t\t\t\t\t\t\t\t\ttoggleAccountDisabled(accountId, disabled);\n\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\tonIgnoreAccount: (accountId) => {\n\t\t\t\t\t\t\t\t\tsetAccountIgnored(accountId, true);\n\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t...accountBusyId === void 0 ? {} : { accountBusyId },\n\t\t\t\t\t\t\t\tt\n\t\t\t\t\t\t\t}, account.id))\n\t\t\t\t\t\t]\n\t\t\t\t\t}) : null,\n\t\t\t\t\t(status?.ignored.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-card dsm-workbuddy-xdpool-ignored\",\n\t\t\t\t\t\t\"aria-label\": t?.(\"row.ignoredTitle\") ?? \"Removed accounts\",\n\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-ignored-head\",\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"h3\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-ignored-title\",\n\t\t\t\t\t\t\t\tchildren: t?.(\"row.ignoredTitle\") ?? \"Removed accounts\"\n\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-ignored-summary\",\n\t\t\t\t\t\t\t\tchildren: t?.(\"row.ignoredSummary\", { count: status?.ignored.length ?? 0 }) ?? `${status?.ignored.length ?? 0} account(s) no longer in the pool`\n\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-ignored-list\",\n\t\t\t\t\t\t\tchildren: (status?.ignored ?? []).map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-ignored-row\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-ignored-label\",\n\t\t\t\t\t\t\t\t\tchildren: entry.label\n\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-ignored-restore\",\n\t\t\t\t\t\t\t\t\ttitle: t?.(\"row.ignoredRestoreHint\") ?? \"Put this account back into the pool\",\n\t\t\t\t\t\t\t\t\tdisabled: accountBusyId === entry.id,\n\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\tsetAccountIgnored(entry.id, false);\n\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.ignoredRestore\") ?? \"Restore\"\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t}, entry.id))\n\t\t\t\t\t\t})]\n\t\t\t\t\t}) : null,\n\t\t\t\t\t(status?.models.length ?? 0) > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-card dsm-workbuddy-xdpool-models\",\n\t\t\t\t\t\t\"aria-label\": t?.(\"row.modelsTitle\") ?? \"Models\",\n\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-models-head\",\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-models-heading\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"h3\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-models-title\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.modelsTitle\") ?? \"Models\"\n\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"p\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-models-summary\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.modelsEnabledCount\", {\n\t\t\t\t\t\t\t\t\t\tenabled: enabledCount,\n\t\t\t\t\t\t\t\t\t\ttotal: status?.models.length ?? 0\n\t\t\t\t\t\t\t\t\t}) ?? `${enabledCount} / ${status?.models.length ?? 0} enabled`\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-models-actions\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-btn dsm-btn-outline\",\n\t\t\t\t\t\t\t\t\tdisabled: !modelsDirty || savingModels,\n\t\t\t\t\t\t\t\t\tonClick: discardModels,\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.modelsDiscard\") ?? \"Discard\"\n\t\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-btn dsm-btn-primary\",\n\t\t\t\t\t\t\t\t\tdisabled: !modelsDirty || savingModels || enabledCount === 0,\n\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\tsaveModels();\n\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\tchildren: savingModels ? t?.(\"row.modelsSaving\") ?? \"Saving…\" : t?.(\"row.modelsSave\") ?? \"Save\"\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-list\",\n\t\t\t\t\t\t\tchildren: status?.models.map((model) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelRow, {\n\t\t\t\t\t\t\t\tmodel,\n\t\t\t\t\t\t\t\tt,\n\t\t\t\t\t\t\t\tdraft: modelDraft[model.id] ?? {\n\t\t\t\t\t\t\t\t\tenabled: model.enabled,\n\t\t\t\t\t\t\t\t\timages: model.supportsImages\n\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\teditable: modelsEditable,\n\t\t\t\t\t\t\t\tonToggle: toggleModel,\n\t\t\t\t\t\t\t\tonToggleImage: toggleModelImage,\n\t\t\t\t\t\t\t\tonBudget: setModelBudget\n\t\t\t\t\t\t\t}, model.id))\n\t\t\t\t\t\t})]\n\t\t\t\t\t}) : null\n\t\t\t\t]\n\t\t\t});\n\t\t}\n\t\t/** One account block: label + status tag + meta + optional credit panels. */\n\t\tfunction AccountBlock({ account, t, checkinBusyId, onClaimCheckin, accountBusyId, onToggleDisabled, onIgnoreAccount, onSaveCreditReserve, reserveBusyId }) {\n\t\t\tconst isDisabled = account.disabled === true;\n\t\t\tconst isCooling = account.cooling === true;\n\t\t\tconst cooldownUntil = account.cooldownUntil !== void 0 ? Date.parse(account.cooldownUntil) : void 0;\n\t\t\tconst modelCooldowns = account.modelCooldowns ?? [];\n\t\t\tconst tag = isCooling ? {\n\t\t\t\ttext: t?.(\"row.cooling\") ?? \"Cooling\",\n\t\t\t\tcls: \"dsm-workbuddy-xdpool-account-tag dsm-workbuddy-xdpool-account-tag-cooling\"\n\t\t\t} : null;\n\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\tclassName: isDisabled ? \"dsm-workbuddy-xdpool-account dsm-workbuddy-xdpool-account-off\" : \"dsm-workbuddy-xdpool-account\",\n\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-head\",\n\t\t\t\t\tchildren: [\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-label\",\n\t\t\t\t\t\t\tchildren: account.label\n\t\t\t\t\t\t}),\n\t\t\t\t\t\ttag === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: tag.cls,\n\t\t\t\t\t\t\tchildren: tag.text\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"button\", {\n\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\trole: \"switch\",\n\t\t\t\t\t\t\t\"aria-checked\": !isDisabled,\n\t\t\t\t\t\t\tclassName: isDisabled ? \"dsm-workbuddy-xdpool-account-toggle\" : \"dsm-workbuddy-xdpool-account-toggle dsm-workbuddy-xdpool-account-toggle-on\",\n\t\t\t\t\t\t\ttitle: t?.(\"row.accountToggleHint\") ?? \"Enable this account (uncheck to keep it out of the pool)\",\n\t\t\t\t\t\t\tdisabled: accountBusyId === account.id,\n\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\tonToggleDisabled(account.id, !isDisabled);\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", { className: \"dsm-workbuddy-xdpool-account-toggle-dot\" }), isDisabled ? t?.(\"row.accountOff\") ?? \"Disabled\" : t?.(\"row.accountInRotation\") ?? \"Enabled\"]\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-ignore\",\n\t\t\t\t\t\t\ttitle: t?.(\"row.accountIgnoreHint\") ?? \"Remove this account from the pool for good\",\n\t\t\t\t\t\t\tdisabled: accountBusyId === account.id,\n\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\tonIgnoreAccount(account.id);\n\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\tchildren: t?.(\"row.accountIgnore\") ?? \"Remove\"\n\t\t\t\t\t\t})\n\t\t\t\t\t]\n\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-body\",\n\t\t\t\t\tchildren: [\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-copy\",\n\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\taccount.expiresAt !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-meta\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.tokenExpiry\", { time: formatDateTime(account.expiresAt) }) ?? `token ${formatDateTime(account.expiresAt)}`\n\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\tisCooling && cooldownUntil !== void 0 && !Number.isNaN(cooldownUntil) ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"span\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-meta\",\n\t\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\t\tt?.(\"row.cooldownUntil\", { time: formatTime(cooldownUntil) }) ?? `until ${formatTime(cooldownUntil)}`,\n\t\t\t\t\t\t\t\t\t\t\" · \",\n\t\t\t\t\t\t\t\t\t\tt?.(\"row.cooldownHits\", { hits: account.rateLimitHits ?? 0 }) ?? `${account.rateLimitHits ?? 0} hit(s)`\n\t\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\tmodelCooldowns.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-modelcool\",\n\t\t\t\t\t\t\t\t\tchildren: modelCooldowns.map((mc) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-account-modelcool-chip\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.modelCooling\", {\n\t\t\t\t\t\t\t\t\t\t\tmodel: mc.modelId,\n\t\t\t\t\t\t\t\t\t\t\ttime: formatDateTime(mc.until)\n\t\t\t\t\t\t\t\t\t\t}) ?? `${mc.modelId} cooling to ${formatDateTime(mc.until)}`\n\t\t\t\t\t\t\t\t\t}, mc.modelId))\n\t\t\t\t\t\t\t\t}) : null\n\t\t\t\t\t\t\t]\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(AccountStats, {\n\t\t\t\t\t\t\taccount,\n\t\t\t\t\t\t\tt,\n\t\t\t\t\t\t\tcheckinBusy: checkinBusyId === account.id,\n\t\t\t\t\t\t\tonClaim: onClaimCheckin\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(CreditReserveRow, {\n\t\t\t\t\t\t\taccount,\n\t\t\t\t\t\t\tt,\n\t\t\t\t\t\t\tbusy: reserveBusyId === account.id,\n\t\t\t\t\t\t\tonSave: onSaveCreditReserve\n\t\t\t\t\t\t}),\n\t\t\t\t\t\taccount.automationToday === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-earned\",\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-earned-label\",\n\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoEarned\") ?? \"Automation today\"\n\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"span\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-earned-list\",\n\t\t\t\t\t\t\t\tchildren: [\n\t\t\t\t\t\t\t\t\taccount.automationToday.credit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-earned-row\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoFromTasks\", {\n\t\t\t\t\t\t\t\t\t\t\tcredit: account.automationToday.credit,\n\t\t\t\t\t\t\t\t\t\t\tenergy: account.automationToday.energy,\n\t\t\t\t\t\t\t\t\t\t\tcount: account.automationToday.claimed\n\t\t\t\t\t\t\t\t\t\t}) ?? `Tasks +${account.automationToday.credit}`\n\t\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t\taccount.automationToday.checkinCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-earned-row\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoFromCheckin\", { credit: account.automationToday.checkinCredit }) ?? `Check-in +${account.automationToday.checkinCredit}`\n\t\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t\taccount.automationToday.bonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-earned-row\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoFromBonus\", { credit: account.automationToday.bonusCredit }) ?? `Streak +${account.automationToday.bonusCredit}`\n\t\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t\taccount.automationToday.travelCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-earned-row\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.autoFromTravel\", { credit: account.automationToday.travelCredit }) ?? `Buddy +${account.automationToday.travelCredit}`\n\t\t\t\t\t\t\t\t\t}) : null\n\t\t\t\t\t\t\t\t]\n\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t})\n\t\t\t\t\t]\n\t\t\t\t})]\n\t\t\t});\n\t\t}\n\t\t/**\n\t\t* Daily check-in block: streak summary plus one claim button for this account.\n\t\t* Every account in the pool gets its own button, so a multi-account user can\n\t\t* collect each reward without switching the pool's preferred account first.\n\t\t*/\n\t\t/**\n\t\t* Credit panels: package breakdown on the left, the big total on the right with\n\t\t* the daily check-in action docked beneath it. Mirrors the two-column credit\n\t\t* layout the LaoDing plugin family uses, so the numbers stay scannable and the\n\t\t* claim button sits where the eye already is.\n\t\t*/\n\t\t/**\n\t\t* Reserved-credit control for one account.\n\t\t*\n\t\t* The value is committed on blur or Enter rather than on every keystroke:\n\t\t* each save is a settings write plus a status refresh, and a per-character\n\t\t* save would hammer both.\n\t\t*/\n\t\t/**\n\t\t* The reserved-credit floor for one account.\n\t\t*\n\t\t* Saving is an EXPLICIT action, not a blur side effect. The old version\n\t\t* committed `onBlur`, which meant a value could be written without the user\n\t\t* asking for it — and when the write silently failed, the only trace was a\n\t\t* notice line at the top of the card that is easy to miss. That is how\n\t\t* \"I typed a number, reopened, and it says 0 again\" happened with no visible\n\t\t* error to explain it.\n\t\t*\n\t\t* Now: the field is a draft, Save is enabled only when the draft differs from\n\t\t* what the host last reported, and the outcome (saving / saved / failed) is\n\t\t* shown inline next to the button. Enter also saves, so keyboard flow is not\n\t\t* lost.\n\t\t*/\n\t\tfunction CreditReserveRow({ account, t, busy, onSave }) {\n\t\t\tconst saved = account.creditReserve ?? 0;\n\t\t\tconst [draft, setDraft] = (0, react.useState)(String(saved));\n\t\t\tconst [settled, setSettled] = (0, react.useState)(saved);\n\t\t\tconst [note, setNote] = (0, react.useState)(void 0);\n\t\t\t(0, react.useEffect)(() => {\n\t\t\t\tsetSettled(saved);\n\t\t\t\tsetDraft((current) => current === String(saved) ? current : String(saved));\n\t\t\t}, [saved]);\n\t\t\tconst parsed = Number.parseInt(draft, 10);\n\t\t\tconst next = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;\n\t\t\tconst dirty = next !== settled;\n\t\t\tconst commit = async () => {\n\t\t\t\tif (busy || !dirty) return;\n\t\t\t\tsetNote(void 0);\n\t\t\t\tif (await onSave(account.id, next)) {\n\t\t\t\t\tsetSettled(next);\n\t\t\t\t\tsetDraft(String(next));\n\t\t\t\t\tsetNote(\"saved\");\n\t\t\t\t} else setNote(\"failed\");\n\t\t\t};\n\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\tclassName: \"dsm-workbuddy-xdpool-reserve\",\n\t\t\t\tchildren: [\n\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-reserve-label\",\n\t\t\t\t\t\tchildren: t?.(\"row.reserveTitle\") ?? \"Keep at least\"\n\t\t\t\t\t}),\n\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"input\", {\n\t\t\t\t\t\ttype: \"number\",\n\t\t\t\t\t\tmin: 0,\n\t\t\t\t\t\tstep: 1,\n\t\t\t\t\t\tvalue: draft,\n\t\t\t\t\t\tdisabled: busy,\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-reserve-input\",\n\t\t\t\t\t\t\"aria-label\": t?.(\"row.reserveTitle\") ?? \"Keep at least\",\n\t\t\t\t\t\tonChange: (event) => {\n\t\t\t\t\t\t\tsetDraft(event.target.value);\n\t\t\t\t\t\t\tsetNote(void 0);\n\t\t\t\t\t\t},\n\t\t\t\t\t\tonKeyDown: (event) => {\n\t\t\t\t\t\t\tif (event.key === \"Enter\") commit();\n\t\t\t\t\t\t}\n\t\t\t\t\t}),\n\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-reserve-unit\",\n\t\t\t\t\t\tchildren: t?.(\"row.reserveUnit\") ?? \"credits\"\n\t\t\t\t\t}),\n\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-reserve-save\",\n\t\t\t\t\t\tdisabled: busy || !dirty,\n\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\tcommit();\n\t\t\t\t\t\t},\n\t\t\t\t\t\tchildren: busy ? t?.(\"row.reserveSaving\") ?? \"Saving…\" : t?.(\"row.reserveSave\") ?? \"Save\"\n\t\t\t\t\t}),\n\t\t\t\t\tnote === \"saved\" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-reserve-note dsm-workbuddy-xdpool-reserve-note-ok\",\n\t\t\t\t\t\tchildren: next > 0 ? t?.(\"row.reserveSaved\", { credits: next }) ?? `Keeping ${next} credits` : t?.(\"row.reserveCleared\") ?? \"Reserve cleared\"\n\t\t\t\t\t}) : null,\n\t\t\t\t\tnote === \"failed\" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-reserve-note dsm-workbuddy-xdpool-reserve-note-bad\",\n\t\t\t\t\t\tchildren: t?.(\"row.reserveFailed\") ?? \"Not saved — try again\"\n\t\t\t\t\t}) : null,\n\t\t\t\t\taccount.reserved === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-reserve-badge\",\n\t\t\t\t\t\tchildren: t?.(\"row.reserveHolding\") ?? \"Reserved: skipped\"\n\t\t\t\t\t}) : null\n\t\t\t\t]\n\t\t\t});\n\t\t}\n\t\tfunction AccountStats({ account, t, checkinBusy, onClaim }) {\n\t\t\tconst credits = account.credits;\n\t\t\tconst checkin = account.checkin;\n\t\t\tconst hasCredits = credits !== void 0 || account.creditsError !== void 0;\n\t\t\tconst hasCheckin = checkin !== void 0 || account.checkinError !== void 0;\n\t\t\tif (!hasCredits && !hasCheckin) return null;\n\t\t\tconst packages = (credits?.packages ?? []).filter((p) => (p.size ?? 0) > 0).slice(0, 6);\n\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\tclassName: \"dsm-workbuddy-xdpool-stats\",\n\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-panel dsm-workbuddy-xdpool-panel-packages\",\n\t\t\t\t\tchildren: [\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-panel-title\",\n\t\t\t\t\t\t\tchildren: t?.(\"row.creditsPackages\") ?? \"Credit packages\"\n\t\t\t\t\t\t}),\n\t\t\t\t\t\taccount.creditsError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-panel-error\",\n\t\t\t\t\t\t\tchildren: account.creditsError\n\t\t\t\t\t\t}) : packages.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-panel-empty\",\n\t\t\t\t\t\t\tchildren: \"–\"\n\t\t\t\t\t\t}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"ul\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-packages\",\n\t\t\t\t\t\t\tchildren: packages.map((pack, index) => {\n\t\t\t\t\t\t\t\tconst expiry = formatExpiry(pack.expiresAtMs);\n\t\t\t\t\t\t\t\tconst refresh = formatExpiry(pack.cycleRefreshMs);\n\t\t\t\t\t\t\t\tconst soon = isExpiringSoon(pack);\n\t\t\t\t\t\t\t\tconst when = pack.monthly === true ? refresh === \"\" ? null : t?.(\"row.creditsRefreshAt\", { time: refresh }) ?? `Refreshes ${refresh}` : expiry === \"\" ? null : t?.(\"row.creditsExpiresAt\", { time: expiry }) ?? `Expires ${expiry}`;\n\t\t\t\t\t\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"li\", { children: [\n\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-packages-name\",\n\t\t\t\t\t\t\t\t\t\tchildren: pack.packageName\n\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-packages-value\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.creditsPackage\", {\n\t\t\t\t\t\t\t\t\t\t\tremain: formatNumber(pack.remain),\n\t\t\t\t\t\t\t\t\t\t\tsize: formatNumber(pack.size)\n\t\t\t\t\t\t\t\t\t\t}) ?? `${formatNumber(pack.remain)} / ${formatNumber(pack.size)}`\n\t\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\t\twhen === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: `dsm-workbuddy-xdpool-packages-when${soon ? \" dsm-workbuddy-xdpool-packages-when-soon\" : \"\"}`,\n\t\t\t\t\t\t\t\t\t\ttitle: t?.(\"row.creditsExpiresSoonTitle\") ?? \"Expiring within 3 days\",\n\t\t\t\t\t\t\t\t\t\tchildren: when\n\t\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t\t] }, `${pack.packageName}-${String(index)}`);\n\t\t\t\t\t\t\t})\n\t\t\t\t\t\t}),\n\t\t\t\t\t\tcredits?.expiringSoon !== void 0 && credits.expiringSoon > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-panel-foot\",\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", { children: t?.(\"row.creditsSoon\") ?? \"Expiring in 3 days\" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"strong\", { children: formatNumber(credits.expiringSoon) })]\n\t\t\t\t\t\t}) : null\n\t\t\t\t\t]\n\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"section\", {\n\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-panel dsm-workbuddy-xdpool-panel-total\",\n\t\t\t\t\tchildren: [\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-panel-title\",\n\t\t\t\t\t\t\tchildren: t?.(\"row.creditsTotal\") ?? \"Total\"\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-total-value\",\n\t\t\t\t\t\t\tchildren: formatNumber(credits?.total)\n\t\t\t\t\t\t}),\n\t\t\t\t\t\thasCheckin ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"div\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-checkin\",\n\t\t\t\t\t\t\tchildren: account.checkinError !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-checkin-error\",\n\t\t\t\t\t\t\t\tchildren: account.checkinError\n\t\t\t\t\t\t\t}) : checkin === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [\n\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-checkin-meta\",\n\t\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-checkin-streak\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.checkinStreak\", { days: checkin.streakDays }) ?? `${checkin.streakDays}-day streak`\n\t\t\t\t\t\t\t\t\t}), checkin.dailyCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-checkin-daily\",\n\t\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.checkinDaily\", { credit: formatNumber(checkin.dailyCredit) }) ?? `+${formatNumber(checkin.dailyCredit)}/day`\n\t\t\t\t\t\t\t\t\t}) : null]\n\t\t\t\t\t\t\t\t}),\n\t\t\t\t\t\t\t\tcheckin.isStreakDay && checkin.streakBonusCredit > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-checkin-bonus\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.checkinStreakBonus\", {\n\t\t\t\t\t\t\t\t\t\tdays: formatNumber(checkin.nextStreakDay),\n\t\t\t\t\t\t\t\t\t\tcredit: formatNumber(checkin.streakBonusCredit)\n\t\t\t\t\t\t\t\t\t}) ?? `bonus +${formatNumber(checkin.streakBonusCredit)}`\n\t\t\t\t\t\t\t\t}) : null,\n\t\t\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"button\", {\n\t\t\t\t\t\t\t\t\ttype: \"button\",\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-checkin-btn\",\n\t\t\t\t\t\t\t\t\tdisabled: !checkin.active || checkin.todayCheckedIn || checkinBusy,\n\t\t\t\t\t\t\t\t\tonClick: () => {\n\t\t\t\t\t\t\t\t\t\tonClaim(account.id);\n\t\t\t\t\t\t\t\t\t},\n\t\t\t\t\t\t\t\t\tchildren: !checkin.active ? t?.(\"row.checkinInactive\") ?? \"Unavailable\" : checkin.todayCheckedIn ? t?.(\"row.checkinClaimed\") ?? \"Checked in\" : checkinBusy ? t?.(\"row.checkinClaiming\") ?? \"Checking in…\" : t?.(\"row.checkinClaim\") ?? \"Check in\"\n\t\t\t\t\t\t\t\t})\n\t\t\t\t\t\t\t] })\n\t\t\t\t\t\t}) : null\n\t\t\t\t\t]\n\t\t\t\t})]\n\t\t\t});\n\t\t}\n\t\t/**\n\t\t* One model row.\n\t\t*\n\t\t* Read-only when the card has no writable settings scope: the checkbox and the\n\t\t* context radios stay disabled rather than pretending an edit took hold. The\n\t\t* draft lives in the parent, so this component only ever reports intent.\n\t\t*/\n\t\tfunction ModelRow({ model, t, draft, editable, onToggle, onToggleImage, onBudget }) {\n\t\t\tconst tag = tagFor(model);\n\t\t\tconst tagText = tag === \"free\" ? t?.(\"row.free\") ?? \"free\" : tag === \"limited\" ? t?.(\"row.limitedFree\") ?? \"limited free\" : tag === \"night\" ? t?.(\"row.nightDiscount\") ?? \"night\" : null;\n\t\t\tconst native = model.nativeContextWindow;\n\t\t\tconst capped = native > DEFAULT_CONTEXT_BUDGET;\n\t\t\tconst currentBudget = draft.budget ?? native;\n\t\t\treturn /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\tclassName: `dsm-workbuddy-xdpool-model${draft.enabled ? \"\" : \" dsm-workbuddy-xdpool-model-off\"}`,\n\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-head\",\n\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"label\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-check\",\n\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"input\", {\n\t\t\t\t\t\t\ttype: \"checkbox\",\n\t\t\t\t\t\t\tchecked: draft.enabled,\n\t\t\t\t\t\t\tdisabled: !editable,\n\t\t\t\t\t\t\tonChange: () => {\n\t\t\t\t\t\t\t\tonToggle(model.id);\n\t\t\t\t\t\t\t}\n\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-copy\",\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"span\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-name\",\n\t\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", { children: model.name }), model.multiplier === void 0 || model.multiplier === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-name-rate\",\n\t\t\t\t\t\t\t\t\tchildren: t?.(\"row.rate\", { rate: model.multiplier.toFixed(2) }) ?? `${model.multiplier.toFixed(2)}x`\n\t\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-id\",\n\t\t\t\t\t\t\t\tchildren: model.id\n\t\t\t\t\t\t\t})]\n\t\t\t\t\t\t})]\n\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-controls\",\n\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"label\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-image\",\n\t\t\t\t\t\t\ttitle: t?.(\"row.modelImage\") ?? \"Image input\",\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"input\", {\n\t\t\t\t\t\t\t\ttype: \"checkbox\",\n\t\t\t\t\t\t\t\tchecked: draft.images,\n\t\t\t\t\t\t\t\tdisabled: !editable,\n\t\t\t\t\t\t\t\tonChange: () => {\n\t\t\t\t\t\t\t\t\tonToggleImage(model.id);\n\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", { children: t?.(\"row.modelImage\") ?? \"Image\" })]\n\t\t\t\t\t\t}), capped ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"fieldset\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-budget\",\n\t\t\t\t\t\t\t\"aria-label\": t?.(\"row.modelContextBudget\") ?? \"Context\",\n\t\t\t\t\t\t\tchildren: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"label\", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"input\", {\n\t\t\t\t\t\t\t\ttype: \"radio\",\n\t\t\t\t\t\t\t\tname: `budget-${model.id}`,\n\t\t\t\t\t\t\t\tchecked: currentBudget === DEFAULT_CONTEXT_BUDGET,\n\t\t\t\t\t\t\t\tdisabled: !editable,\n\t\t\t\t\t\t\t\tonChange: () => {\n\t\t\t\t\t\t\t\t\tonBudget(model.id, DEFAULT_CONTEXT_BUDGET);\n\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", { children: formatCapacity(DEFAULT_CONTEXT_BUDGET) })] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"label\", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"input\", {\n\t\t\t\t\t\t\t\ttype: \"radio\",\n\t\t\t\t\t\t\t\tname: `budget-${model.id}`,\n\t\t\t\t\t\t\t\tchecked: currentBudget === native,\n\t\t\t\t\t\t\t\tdisabled: !editable,\n\t\t\t\t\t\t\t\tonChange: () => {\n\t\t\t\t\t\t\t\t\tonBudget(model.id, native);\n\t\t\t\t\t\t\t\t}\n\t\t\t\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", { children: formatCapacity(native) })] })]\n\t\t\t\t\t\t}) : null]\n\t\t\t\t\t})]\n\t\t\t\t}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(\"div\", {\n\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-meta\",\n\t\t\t\t\tchildren: [\n\t\t\t\t\t\ttagText === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-meta-tag\",\n\t\t\t\t\t\t\tchildren: tagText\n\t\t\t\t\t\t}),\n\t\t\t\t\t\t/* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-cap\",\n\t\t\t\t\t\t\tchildren: t?.(\"row.modelOutput\", { size: formatCapacity(model.maxOutputTokens) }) ?? `out ${formatCapacity(model.maxOutputTokens)}`\n\t\t\t\t\t\t}),\n\t\t\t\t\t\tmodel.supportedEfforts === void 0 || model.supportedEfforts.length === 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(\"span\", {\n\t\t\t\t\t\t\tclassName: \"dsm-workbuddy-xdpool-model-cap\",\n\t\t\t\t\t\t\tchildren: t?.(\"row.modelReasoning\", { efforts: model.supportedEfforts.join(\" / \") }) ?? model.supportedEfforts.join(\" / \")\n\t\t\t\t\t\t})\n\t\t\t\t\t]\n\t\t\t\t})]\n\t\t\t});\n\t\t}\n\t\t//#endregion\n\t\t//#region src/client/nav-icon.ts\n\t\t/**\n\t\t* Nav glyph for the WorkBuddy XD Pool settings page.\n\t\t*\n\t\t* The host's settings shell draws its own 16px `svg` in every nav row and the\n\t\t* `settings.section` registration contract projects only `id` / `order` /\n\t\t* `label` — there is no `icon` field to pass. A third-party page therefore has\n\t\t* to mark its row in the DOM and mask this artwork over the shell's glyph, the\n\t\t* same technique `dshmarket` uses (`installSettingsNavIcon`).\n\t\t*\n\t\t* Kept as a single monochrome path so `mask-image` + `currentColor` can tint it\n\t\t* with whatever the active theme uses for nav text: a filled mask cannot carry\n\t\t* its own palette, and a two-tone icon would render as a flat silhouette.\n\t\t*\n\t\t* @module dsh-workbuddy-xdpool/client/nav-icon\n\t\t*/\n\t\t/**\n\t\t* The nav mark: a stack of three rounded \"accounts\" under a rotation arc.\n\t\t*\n\t\t* Reads as \"a pool of accounts being cycled\" at 16px, and — unlike a literal\n\t\t* droplet or cloud — stays legible when reduced to a single-color silhouette.\n\t\t* `fill-rule=\"evenodd\"` cuts the interior notches out of the silhouette so the\n\t\t* three layers stay distinguishable at that size.\n\t\t*/\n\t\tconst POOL_NAV_ICON_SVG = [\n\t\t\t\"<svg xmlns=\\\"http://www.w3.org/2000/svg\\\" viewBox=\\\"0 0 24 24\\\" width=\\\"16\\\" height=\\\"16\\\">\",\n\t\t\t\"<path fill=\\\"currentColor\\\" fill-rule=\\\"evenodd\\\" d=\\\"\",\n\t\t\t\"M12 2.6a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 0 1 0-6.2Zm0 1.7a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Z\",\n\t\t\t\"M6.6 8.9a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm0 1.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z\",\n\t\t\t\"M17.4 8.9a2.6 2.6 0 1 1 0 5.2 2.6 2.6 0 0 1 0-5.2Zm0 1.6a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z\",\n\t\t\t\"\\\"/>\",\n\t\t\t\"<path fill=\\\"none\\\" stroke=\\\"currentColor\\\" stroke-width=\\\"1.7\\\" stroke-linecap=\\\"round\\\"\",\n\t\t\t\" d=\\\"M4.4 17.2a8.6 8.6 0 0 0 15.2 0\\\" stroke-dasharray=\\\"2.6 2.2\\\"/>\",\n\t\t\t\"</svg>\"\n\t\t].join(\"\");\n\t\t/**\n\t\t* The same artwork as a `mask-image` URL.\n\t\t*\n\t\t* `encodeURIComponent` keeps the `#`-free markup safe inside a `url(\"…\")` in a\n\t\t* stylesheet, and `currentColor` is resolved by the mask's own element rather\n\t\t* than by the SVG, so the glyph follows the theme.\n\t\t*/\n\t\tconst POOL_NAV_ICON_MASK_URL = `data:image/svg+xml;utf8,${encodeURIComponent(POOL_NAV_ICON_SVG)}`;\n\t\t//#endregion\n\t\t//#region src/client/locales.ts\n\t\t/**\n\t\t* Plugin-card copy registered under the `settings.workbuddy-xdpool` locale\n\t\t* namespace. Key lists in `en` and `zh` are kept 1:1 by typing `zh` against\n\t\t* the key set of `en`.\n\t\t*\n\t\t* @module dsh-workbuddy-xdpool/client/locales\n\t\t*/\n\t\tconst en = {\n\t\t\t\"row.navLabel\": \"XD Pool\",\n\t\t\t\"row.title\": \"WorkBuddy XD Pool (dsh-workbuddy-xdpool)\",\n\t\t\t\"row.desc\": \"Route every WorkBuddy sign-in on this machine into DSH as one auto-failing-over model pool.\",\n\t\t\t\"row.expand\": \"Expand\",\n\t\t\t\"row.collapse\": \"Collapse\",\n\t\t\t\"row.requestFailed\": \"Request failed\",\n\t\t\t\"row.poolEmpty\": \"No WorkBuddy account discovered yet.\",\n\t\t\t\"row.poolEmptyHint\": \"Sign in to one or more WorkBuddy accounts in the WorkBuddy desktop app, then click “Detect accounts again”. Each sign-in is picked up automatically as a pool member.\",\n\t\t\t\"row.regionEmpty\": \"No account signed in for this region yet.\",\n\t\t\t\"row.regionEmptyHint\": \"Sign in to a WorkBuddy account for this region in the desktop app, then choose “Detect accounts again”. Domestic and international accounts can be signed in side by side.\",\n\t\t\t\"row.regionEmptyTitle\": \"No {region} account is signed in yet.\",\n\t\t\t\"row.regionHowToTitle\": \"How to sign in to the {region} version\",\n\t\t\t\"row.regionHowTo1\": \"Download and install the {region} client: the international build is named WorkBuddy AI while the domestic one is WorkBuddy, and they are different apps. The web version at https://www.workbuddy.ai/ also works.\",\n\t\t\t\"row.regionHowTo2\": \"Pick a sign-in method: email sign-up / sign-in (most common), OAuth with Google, GitHub or X, or WeChat QR scan on some builds.\",\n\t\t\t\"row.regionHowTo3\": \"Make sure this machine can reach overseas sites when signing in: the international version targets users outside mainland China and may fail to load behind a restricted network.\",\n\t\t\t\"row.regionHowTo4\": \"Back here, press the re-detect button. Every sign-in the client has left on this machine is absorbed into its own region - the two sides stay separate and can run at the same time.\",\n\t\t\t\"row.regionHowToNote\": \"The two versions keep separate accounts, credits and data: a domestic account cannot sign in to the international one, and vice versa, so each needs its own registration. This plugin only reads the sign-ins the client has already performed.\",\n\t\t\t\"row.shimStopped\": \"Provider loopback is not running.\",\n\t\t\t\"row.shimRunning\": \"Provider listening on loopback\",\n\t\t\t\"row.accountsTitle\": \"Accounts in the pool\",\n\t\t\t\"row.tabCn\": \"国内版\",\n\t\t\t\"row.tabGlobal\": \"国际版\",\n\t\t\t\"row.tabHint\": \"每个 tab 是一个独立供应商，各有自己的账号、积分与模型；两边同时生效，一侧的改动不影响另一侧。\",\n\t\t\t\"row.accountsSummary\": \"{count} account(s) · {cooling} cooling\",\n\t\t\t\"row.ok\": \"Healthy — requests auto-rotate across accounts\",\n\t\t\t\"row.allCooling\": \"Every account is rate-limited right now; requests pause until a cooldown lifts.\",\n\t\t\t\"row.accountInRotation\": \"Enabled\",\n\t\t\t\"row.accountOff\": \"Disabled\",\n\t\t\t\"row.accountToggleHint\": \"Enable this account (uncheck to keep it out of the pool)\",\n\t\t\t\"row.accountToggleError\": \"Could not switch the account: {message}\",\n\t\t\t\"row.accountIgnore\": \"Remove\",\n\t\t\t\"row.accountIgnoreHint\": \"Remove this account from the pool for good — its credential stops being read and it will not come back\",\n\t\t\t\"row.accountIgnoreError\": \"Could not change the ignore list: {message}\",\n\t\t\t\"row.ignoredTitle\": \"Removed accounts\",\n\t\t\t\"row.ignoredSummary\": \"{count} account(s) no longer in the pool\",\n\t\t\t\"row.ignoredRestore\": \"Restore\",\n\t\t\t\"row.ignoredRestoreHint\": \"Put this account back into the pool\",\n\t\t\t\"row.currentAccount\": \"In use now\",\n\t\t\t\"row.currentAccountDisabled\": \"switched off — the next request moves on\",\n\t\t\t\"row.cooling\": \"Cooling (rate-limited)\",\n\t\t\t\"row.cooldownHits\": \"{hits} hit(s)\",\n\t\t\t\"row.cooldownUntil\": \"until {time}\",\n\t\t\t\"row.modelCooling\": \"{model} cooling until {time}\",\n\t\t\t\"row.tokenExpiry\": \"token {time}\",\n\t\t\t\"row.creditsTotal\": \"Total\",\n\t\t\t\"row.creditsPackages\": \"Credit packages\",\n\t\t\t\"row.creditsPackage\": \"{remain} / {size}\",\n\t\t\t\"row.creditsError\": \"credits unavailable\",\n\t\t\t\"row.creditsSoon\": \"Expiring in 3 days\",\n\t\t\t\"row.creditsExpiresAt\": \"Expires {time}\",\n\t\t\t\"row.creditsExpiresSoonTitle\": \"Expiring within 3 days\",\n\t\t\t\"row.creditsRefreshAt\": \"Refreshes {time}\",\n\t\t\t\"row.checkinTitle\": \"Daily check-in\",\n\t\t\t\"row.checkinClaim\": \"Check in\",\n\t\t\t\"row.checkinClaiming\": \"Checking in…\",\n\t\t\t\"row.checkinClaimed\": \"Checked in today\",\n\t\t\t\"row.checkinInactive\": \"Check-in not available for this account\",\n\t\t\t\"row.checkinStreak\": \"{days}-day streak\",\n\t\t\t\"row.checkinDaily\": \"+{credit} credits/day\",\n\t\t\t\"row.checkinStreakBonus\": \"day {days} bonus +{credit}\",\n\t\t\t\"row.checkinClaimedReward\": \"Claimed +{credit} credits\",\n\t\t\t\"row.checkinError\": \"Check-in failed: {message}\",\n\t\t\t\"row.checkinAllHint\": \"Collect every account’s daily reward here — no need to switch accounts first.\",\n\t\t\t\"row.modelsTitle\": \"Models\",\n\t\t\t\"row.modelsSummary\": \"{count} model(s) in the live catalog\",\n\t\t\t\"row.modelsHint\": \"Read from the live WorkBuddy catalog. Free tiers are marked.\",\n\t\t\t\"row.modelEnabled\": \"Enabled\",\n\t\t\t\"row.modelImage\": \"Image input\",\n\t\t\t\"row.modelContextBudget\": \"Context window\",\n\t\t\t\"row.modelContextNative\": \"{size} (max)\",\n\t\t\t\"row.modelContextCapped\": \"{size}\",\n\t\t\t\"row.modelOutput\": \"Output {size}\",\n\t\t\t\"row.modelReasoning\": \"Thinking: {efforts}\",\n\t\t\t\"row.modelsEnabledCount\": \"{enabled} / {total} enabled\",\n\t\t\t\"row.modelsSave\": \"Save\",\n\t\t\t\"row.modelsSaving\": \"Saving…\",\n\t\t\t\"row.modelsDiscard\": \"Discard\",\n\t\t\t\"row.modelsSaved\": \"Model selection saved\",\n\t\t\t\"row.modelsSaveError\": \"Could not save: {message}\",\n\t\t\t\"row.modelsEmpty\": \"No model enabled — enable at least one before saving.\",\n\t\t\t\"row.free\": \"free\",\n\t\t\t\"row.limitedFree\": \"limited free\",\n\t\t\t\"row.nightDiscount\": \"night\",\n\t\t\t\"row.imageCapable\": \"image input\",\n\t\t\t\"row.rate\": \"{rate}x credits\",\n\t\t\t\"row.accountsRescan\": \"Detect accounts again\",\n\t\t\t\"row.accountsScanning\": \"Detecting…\",\n\t\t\t\"row.distTitle\": \"Account usage\",\n\t\t\t\"row.distPriority\": \"Priority\",\n\t\t\t\"row.distPriorityHint\": \"Use one account until it runs out, then move to the next\",\n\t\t\t\"row.distRoundRobin\": \"Round-robin\",\n\t\t\t\"row.distRoundRobinHint\": \"Take turns in order, spreading the spend evenly\",\n\t\t\t\"row.distBalanced\": \"Balanced\",\n\t\t\t\"row.distBalancedHint\": \"Draw at random, favouring the account idle longest\",\n\t\t\t\"row.resetCooldowns\": \"Clear all cooldowns\",\n\t\t\t\"row.resetCooldownsBusy\": \"Clearing…\",\n\t\t\t\"row.resetCooldownsDone\": \"Cooldowns cleared\",\n\t\t\t\"row.accountsRescanned\": \"Detected {count} account(s)\",\n\t\t\t\"row.error\": \"Pool status unavailable: {message}\",\n\t\t\t\"row.autoTitle\": \"Automation\",\n\t\t\t\"row.autoOn\": \"On\",\n\t\t\t\"row.autoOff\": \"Off\",\n\t\t\t\"row.autoBusy\": \"Saving…\",\n\t\t\t\"row.autoHintOn\": \"Checks in, reports activity, claims task and streak rewards, and runs the buddy trip — every day.\",\n\t\t\t\"row.autoHintOff\": \"Off: no background requests are made for you.\",\n\t\t\t\"row.autoJob_report\": \"Activity report\",\n\t\t\t\"row.autoJob_tasks\": \"Task rewards\",\n\t\t\t\"row.autoJob_checkin\": \"Daily check-in\",\n\t\t\t\"row.autoJob_streak\": \"Streak bonus\",\n\t\t\t\"row.autoJob_travel\": \"Buddy trip\",\n\t\t\t\"row.autoHourNone\": \"skipped today\",\n\t\t\t\"row.autoNever\": \"not run yet\",\n\t\t\t\"row.autoRun\": \"Run now\",\n\t\t\t\"row.autoRunning\": \"Running…\",\n\t\t\t\"row.autoRan\": \"Done: {count} account(s) ok, {failed} failed\",\n\t\t\t\"row.autoRanTasks\": \"Done: {claimed} task(s) claimed, +{credit} credits, +{energy} energy\",\n\t\t\t\"row.reserveTitle\": \"Keep at least\",\n\t\t\t\"row.reserveUnit\": \"credits\",\n\t\t\t\"row.reserveSaving\": \"Saving…\",\n\t\t\t\"row.reserveSave\": \"Save\",\n\t\t\t\"row.reserveHolding\": \"Reserved: skipped\",\n\t\t\t\"row.reserveSaved\": \"Keeping {credits} credits\",\n\t\t\t\"row.reserveCleared\": \"Reserve cleared\",\n\t\t\t\"row.reserveFailed\": \"Not saved — try again\",\n\t\t\t\"row.autoToday\": \"Today\",\n\t\t\t\"row.autoEarned\": \"Automation today\",\n\t\t\t\"row.autoEnergy\": \"energy\",\n\t\t\t\"row.autoTasksClaimed\": \"{count} task(s)\",\n\t\t\t\"row.autoRunAll\": \"Run now\",\n\t\t\t\"row.autoRunDone\": \"Automation pass finished\",\n\t\t\t\"row.autoRunTimeout\": \"Still running; check back in a moment\",\n\t\t\t\"row.autoAlreadyRunning\": \"A run is already in progress\",\n\t\t\t\"row.autoRanAll\": \"Ran {jobs} job(s), {ok} ok, {failed} failed\",\n\t\t\t\"row.autoFromTasks\": \"Tasks +{credit} credits · +{energy} energy · {count} task(s)\",\n\t\t\t\"row.autoFromCheckin\": \"Check-in +{credit} credits\",\n\t\t\t\"row.autoFromBonus\": \"Streak bonus +{credit} credits\",\n\t\t\t\"row.autoFromTravel\": \"Buddy travel +{credit} credits\"\n\t\t};\n\t\tconst zh = {\n\t\t\t\"row.navLabel\": \"XD Pool\",\n\t\t\t\"row.title\": \"WorkBuddy 池（dsh-workbuddy-xdpool）\",\n\t\t\t\"row.desc\": \"把本机所有已登录的 WorkBuddy 账号并入 DSH，作为一个自动容错的模型池使用。\",\n\t\t\t\"row.expand\": \"展开\",\n\t\t\t\"row.collapse\": \"收起\",\n\t\t\t\"row.requestFailed\": \"请求失败\",\n\t\t\t\"row.poolEmpty\": \"还没有发现任何 WorkBuddy 账号。\",\n\t\t\t\"row.poolEmptyHint\": \"先在 WorkBuddy 桌面 App 里登录一个或多个 WorkBuddy 账号，再点“重新检测账号”。每次登录都会被自动纳入池中。\",\n\t\t\t\"row.regionEmpty\": \"这边还没有登录账号。\",\n\t\t\t\"row.regionEmptyHint\": \"在 WorkBuddy 桌面 App 里登录一个该区域的账号，再点「重新检测账号」。国内版与国际版可以同时登录，两边各自独立。\",\n\t\t\t\"row.regionEmptyTitle\": \"这边还没有登录{region}账号。\",\n\t\t\t\"row.regionHowToTitle\": \"{region}怎么登录\",\n\t\t\t\"row.regionHowTo1\": \"下载并安装{region}客户端：国际版安装包名称是「WorkBuddy AI」，国内版是「WorkBuddy」，两者是不同的应用。也可以直接用网页版 https://www.workbuddy.ai/ 登录。\",\n\t\t\t\"row.regionHowTo2\": \"登录方式（任选其一）：① 邮箱注册/登录（最常用）；② 用 Google、GitHub、X 等海外账号授权登录；③ 部分版本支持微信扫码。\",\n\t\t\t\"row.regionHowTo3\": \"登录时请确保能正常访问海外站点（国际版面向海外用户，网络受限时可能打不开或登录失败）。\",\n\t\t\t\"row.regionHowTo4\": \"回到这里点「重新检测账号」。App 在本机留下的每次登录都会被自动吸收到各自区域 —— 两边互相独立，可以同时使用。\",\n\t\t\t\"row.regionHowToNote\": \"国内版与国际版的账号、积分、数据体系完全隔离，互不相通：国内版账号无法登录国际版，反之亦然，需要各自单独注册。本插件只读取客户端已完成的登录，不会代替你登录。\",\n\t\t\t\"row.shimStopped\": \"回环提供端未运行。\",\n\t\t\t\"row.shimRunning\": \"提供端正在回环地址监听\",\n\t\t\t\"row.accountsTitle\": \"池中账号\",\n\t\t\t\"row.tabCn\": \"国内版\",\n\t\t\t\"row.tabGlobal\": \"国际版\",\n\t\t\t\"row.tabHint\": \"每个 tab 是一个独立供应商，各有自己的账号、积分与模型；两边同时生效，一侧的改动不影响另一侧。\",\n\t\t\t\"row.accountsSummary\": \"{count} 个账号 · {cooling} 个冷却中\",\n\t\t\t\"row.ok\": \"运行健康 —— 请求会在各账号间自动轮换\",\n\t\t\t\"row.allCooling\": \"当前所有账号都处于限流冷却，请求会暂停直到某个冷却结束。\",\n\t\t\t\"row.accountInRotation\": \"已启用\",\n\t\t\t\"row.accountOff\": \"已停用\",\n\t\t\t\"row.accountToggleHint\": \"启用该账号（取消勾选则不参与池子）\",\n\t\t\t\"row.accountToggleError\": \"切换账号失败：{message}\",\n\t\t\t\"row.accountIgnore\": \"移出池子\",\n\t\t\t\"row.accountIgnoreHint\": \"把这个账号永久移出池子 —— 不再读取它的凭据，即使重新登录也不会回来\",\n\t\t\t\"row.accountIgnoreError\": \"修改忽略列表失败：{message}\",\n\t\t\t\"row.ignoredTitle\": \"已移出的账号\",\n\t\t\t\"row.ignoredSummary\": \"{count} 个账号已不在池中\",\n\t\t\t\"row.ignoredRestore\": \"恢复\",\n\t\t\t\"row.ignoredRestoreHint\": \"把这个账号放回池子\",\n\t\t\t\"row.currentAccount\": \"当前使用\",\n\t\t\t\"row.currentAccountDisabled\": \"已停用 —— 下次请求会换号\",\n\t\t\t\"row.cooling\": \"冷却中（被限流）\",\n\t\t\t\"row.cooldownHits\": \"触发 {hits} 次\",\n\t\t\t\"row.cooldownUntil\": \"至 {time}\",\n\t\t\t\"row.modelCooling\": \"{model} 冷却至 {time}\",\n\t\t\t\"row.tokenExpiry\": \"令牌 {time}\",\n\t\t\t\"row.creditsTotal\": \"合计\",\n\t\t\t\"row.creditsPackages\": \"积分包\",\n\t\t\t\"row.creditsPackage\": \"{remain} / {size}\",\n\t\t\t\"row.creditsError\": \"积分不可用\",\n\t\t\t\"row.creditsSoon\": \"3 天内到期\",\n\t\t\t\"row.creditsExpiresAt\": \"到期 {time}\",\n\t\t\t\"row.creditsExpiresSoonTitle\": \"3 天内到期\",\n\t\t\t\"row.creditsRefreshAt\": \"刷新 {time}\",\n\t\t\t\"row.checkinTitle\": \"每日签到\",\n\t\t\t\"row.checkinClaim\": \"签到\",\n\t\t\t\"row.checkinClaiming\": \"签到中…\",\n\t\t\t\"row.checkinClaimed\": \"今日已签到\",\n\t\t\t\"row.checkinInactive\": \"该账号当前无签到活动\",\n\t\t\t\"row.checkinStreak\": \"连签 {days} 天\",\n\t\t\t\"row.checkinDaily\": \"每日 +{credit} 积分\",\n\t\t\t\"row.checkinStreakBonus\": \"第 {days} 天额外 +{credit}\",\n\t\t\t\"row.checkinClaimedReward\": \"已领取 +{credit} 积分\",\n\t\t\t\"row.checkinError\": \"签到失败：{message}\",\n\t\t\t\"row.checkinAllHint\": \"这里可以为每个账号分别领取每日签到奖励，无需先切换账号。\",\n\t\t\t\"row.modelsTitle\": \"模型\",\n\t\t\t\"row.modelsSummary\": \"实时目录中 {count} 个模型\",\n\t\t\t\"row.modelsHint\": \"读取自 WorkBuddy 实时目录；免费档位已标注。\",\n\t\t\t\"row.modelEnabled\": \"启用\",\n\t\t\t\"row.modelImage\": \"图片输入\",\n\t\t\t\"row.modelContextBudget\": \"上下文窗口\",\n\t\t\t\"row.modelContextNative\": \"{size}（最大）\",\n\t\t\t\"row.modelContextCapped\": \"{size}\",\n\t\t\t\"row.modelOutput\": \"输出 {size}\",\n\t\t\t\"row.modelReasoning\": \"思考档位：{efforts}\",\n\t\t\t\"row.modelsEnabledCount\": \"已启用 {enabled} / {total}\",\n\t\t\t\"row.modelsSave\": \"保存\",\n\t\t\t\"row.modelsSaving\": \"保存中…\",\n\t\t\t\"row.modelsDiscard\": \"放弃修改\",\n\t\t\t\"row.modelsSaved\": \"模型选择已保存\",\n\t\t\t\"row.modelsSaveError\": \"保存失败：{message}\",\n\t\t\t\"row.modelsEmpty\": \"至少要启用一个模型才能保存。\",\n\t\t\t\"row.free\": \"免费\",\n\t\t\t\"row.limitedFree\": \"限量免费\",\n\t\t\t\"row.nightDiscount\": \"夜间\",\n\t\t\t\"row.imageCapable\": \"图片输入\",\n\t\t\t\"row.rate\": \"{rate}x 积分\",\n\t\t\t\"row.accountsRescan\": \"重新检测账号\",\n\t\t\t\"row.accountsScanning\": \"正在检测…\",\n\t\t\t\"row.distTitle\": \"账号使用方式\",\n\t\t\t\"row.distPriority\": \"优先模式\",\n\t\t\t\"row.distPriorityHint\": \"先用完一个账号，用完再换下一个\",\n\t\t\t\"row.distRoundRobin\": \"轮换模式\",\n\t\t\t\"row.distRoundRobinHint\": \"按顺序轮流使用，积分均匀分摊\",\n\t\t\t\"row.distBalanced\": \"均衡模式\",\n\t\t\t\"row.distBalancedHint\": \"随机抽取，闲置越久的账号被选中概率越高\",\n\t\t\t\"row.resetCooldowns\": \"清除所有冷却\",\n\t\t\t\"row.resetCooldownsBusy\": \"正在清除…\",\n\t\t\t\"row.resetCooldownsDone\": \"冷却已清除\",\n\t\t\t\"row.accountsRescanned\": \"检测到 {count} 个账号\",\n\t\t\t\"row.error\": \"池状态不可用：{message}\",\n\t\t\t\"row.autoTitle\": \"积分自动化\",\n\t\t\t\"row.autoOn\": \"已开启\",\n\t\t\t\"row.autoOff\": \"已关闭\",\n\t\t\t\"row.autoBusy\": \"保存中…\",\n\t\t\t\"row.autoHintOn\": \"每天自动签到、上报活跃、领取任务奖励与连登奖励，并照看猫猫旅行。\",\n\t\t\t\"row.autoHintOff\": \"已关闭：不会替你发起任何后台请求。\",\n\t\t\t\"row.autoJob_report\": \"活跃上报\",\n\t\t\t\"row.autoJob_tasks\": \"任务奖励\",\n\t\t\t\"row.autoJob_checkin\": \"每日签到\",\n\t\t\t\"row.autoJob_streak\": \"连登奖励\",\n\t\t\t\"row.autoJob_travel\": \"猫猫旅行\",\n\t\t\t\"row.autoHourNone\": \"当天不跑\",\n\t\t\t\"row.autoNever\": \"还没跑过\",\n\t\t\t\"row.autoRun\": \"立即运行\",\n\t\t\t\"row.autoRunning\": \"运行中…\",\n\t\t\t\"row.autoRan\": \"完成：{count} 个账号正常，{failed} 个失败\",\n\t\t\t\"row.autoRanTasks\": \"完成：领取 {claimed} 个任务，+{credit} 积分，+{energy} 能量\",\n\t\t\t\"row.reserveTitle\": \"保留积分\",\n\t\t\t\"row.reserveUnit\": \"积分\",\n\t\t\t\"row.reserveSaving\": \"保存中…\",\n\t\t\t\"row.reserveSave\": \"保存\",\n\t\t\t\"row.reserveHolding\": \"已保留·暂停使用\",\n\t\t\t\"row.reserveSaved\": \"已保留 {credits} 积分\",\n\t\t\t\"row.reserveCleared\": \"已取消保留\",\n\t\t\t\"row.reserveFailed\": \"保存失败，请重试\",\n\t\t\t\"row.autoToday\": \"今日自动化\",\n\t\t\t\"row.autoEarned\": \"今日自动化获得\",\n\t\t\t\"row.autoEnergy\": \"能量\",\n\t\t\t\"row.autoTasksClaimed\": \"{count} 个任务\",\n\t\t\t\"row.autoRunAll\": \"立即运行\",\n\t\t\t\"row.autoRunDone\": \"自动化已执行完成\",\n\t\t\t\"row.autoRunTimeout\": \"仍在执行中，稍后查看结果\",\n\t\t\t\"row.autoAlreadyRunning\": \"已有一次执行正在进行\",\n\t\t\t\"row.autoRanAll\": \"已运行 {jobs} 项，{ok} 个正常，{failed} 个失败\",\n\t\t\t\"row.autoFromTasks\": \"任务 +{credit} 积分 · +{energy} 能量 · {count} 个\",\n\t\t\t\"row.autoFromCheckin\": \"签到 +{credit} 积分\",\n\t\t\t\"row.autoFromBonus\": \"连登奖励 +{credit} 积分\",\n\t\t\t\"row.autoFromTravel\": \"猫猫旅行 +{credit} 积分\"\n\t\t};\n\t\t//#endregion\n\t\t//#region src/client/index.tsx\n\t\t/** Stable browser-plugin name. */\n\t\tconst name = \"dsh-workbuddy-xdpool-client\";\n\t\t/**\n\t\t* Client services required by the settings page.\n\t\t*\n\t\t* Deliberately only the two services present on BOTH host lines. The settings\n\t\t* surface differs by line — 0.1.5 provides `settingsScope`, 0.1.7 replaces it\n\t\t* with `configForms` — and cordis' dependency gate is hard: any inject entry the\n\t\t* running line does not provide keeps `apply` from ever running. Probing the one\n\t\t* that exists through `ctx.get()` (which returns undefined, never throws, for an\n\t\t* absent service) is what lets one build serve both lines.\n\t\t*/\n\t\tconst inject = [\"slots\", \"locale\"];\n\t\t/** Settings namespace the host-side section registers (shared with the entry). */\n\t\tconst WORKBUDDY_POOL_SETTINGS_NS = \"workbuddy-xdpool\";\n\t\t/**\n\t\t* Host plugin entry id this bundle is mounted under in `cordis.patch.yml`.\n\t\t*\n\t\t* `configForms` is addressed by this id on the 0.1.7 line.\n\t\t*/\n\t\tconst WORKBUDDY_POOL_ENTRY_ID = \"llm-workbuddy-xdpool\";\n\t\t/** Register card copy and the pool page under Settings. */\n\t\tfunction apply(ctx) {\n\t\t\ttry {\n\t\t\t\tconst namespace = \"settings.workbuddy-xdpool\";\n\t\t\t\tctx.effect(() => ctx.locale.register(namespace, {\n\t\t\t\t\tzh,\n\t\t\t\t\ten\n\t\t\t\t}), \"dsh-workbuddy-xdpool: settings copy\");\n\t\t\t\tconst t = ctx.locale.bind(namespace);\n\t\t\t\tconst softGet = (serviceName) => ctx.get(serviceName);\n\t\t\t\tconst settingsScope = resolveSettingsScope(softGet);\n\t\t\t\tctx.slots.inject(\"settings.section\", () => ctx.slots.register({\n\t\t\t\t\tname: \"settings.section\",\n\t\t\t\t\tid: \"workbuddy-xdpool\",\n\t\t\t\t\torder: 440,\n\t\t\t\t\tlabel: () => t(\"row.navLabel\"),\n\t\t\t\t\tinject: () => settingsScope === void 0 ? { t } : {\n\t\t\t\t\t\tt,\n\t\t\t\t\t\tsettingsScope\n\t\t\t\t\t}\n\t\t\t\t}, PoolCard));\n\t\t\t\tinstallNavIcon(ctx, () => t(\"row.navLabel\"));\n\t\t\t} catch (error) {\n\t\t\t\tconsole.error(\"[dsh-workbuddy-xdpool] client page failed to load (host provider unaffected):\", error);\n\t\t\t}\n\t\t}\n\t\t/** Attribute carrying the nav-row marker this module installs. */\n\t\tconst NAV_ICON_MARKER = \"data-dsh-xdpool-nav-icon\";\n\t\t/**\n\t\t* The settings nav rows, as the shell renders them. Scoped to the settings\n\t\t* dialog on purpose: the main sidebar has its own nav, and matching rows there\n\t\t* would stamp this glyph onto an unrelated control.\n\t\t*/\n\t\tconst NAV_ROW_SELECTOR = \"[role=\\\"dialog\\\"] nav button\";\n\t\t/**\n\t\t* Draw this page's own glyph in its Settings nav row.\n\t\t*\n\t\t* The `settings.section` contract carries no icon: the shell decides the glyph\n\t\t* from the section id and falls back to a gear for anything it does not know.\n\t\t* So the row is matched by its LABEL (the same thunk passed to the\n\t\t* registration, re-read on every pass so a locale switch is followed) and\n\t\t* marked; CSS then hides the shell svg and masks this artwork into the row.\n\t\t*\n\t\t* Re-scanned on DOM mutations because the shell re-renders the nav on locale\n\t\t* and theme changes, which replaces the row elements and drops the marker.\n\t\t*\n\t\t* No-op off the browser (the node-side probe imports this module for types).\n\t\t*/\n\t\tfunction installNavIcon(ctx, resolveLabel) {\n\t\t\tif (typeof document === \"undefined\") return;\n\t\t\tctx.effect(() => {\n\t\t\t\tconst tag = document.createElement(\"style\");\n\t\t\t\ttag.dataset.plugin = \"dsh-workbuddy-xdpool\";\n\t\t\t\ttag.dataset.pluginCss = \"dsh-workbuddy-xdpool/settings-nav-icon\";\n\t\t\t\ttag.textContent = [\n\t\t\t\t\t`[${NAV_ICON_MARKER}] > svg { display: none; }`,\n\t\t\t\t\t`[${NAV_ICON_MARKER}]::before {`,\n\t\t\t\t\t\"  content: '';\",\n\t\t\t\t\t\"  flex: none;\",\n\t\t\t\t\t\"  width: 16px;\",\n\t\t\t\t\t\"  height: 16px;\",\n\t\t\t\t\t\"  background-color: currentColor;\",\n\t\t\t\t\t`  -webkit-mask-image: url(\"${POOL_NAV_ICON_MASK_URL}\");`,\n\t\t\t\t\t`  mask-image: url(\"${POOL_NAV_ICON_MASK_URL}\");`,\n\t\t\t\t\t\"  -webkit-mask-repeat: no-repeat;\",\n\t\t\t\t\t\"  mask-repeat: no-repeat;\",\n\t\t\t\t\t\"  -webkit-mask-position: center;\",\n\t\t\t\t\t\"  mask-position: center;\",\n\t\t\t\t\t\"  -webkit-mask-size: 16px 16px;\",\n\t\t\t\t\t\"  mask-size: 16px 16px;\",\n\t\t\t\t\t\"}\"\n\t\t\t\t].join(\"\\n\");\n\t\t\t\tdocument.head.appendChild(tag);\n\t\t\t\tlet disposed = false;\n\t\t\t\tlet scheduled = false;\n\t\t\t\tconst sync = () => {\n\t\t\t\t\tscheduled = false;\n\t\t\t\t\tif (disposed) return;\n\t\t\t\t\tconst wanted = String(resolveLabel() ?? \"\").trim();\n\t\t\t\t\tif (wanted === \"\") return;\n\t\t\t\t\tfor (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) if (String(row.textContent ?? \"\").trim() === wanted) row.setAttribute(NAV_ICON_MARKER, \"\");\n\t\t\t\t\telse row.removeAttribute(NAV_ICON_MARKER);\n\t\t\t\t};\n\t\t\t\tconst schedule = () => {\n\t\t\t\t\tif (scheduled || disposed) return;\n\t\t\t\t\tscheduled = true;\n\t\t\t\t\tqueueMicrotask(sync);\n\t\t\t\t};\n\t\t\t\tsync();\n\t\t\t\tconst observer = new MutationObserver(schedule);\n\t\t\t\tobserver.observe(document.body, {\n\t\t\t\t\tchildList: true,\n\t\t\t\t\tsubtree: true,\n\t\t\t\t\tcharacterData: true\n\t\t\t\t});\n\t\t\t\treturn () => {\n\t\t\t\t\tdisposed = true;\n\t\t\t\t\tobserver.disconnect();\n\t\t\t\t\tfor (const row of document.querySelectorAll(`[${NAV_ICON_MARKER}]`)) row.removeAttribute(NAV_ICON_MARKER);\n\t\t\t\t\ttag.remove();\n\t\t\t\t};\n\t\t\t}, \"dsh-workbuddy-xdpool: settings nav icon\");\n\t\t}\n\t\t/**\n\t\t* Bind the settings form the card reads and writes, on whichever line is\n\t\t* running.\n\t\t*\n\t\t* 0.1.7 exposes `configForms.get(entryId)`, keyed by the HOST plugin entry id —\n\t\t* the id this bundle registers under in `cordis.patch.yml`, not the settings\n\t\t* namespace. 0.1.5 exposes `settingsScope.bind({ namespace })`, keyed by the\n\t\t* namespace the host-side `installSection` registered. Both controllers answer\n\t\t* the same two methods the card uses (`getSnapshot()`, `set(field, value)`), so\n\t\t* the card needs no per-line branch of its own.\n\t\t*\n\t\t* Returns undefined when neither service is present (a locked-down host): the\n\t\t* card then renders read-only, which is the documented degradation.\n\t\t*/\n\t\tfunction resolveSettingsScope(softGet) {\n\t\t\tconst forms = softGet(\"configForms\");\n\t\t\tif (forms !== void 0) {\n\t\t\t\tlet entryId = WORKBUDDY_POOL_ENTRY_ID;\n\t\t\t\ttry {\n\t\t\t\t\tconst namespaces = forms.describe().getSnapshot().view?.namespaces ?? [];\n\t\t\t\t\tconst served = namespaces.find((entry) => entry.ns === WORKBUDDY_POOL_ENTRY_ID) ?? namespaces.find((entry) => /workbuddy-xdpool/.test(entry.ns));\n\t\t\t\t\tif (served !== void 0) entryId = served.ns;\n\t\t\t\t} catch {}\n\t\t\t\treturn forms.get(entryId);\n\t\t\t}\n\t\t\tconst scope = softGet(\"settingsScope\");\n\t\t\tif (scope !== void 0) return scope.bind({ namespace: WORKBUDDY_POOL_SETTINGS_NS });\n\t\t}\n\t\t//#endregion\n\t\texports.apply = apply;\n\t\texports.inject = inject;\n\t\texports.name = name;\n\t\treturn module.exports;\n\t}\n});\n";
//#endregion GENERATED: xdpool client source

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

    // 并入的账号池界面（原 dsh-workbuddy-xdpool 的浏览器入口，MIT (c) XDTrees）。
    //
    // 它和本文件一样是 `window.__ModuleLoader__.load({id, factory})` 形态的自注册脚本。
    // 合并后有两个选择：把它的源码内联进来，或在宿主里加载两次。
    // 这里选**内联**：把它的源码当字符串注入执行，捕获它 factory 的产物，
    // 再调用它导出的 apply。好处是只注册一次、顺序可控，
    // 而且 vendored 代码一行都不用改（便于日后对照上游升级）。
    let xdpoolClient = null;
    // prev 必须声明在 try 之外：finally 里要用它把加载器还原回去
    const prevLoader = window.__ModuleLoader__;
    try {
      let captured = null;
      window.__ModuleLoader__ = {
        load(def) {
          if (def && typeof def.factory === 'function' && def.id !== pkgName) {
            try {
              const mod = def.factory(require);
              if (mod) captured = mod;
            } catch {
              /* 忽略：vendored 脚本的异常不该拖垮本插件 */
            }
            return captured;
          }
          if (prevLoader && typeof prevLoader.load === 'function') return prevLoader.load(def);
          return undefined;
        },
      };
      const el = document.createElement('script');
      el.textContent = XDPOOL_CLIENT_SRC;
      document.head.appendChild(el);
      xdpoolClient = captured;
    } catch {
      xdpoolClient = null;
    } finally {
      window.__ModuleLoader__ = prevLoader;
    }

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

    /**
     * 把「账号池卡片能不能写设置」这件事查清楚并上报。
     *
     * 为什么要这个：勾选保存不了时，卡片的写入走的是
     *   settingsScope.set('modelSelectionCn', {...})
     * 而 settingsScope 由 vendored 的 resolveSettingsScope() 决定 ——
     * 它要么取 configForms 里的表单（按条目 id / 命名空间找），
     * 要么退回到 settingsScope.bind({namespace:'workbuddy-xdpool'})。
     * 这两条路哪条通、找到的命名空间叫什么、是不是只读，**只有浏览器端知道**。
     * 报回来就能一次看清，不用再一轮轮猜。
     */
    function probeSettingsScope(ctx) {
      const out = {};
      try {
        const forms = typeof ctx.get === 'function' ? ctx.get('configForms') : undefined;
        out.hasConfigForms = forms !== undefined;
        if (forms !== undefined) {
          try {
            const snap = forms.describe().getSnapshot();
            // 顶层 writable / hasDocument：说明 settings 文档本身的状态。
            // 文档还没加载完时这里会是 false / false。
            out.docWritable = snap?.writable;
            out.hasDocument = snap?.hasDocument;
            const namespaces = snap?.view?.namespaces ?? snap?.namespaces ?? [];
            out.namespaces = namespaces.map((e) => e.ns);
            out.exactMatch = namespaces.some((e) => e.ns === 'llm-workbuddy-xdpool');
            out.regexMatches = namespaces.filter((e) => /workbuddy-xdpool/.test(e.ns)).map((e) => e.ns);
            const entryId = out.exactMatch
              ? 'llm-workbuddy-xdpool'
              : (out.regexMatches[0] ?? 'llm-workbuddy-xdpool');
            out.entryIdUsed = entryId;
            const form = forms.get(entryId);
            out.formFound = form !== undefined;
            if (form !== undefined) {
              const s = typeof form.getSnapshot === 'function' ? form.getSnapshot() : form;
              out.formWritable = s?.writable;
              out.formKeys = s && typeof s === 'object' ? Object.keys(s).slice(0, 12) : [];
            }
          } catch (e) {
            out.formsError = String((e && e.message) || e);
          }
        }
        const scope = typeof ctx.get === 'function' ? ctx.get('settingsScope') : undefined;
        out.hasSettingsScope = scope !== undefined;
        if (scope !== undefined && typeof scope.bind === 'function') {
          try {
            const bound = scope.bind({ namespace: 'workbuddy-xdpool' });
            const s = bound && typeof bound.getSnapshot === 'function' ? bound.getSnapshot() : bound;
            out.boundWritable = s?.writable;
          } catch (e) {
            out.bindError = String((e && e.message) || e);
          }
        }
      } catch (e) {
        out.error = String((e && e.message) || e);
      }
      return out;
    }

    function apply(ctx) {
      // —— 上线探针 ——
      //
      // 服务端起来了不代表浏览器端被加载了。而且 settings 文档是**异步**加载的：
      // 在 apply() 里同步读 configForms，很可能读到「还没加载完」的中间态
      // （namespaces 为空、writable=false），据此下结论会误判。
      // 所以采样三次：立刻、3 秒后、12 秒后，各上报一次，看它怎么变。
      try {
        const send = (tag, extra) => {
          let env = null;
          try { env = probeSettingsScope(ctx); } catch (e) { env = { error: String((e && e.message) || e) }; }
          fetch(API + '/client-boot', {
            method: 'POST',
            keepalive: true,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ settingsScope: env, sample: tag, ...(extra || {}) }),
          }).catch(() => {});
        };
        send('t+0');
        setTimeout(() => send('t+3s'), 3000);
        setTimeout(() => send('t+12s'), 12000);
      } catch { /* 忽略 */ }

      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'workbuddy-console: locale');
        }
        const t = ctx.locale && typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : undefined;

        // —— 先让并入的「账号池」那一半注册它的设置页 ——
        //
        // vendor/xdpool/lib/client.js 是原 dsh-workbuddy-xdpool 的浏览器入口，
        // 它注册账号池卡片（国内版/国际版、轮询策略、池中账号等）。
        // 合并后这里转发一次，两个插件的界面就都归本插件管。
        // 它不可用时只少一张卡片，不影响控制台与技能市场。
        let poolDispose = null;
        try {
          if (xdpoolClient && typeof xdpoolClient.apply === 'function') {
            const d = xdpoolClient.apply(ctx);
            if (typeof d === 'function') poolDispose = d;
          }
        } catch (e) {
          console.error('[workbuddy-console] 账号池界面(xdpool) 注册失败:', e);
        }

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
        // 守卫同样放在回调内部（见下面 settings.plugin.item 处的说明）。
        const registerSection = () => {
          try {
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'workbuddy-console',
                order: 460,
                label: () => (t ? t('navLabel') : tr('navLabel')),
                locale: NS,
              },
              (props) => SkillsSection({ ...(props || {}), t }),
            );
          } catch (e) {
            console.error('[workbuddy-console] settings section failed:', e);
          }
        };
        try {
          ctx.effect(() => ctx.slots.inject('settings.section', registerSection), 'workbuddy-console: settings section');
        } catch (e) {
          console.error('[workbuddy-console] settings section inject failed:', e);
        }

        // 曾经这里还注册了 settings.plugin.item（仿 dsh-dafeiyu）。
        // 后来查证：**DSH 里根本没有这个插槽** —— 在 asar 的 4420 个 js 文件里
        // 搜 "settings.plugin.item" 是 0 命中，dafeiyu 那次注册其实是静默失败的
        // （它作者写 "fail this card quietly" 就是这个意思）。
        // 留着只会误导，删掉。
        // 设置页只走上面的 settings.section —— 实测两张卡片都能正常显示。
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
