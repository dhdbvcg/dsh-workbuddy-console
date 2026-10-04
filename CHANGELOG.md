# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.11] - 2026-10-04

### 修复：模型勾选保存不了（取消勾选 → 保存 → 又变回勾选）

**根因：本模块没有导出 vendored 的 `Config` schema。**

宿主按插件导出的 `Config` 生成「配置表单」；浏览器端的账号池卡片靠
`resolveSettingsScope()` 找到这个表单，拿到**可写的** `settingsScope`
才写得进 `modelSelectionCn`：

```js
const key = activeRegion === "cn" ? "modelSelectionCn" : "modelSelectionGlobal";
await write.call(settingsScope, key, { enabledModelIds, imageModelIds, contextBudgets });
```

我们合并时只导出了 `apply / inject / name`，于是这个条目**没有 schema**、
没有配置表单，`settingsScope` 取不到 —— 卡片退化成只读，
写入无处可去，界面重新读回来自然就是「又变回勾选」。

**修法**（vendored 代码一行都不用改）：

```js
export const Config = xdpoolModule.Config;
```

`vendor/xdpool/lib/index.js` 本来就 `export { …, Config, … }`。

### 为什么之前没人发现

这个故障**不会报任何错**，只是保存静默失效。加了一条测试盯住它：

```
导出 Config（少了它设置卡片会变成只读）
```

并实测有效：临时去掉该导出后测试立刻失败。

### 测试

- 238 → **239 项**，全绿

## [2.0.10] - 2026-10-04

### 清理

- **删掉 2.0.8 加的 `settings.plugin.item` 注册**。

  当时看到能用的第三方插件 `dsh-dafeiyu` 注册这个插槽，就照着加了。
  后来在 asar 的 4420 个 js 文件里搜 `settings.plugin.item` —— **0 命中**，
  DSH 里根本没有这个插槽，dafeiyu 那次注册其实是**静默失败**的
  （它作者注释写的 "fail this card quietly" 就是这个意思）。

  设置页本来就只走 `settings.section`，实测两张卡片
  （`XD Pool` 与 `WorkBuddy 技能市场`）都能正常显示，留着那段只会误导。

### 已验证可用

重启后确认：

| 项目 | 结果 |
|---|---|
| 账号池卡片 | 正常 —— 运行健康、3 个账号、提供端 `http://127.0.0.1:63611`、优先/均衡/轮询模式 |
| 技能市场卡片 | 正常 —— 出现在设置导航 |
| 9 条池路由 | 全部注册（`/wb-console/api/diag` 的 `poolRoutes` 逐条为 true） |
| `poolError` | 空 |
| 浏览器端上线 | `clientBoots` 有记录 |

### 测试

- 238 项，全绿

## [2.0.9] - 2026-10-04

### 修复：账号池卡片「池状态不可用：HTTP 404」

2.0.8 之后设置里两张卡片都出来了（`XD Pool` 和 `WorkBuddy 技能市场`），
但账号池卡片报 `请求失败 / 池状态不可用：HTTP 404`。

**根因**：`vendor/xdpool/lib/index.js` 自己声明的是

```js
const inject = ["llm", "settings"];
```

而本文件用 `export const inject = ['webServer']`，然后**手动同步调用**
`xdpoolModule.apply(ctx, ...)` —— 这绕过了 cordis 的 inject 门控。
于是 `settings` 还没就绪时，vendored 代码在内部抛错，被我们的
`try/catch` 吞掉，结果**它那 9 条池路由一条都没注册**，
浏览器端请求 `/plugins/dsh-workbuddy-xdpool/status` 自然 404。

**修法**：把依赖列进本模块的 `inject`：

```js
export const inject = ['webServer', 'llm', 'settings'];
```

cordis 会等到它们全部可用再调用我们的 `apply`，转发给 vendored apply 就安全了。

### 顺带把「查不到」变成「查得到」

`/wb-console/api/diag` 现在多了两个字段，以后同类问题不用再靠猜：

- `poolError` —— 转发给 vendored apply 失败时的错误与堆栈
- `poolRoutes` —— 直接查 webserver 路由表，逐条报告池路由有没有注册上

### 测试

- 238 项，全绿；并同步了 `selftest` 里对 `inject` 的断言

## [2.0.8] - 2026-10-04

### 跟进：设置里看不到界面

2.0.7 之后插件本体能加载了（插件列表显示「运行中」），
但设置对话框里依然没有本插件的界面。

服务端已确认没问题（`/wb-console` 返回 200）。怀疑点落在
**浏览器端 bundle 有没有被加载 / 注册到正确的插槽**，于是做了三件事：

1. **上线探针**：客户端 `apply()` 一执行就 `POST /wb-console/api/client-boot`。
   服务端把最近 20 次记录放进 `/wb-console/api/diag` 的 `clientBoots` 字段。
   这样能一句话确定问题在服务端还是浏览器端，不用再猜。

2. **补注册 `settings.plugin.item`**：对比发现能正常显示界面的第三方插件
   （`dsh-dafeiyu`）注册的是 `settings.plugin.item`（插件市场里的一张卡片），
   而不是顶层 `settings.section`。现在两种形态都注册，各自 guard，
   谁可用谁生效。

3. **守卫移进回调内部**：宿主可能**异步**调用 `slots.inject` 的回调，
   那时外层 `try` 早已结束、包不住里面的异常 —— 而注册抛错会连带
   整个 WebUI 加载失败。`dsh-dafeiyu` 的作者也是踩了这个坑才这么写的。

### 测试

- 238 项，全绿

## [2.0.7] - 2026-10-04

### 修复（严重）：能自愈已经被卡住的进程

- 2.0.6 的幂等修复对**将来**的重复注册有效，但对**已经卡住**的进程没用：
  旧版本（≤2.0.5）注册路由时**没有登记 disposer**，那些残留拿不到任何
  清理入口，`disposeLive()` 也无能为力 —— 于是插件一直「异常」，
  只能靠重启 DSH 才能恢复。

  现在 `apply()` 里多一道兜底：**直接扫 webserver 的路由表**，
  删掉 `BASE`（`/wb-console`）命名空间下的残留。

  `dsh-host-webserver` 的路由表就是它的公开字段：

  ```js
  exact = new Map();     // exact 路由
  prefixes = new Map();  // 前缀路由
  ```

  只删自己前缀下的键，其它插件（旧 xdpool 用的是 `/pool/...`）不受影响。
  这样即使进程里已经卡着残留，插件重新加载时也能自己恢复，不必等重启。

### 测试终于测到了实现本身

排查这个用例时发现**上一版的测试是假通过**：mock 把路由表放在
`webServer.routes` 里，而真实实现是 `webServer.exact` / `webServer.prefixes`
**直接字段**，于是 `clearOwnRoutes()` 在测试里成了空操作。

两处修正：
- mock 改成与真实实现同构（`exact` / `prefixes` 直接挂在 webserver 上）
- 该用例改用**全新的 ctx**：旧代码从没登记 disposer，全局 key 是 `null`；
  用同一个 ctx 会撞上前一次的 disposer，测不到兜底清理

并实测有效性：

| 实现 | 结果 |
|---|---|
| 禁用 `clearOwnRoutes` | **3 项失败**，其中一项正是 `webserver: duplicate exact route "/wb-console"` |
| 启用 | 14 项全过 |

### 测试

- 234 → **238 项**，全绿

## [2.0.6] - 2026-10-04

### 加固

- **2.0.5 的幂等修复在「宿主重新 import 同一文件」时不够用。**

  2.0.5 把「当前生效的注册」记在**模块级变量**里。但宿主热重载很可能是
  重新 `import` 这个文件 —— 那是**另一个模块实例**，模块级变量会重新
  初始化成 `null`，于是清不掉上一个实例留下的路由，
  第二次注册仍然撞 `duplicate exact route "/wb-console"`。

  现在改用 `Symbol.for('dsh-workbuddy-console.liveDispose')` 存在
  `globalThis` 上，所有模块实例共享同一个 key。
  这是有意为之的进程级单例：一个进程里本插件只应有一份注册。

### 这次把守卫做到位了

`test/apply-idempotent-test.mjs` 从 7 项加到 **10 项**，新增最关键的一条：
用查询串让 Node 生成**第二个模块实例**，模拟宿主的重新 import，再 apply 一次。

并实测这条守卫的有效性：

| 实现 | 同一实例 apply×2 | 跨模块实例 apply |
|---|---|---|
| 模块级变量（2.0.5） | 通过 | **失败：duplicate exact route "/wb-console"** |
| `Symbol.for` 进程级 key（本版） | 通过 | 通过 |

也就是说：**如果没有这条跨实例用例，2.0.5 的修复看起来是好的，但实际场景仍会坏。**

### 测试

- 231 → **234 项**，全绿

## [2.0.5] - 2026-10-04

### 修复（严重）

- **`1 entry did not activate` + `webserver: duplicate exact route "/wb-console"`。**

  上两版把 YAML 和条目重复都修掉了，插件仍起不来。这次查清了真正原因。

  `dsh-host-webserver` 的 `register()` 对同一个 `(kind, path)` **直接抛错**
  （路径不做归一化，所以 `/wb-console` 与 `/wb-console/` 是不同键）：

  ```js
  if (table.has(route.path)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`);
  ```

  而 **DSH 自带 `hmr`**：配置或文件变化时插件会被重新 `apply`。
  只要有一次「旧的 dispose 还没跑到、新的 apply 已经开始」，
  第二次注册 `/wb-console` 就撞车 —— 整个插件激活失败，
  界面上显示「异常 / 无法使用」。

  **修法：`apply()` 幂等。** 现在用模块级的 `liveDispose` 记住「当前生效」
  的那一次注册，新的一次 `apply` 开头先把上一次撤掉，
  于是与宿主的重载顺序无关。

### 怎么确认的（这次没有猜）

- `dsh --profile <copy> --dump-config`（desktop 被 Electron 独占，
  所以复制成一个换名 profile 来 dump）→ 实际生效的条目**只有 1 个**，
  排除「配置里挂了两份」
- 用 mock ctx 跑一次 `apply()` → 单次注册 **34 条路由，
  `/wb-console` 只出现一次**，排除「插件自己注册两遍」
- 读 asar 里 `dsh-host-webserver/lib/index.js` 的 `register()` →
  确认「重复即抛」的严格语义
- 结论只能是 **`apply()` 在本进程里被调用了两次**，且第一次的清理没跑到

### 守卫

- 新增 `test/apply-idempotent-test.mjs`（7 项）：用**与真实实现一致的
  严格语义**（重复注册即抛）连续 `apply()` 两次，必须不抛错、路由不泄漏
- 已验证这条测试**确实能抓到该 bug**：临时去掉修复后，
  它报出的正是用户看到的 `webserver: duplicate exact route "/wb-console"`

### 测试

- 224 → **231 项**，全绿

## [2.0.4] - 2026-10-04

### 修复（严重）

- **`2 entries did not activate` + `webserver: duplicate exact route "/wb-console"`。**

  上一版修好 YAML 语法后，插件仍起不来。原因是条目设计错了：
  我让**两个 id 指向同一个包**（`llm-workbuddy-xdpool` 和 `workbuddy-console`），
  于是 DSH 把同一个插件**加载两次**，`apply()` 跑两遍，
  第二次注册 `/wb-console` 路由时冲突，**两个条目一起失败**：

  ```
  2 entries did not activate
  llm-workbuddy-xdpool (dsh-workbuddy-console): Error: webserver: duplicate exact route "/wb-console"
  workbuddy-console  (dsh-workbuddy-console): Error: webserver: duplicate exact route "/wb-console"
  ```

  **正确做法：一个包只留一个条目。** 现在只插入 `llm-workbuddy-xdpool` 一个 id。

- 顺带说明**为什么 id 不能改成包名**：vendored 的账号池卡片用这个 id
  精确匹配设置命名空间（`forms.get(entryId)`），换成 `workbuddy-console`
  就匹配不上，卡片会退化成只读。

### 安装器

- 条目 id 从 `workbuddy-console` 改为 `llm-workbuddy-xdpool`
- 安装时会**自动清理**旧版本写入的重复条目（`workbuddy-console`）
- 也会清掉指向**已卸载旧包**（`dsh-workbuddy-xdpool`）的条目，
  以及把 `name` 修正回本插件 —— 覆盖 2.0.0~2.0.3 装坏的各种残留状态

### 守卫

- `check-manifest` 新增一条：**同一个包被多个 id 引用即失败**
  （这正是本次故障，靠人眼看配置看不出来）
- `manifest-guard-test` 增加对应用例，验证这条守卫真会触发
- `installer-test` 增加 3 个用例：清重复条目 / 清失效条目 / 不动别人的条目

### 测试

- 218 → **224 项**，全绿

## [2.0.3] - 2026-10-04

### 修复（严重）

- **插件在 DSH 里显示「异常 / 无法使用插件」。**

  `cordis.patch.yml` 里用了 JavaScript 的块注释 `/** ... */` 当说明。
  YAML 的注释**只有 `#`**，`/**` 会被当成内容，于是解析直接失败：

  ```
  failed to parse overlay .../cordis.patch.yml:
  YAMLException: end of the stream or a document separator is expected (2:73)
  ```

  这是合并时引入的，**2.0.0 / 2.0.1 / 2.0.2 三个版本都是坏的**，本版修好。

- 同时修正该文件里另一处错误：`llm-workbuddy-xdpool` 条目原先写的
  `name: dsh-workbuddy-xdpool` —— 那个包在合并后已被卸载，即使 YAML 能解析
  也会加载失败。现在两条都指向 `dsh-workbuddy-console`。

### 为什么 218 项测试没拦住

当时没有任何测试**解析过**那个文件。现在补上两道：

- `scripts/check-manifest.mjs`：真的用 YAML 解析器读 `cordis.patch.yml`，
  并校验顶层是数组、无重复 id、每个 `name` 都能解析；
  另外单独拦 `/* */`、Tab 缩进这些写法
- `test/manifest-guard-test.mjs`（8 项）：故意写坏配置，验证上面这些检查
  真的会失败 —— 抓不到的守卫等于没有
- `scripts/verify-published.mjs`：连**已发布的包**也解析一遍它的
  `cordis.patch.yml`，防止坏文件发出去

### 测试运行器

- 修 `findProfile()`：它还在用**已被卸载的** `dsh-workbuddy-xdpool` 当
  「这个 profile 可用」的标记，于是 desktop 不匹配、悄悄退到 web profile
  （那里残留着旧包）。副作用是测试从 web 的 node_modules 解析到了旧包，
  让「引用不存在的包名」这条断言在特定环境下失效。
  现在改为匹配本插件自身
- 运行器在有失败时也打印该测试的输出（原先只在崩溃时打印，有失败得手工复现）

### 测试

- 210 → **218 项**，全绿

## [2.0.2] - 2026-10-04

### 文档

- **两份 README 顶部加独立章节致谢 XDTrees**：明确账号池/模型池/签到/积分
  自动化的运行时代码由 XDTrees 编写，本仓库只是把它们与控制台合并；
  并指向 [THIRD-PARTY.md](THIRD-PARTY.md)、`LICENSE-ORIGINAL` 与原作者仓库。
  想只用账号池的人可以直接装原作者那一份。
- 本版同步到 npm，让 npm 页面也显示这段致谢。

### 仓库

- 首次把完整历史推送到 GitHub（此前远端只有 1.1.0 一个快照）。
  远端与本地历史原本不相关（当初用 Git Data API 建的），
  已核对「远端内容全部被本地包含」后以 `--force-with-lease` 覆盖，
  并获得线性历史。详见下方「推送」一节。

### 工具

- 新增 `scripts/git-tunnel.mjs`：hosts 屏蔽 github.com 时，
  用本地 CONNECT 隧道 + 真实 IP 执行任意 git 命令（fetch/push/ls-remote）
- 新增 `scripts/check-github.mjs`、`scripts/check-remote-safety.mjs`：
  推送前核对 token 身份/权限，以及 tag、release、分支、协作者、PR
- 两个脚本都不含密钥：token 经环境变量交给临时 askpass，用完即删

## [2.0.1] - 2026-10-04

### 改进

- README 补上 npm 安装方式与「条目 id 必须保留」的说明
- `link-vendor` 先判断 Node 能否自然解析依赖：npm 安装（包已在 profile 内）时
  不再往 `node_modules` 里建链接（会被重装清掉）；只有 `link:` 开发模式才需要
- 修一个静默 bug：`link-vendor` 是 ESM 却写了全局 `require`，抛错被 `catch`
  吞掉，导致「能否自然解析」恒为 false —— 上面的判断此前形同虚设
- 新增发布相关脚本：
  - `scripts/prepublish-check.mjs` —— 发布前自检（字段/文件/敏感信息/体积）
  - `scripts/publish-via-proxy.mjs` —— DNS 被污染时的发布通道
  - `scripts/verify-published.mjs` —— 下载已发布的包并验证真能用
- 新增 `test/link-vendor-test.mjs`：实测「有链接 / 无链接」两个分支
- 测试 204 → **210 项**

## [2.0.0] - 2026-10-04

### 发布到 npm

`dsh-workbuddy-console@2.0.0` 已发布：
<https://www.npmjs.com/package/dsh-workbuddy-console>

```bash
pnpm add dsh-workbuddy-console
```

- 包内含 `vendor/xdpool/`，**装这一个就够**，不用再单独装 dsh-workbuddy-xdpool
- `vendor/xdpool/LICENSE-ORIGINAL` 随包分发，保留 XDTrees 的 MIT 署名
- 已实测：把发布出去的 tarball 解包放进模拟 profile 布局，
  不依赖本机链接即可 import 成功（`scripts/verify-published.mjs`）

> 本机 DNS 把 `registry.npmjs.org` 污染到了国内 IP（npm 报错里出现
> m.baidu.com）。`scripts/publish-via-proxy.mjs` 用本地转发代理 +
> 真实 Cloudflare IP 解决，发布用它即可。

### 变更：并入 dsh-workbuddy-xdpool

现在**一个插件**同时提供：

- 账号池 / 模型池 / 签到 / 自动化（原 `dsh-workbuddy-xdpool`）
- 控制台 / 技能市场 / 积分统计 / 输入框技能选择器（本插件原有）

设置里是两张卡片（账号池 + 技能市场），但只装一次、只启用一次、只更新一次。
原先它们共用同一套账号发现、同一个账号池、同一个 web server，
分成两个插件只会带来两个开关和两份要同步的配置。

### 第三方代码

`dsh-workbuddy-xdpool` 的运行时代码原样并入 `vendor/xdpool/`
（MIT，Copyright (c) 2026 XDTrees，上游 <https://github.com/XDTrees/dsh-workbuddy-xdpool>）：

- **未修改一行代码**，便于日后与上游对照升级
- `vendor/xdpool/LICENSE-ORIGINAL` 保留原作者声明
- 许可、归属与升级方法见 `THIRD-PARTY.md`

### 实现要点

- 宿主侧：`lib/index.js` 的 `apply` 先转发给 vendored 实现
  （负责 provider 与账号池），再挂自己的路由；卸载时两半都会释放
- 浏览器侧：vendored 的 `client.js` 以字符串常量内联进本插件的 bundle
  （`scripts/gen-xdpool-client.mjs` 生成），执行一次并转发它的 `apply`，
  于是账号池那张卡片也归本插件注册
- `vendor/xdpool` 需要 peer 依赖（`@deepseek-ai/schemastery` 等），
  而它位于源码目录、向上找不到 `node_modules` ——
  `scripts/link-vendor.mjs` 建 junction 解决，安装器会自动调用
- `lib/tasks.mjs` 改为优先用仓库自带的 vendor 副本

### 测试

- `run-all.mjs` 跑测试前会自动重新生成内联块，避免 vendor 更新后忘了生成
- `run-all.mjs` 复制 `vendor/` 到测试目录（原先漏拷导致 3 个测试崩溃）
- 新增 `merge-pool-test.mjs`：在真实 Chrome 里确认**两个设置卡片都注册成功**
- 204 项全绿

## [1.4.6] - 2026-10-02

### 修复

- **「使用」技能真正生效。**

  实测宿主对 `conversation.input.left` 的 `renderSlot` 传**空 props** ——
  `command()` 永远是 undefined，v1.4.5 的调用路径从未生效。

  现在改为 **DOM 方案**：从页面找输入框（textarea 优先、contenteditable
  其次，取视口最底部的一个），把 `/技能名` 写进去（React 受控组件走原生
  setter + input 事件），再模拟回车提交。等价于用户手打 `/技能名`，
  走 DSH 原生的用户显式技能调用（技能正文会作为 instructions 注入对话）。
  宿主将来若真的暴露 `command()`，仍优先走它。

- **弹层与设置页跟随主题。**

  新增 `detectTheme()`：读 `data-theme`/class 标记 → body 背景色亮度 →
  系统偏好，逐级回退。所有 UI（设置页、选择器浮层、按钮、提示）分
  `dsh-wbc-light`（白底深字）与 `dsh-wbc-dark`（深底浅字）两套配色，
  打开弹层时重新检测。

### 测试

- `mount-browser-test.mjs` 增至 5 项：新增主题检测双向断言
  （dark 标记→dark、light 标记→light）、
  「使用」写入 `/demo-skill` 到输入框、Enter 已派发。
- 测试 204 项全绿。

## [1.4.5] - 2026-10-02

### 修复

- **选择器「加载失败：installedSkills is not defined」。**

  v1.4.4 的一次死代码清理把 `installedSkills` 的定义连同相邻行一起删了，
  但调用还在 —— 技能选择器一打开就崩。已恢复数据函数
  （`installedSkills` / `listSkills` / `installSkillApi` / `uninstallSkillApi`），
  并补了防回归断言。

- **设置页按需求改为「只显示技能市场」。**

  上一版用 iframe 嵌了整个 `/wb-console/` 控制台页（账号池、签到历史都在）。
  现在换成**原生 React 市场组件**：搜索 / 分页 / 安装 / 重装 / 卸载，
  自动加载首页，不再嵌套页面。完整控制台仍走 `/wb-console/`。

### 测试

- 新增 `mount-browser-test.mjs`（5 项）：在**真实 Chrome** 里加载
  React UMD、执行 bundle、挂载三个组件、跑完 effects，
  断言市场技能名、总数统计、⚡ WorkBuddy 按钮实际出现在 DOM 里。
  这取代了只能看空壳的 renderToString 方案。
- 测试 204 → **203 项**（SSR 测试被更强的挂载测试取代），
  全绿；数据桩隔离，不碰真实凭证。

## [1.4.4] - 2026-10-02

### 修复（真正的根因）

- **设置页与输入框按钮空白：jsx() 的 children 被当成 key 丢掉了。**

  前几版把 child 当作 `jsx(type, props, child)` 的第三个参数传。
  但 jsx-runtime 的签名是 **`jsx(type, props, key)`** ——
  第三个参数是 key，children 必须放在 `props.children` 里。
  传错的 child 被静默丢弃，组件渲染成功但**输出为空**：
  设置页只剩一个空 div，按钮只剩一个空 Fragment。
  无报错、无边界触发、测试全绿 —— 因为没有一个测试真的渲染过组件。

  用真实 React（`react-dom/server`）渲染后当场证实：
  修复前 iframe/文本全部缺失，修复后完整输出。

- **新增 `render-real-test.mjs`（6 项）：用真实 React 渲染每个组件，**
  断言 iframe、按钮文本等实际出现在输出里。
  这类"渲染成功但内容为空"的 bug，今后会被当场拦住。

### 说明

前两版的 iframe 方案本身没错，错的是元素创建方式 ——
换成 iframe 只是掩盖了 jsx 契约问题。

## [1.4.3] - 2026-10-02

### 变更

- **设置页改为 iframe 嵌入 `/wb-console/`。**

  v1.4.2 之后设置页仍然空白。原因不在注册（导航项已出现，apply 成功），
  而在 `settings.section` 的归属渲染器（`PluginsSettingsSection`）对自己
  inject face 的隐含要求——第三方组件怎么对齐都会踩到看不见的约束。

  与其继续和一条**无法直接观察**的渲染链路对抗，不如换成能保证工作的：
  直接在设置页里 iframe 嵌入 `/wb-console/?embed=1`。
  同源（同在 127.0.0.1:<DSH端口>），fetch/凭据照常。
  那条链路已被这个项目反复验证可用。

  代价：设置页里是嵌套页面，不是原生控件。
  收益：**它一定会显示**；加载失败会显示明确提示而不是空白。

- 输入框按钮的可见性说明（见 1.4.2）：`conversation.input.left`
  只在有会话 id 时渲染，全新空会话不显示 —— 属于 DSH 插槽契约设计。

### 工程清理

- 移除换成 iframe 后不再被引用的客户端代码（列表/安装/卸载 UI）
- 一次自写的死代码清理脚本截断了函数，已修复并验证
  （教训：文本级重构必须跑语法检查）

## [1.4.2] - 2026-10-02

### 修复

- **设置页空白：自己注入的 face 让宿主渲染器崩溃。**

  我给 `settings.section` 注册时带了 `inject: () => ({ t })`。但这个插槽的
  归属渲染器 `PluginsSettingsSection` 期望的 inject 里是 **`hooks.tabs`**，
  自己塞一个只有 `t` 的 face 会让它解构出 undefined 而渲染崩掉 ——
  页面表现为空白，没有任何报错。

  现在改为对齐可工作的参照（`dsh-our-free-model`）：
  - 去掉自定义 `inject`
  - 注册 meta 上带 `locale: NS`（渲染器按命名空间取文案）
  - 组件以 `(props) => SkillsSection({...props, t})` 的形式包一层

- **样式改为 apply 时注入**，不再依赖组件挂载。
  之前若组件渲染阶段抛错，样式永远不会进来，进一步加重"空白"观感。

- **每个组件包了错误边界**：渲染抛错时页面会显示
  「技能市场渲染失败：<原因>」，不再是一片空白无提示。

### 说明（不是 bug）

**输入框的 ⚡ WorkBuddy 按钮只在"有对话内容"的会话里出现。**

读了渲染源码确认：

```js
input === void 0 || sessionId === void 0
  ? null
  : renderSlot("conversation.input.left", {})
```

`conversation.input.left` 挂在 `sessionId === void 0 ? null :` 的分支上 ——
**全新空会话的输入框没有会话 id，工具行不会渲染**。
这是 DSH 插槽契约（`scope: 'session'`）的设计，不是插件问题。
打开一个有消息的会话就能看到按钮。

## [1.4.1] - 2026-10-02

### 修复

- **严重：设置里的技能市场页与输入框按钮都不出现。**

  客户端 bundle 没有导出 `inject`，于是 cordis 不注入 `slots` / `locale`，
  `ctx.locale` 访问直接抛错，`apply` 整体失败：

  ```
  [workbuddy-console] client apply failed:
  Error: cannot get property "locale" without inject
  ```

  表现就是「什么都没出现」，且不报给用户 —— 只在 renderer 控制台可见。
  现在补上 `exports.inject = ['slots', 'locale']`（与 xdpool 一致）。

- **测试没抓住上面这个 bug。** 假 ctx 直接给了 `locale` 与 `slots`，
  没有复刻 cordis 的 inject 门禁，所以漏写 `inject` 也能全绿。

  现在假 ctx 用 Proxy 复刻门禁：**未在 `exports.inject` 里声明的 service，
  读属性即抛错**（与真实行为一致）。并验证过这个守卫确实有效 ——
  临时移除 `inject` 会让 6 个用例失败。

### 测试

- 从 196 项增加到 **198 项**
- `client-bundle-test.mjs` 增至 17 项，新增：
  「导出 inject 且包含 slots 与 locale」
  「apply 在 cordis 门禁下不抛错」
- 浏览器 E2E 同样加上 inject 门禁与断言

## [1.4.0] - 2026-10-02

### 新增

- **输入框技能选择器**：对话输入框左侧的 ⚡ WorkBuddy 按钮，点开列出已安装技能，
  点「使用」即在当前对话调用。
  - 调用走 DSH 输入框暴露的 `command(line)` 接口，等价于手打 `/<技能名>`
  - 宿主没暴露该接口时**如实提示**「无法自动调用」，不静默失败

- **DSH 设置页**：设置 → WorkBuddy 技能市场，可搜索 / 安装 / 卸载，
  不用切到控制台页面

- 客户端 bundle 从「只显示积分」扩展为三个注册：
  `conversation.input.left`（技能选择器）、
  `conversation.composer.dock`（本对话积分）、
  `settings.section`（技能市场页）

### 说明

DSH 内置的技能 UI（`dsh-client-ui-skill`）**只注册了 `tool.call.toolview`** ——
它只把技能工具的调用结果渲染成摘要行，**没有选择器**。
所以「选一个技能去用」是本插件新增的能力。

`dsh.client.inject` 相应补充了插槽归属包
（`ui-conversation`、`ui-settings`、`ui-settings-plugins`、`ui-primitives`），
否则运行时拿不到这些插槽。

### 测试

- 从 181 项增加到 **196 项**
- 新增 `client-bundle-test.mjs`（15 项）：用一个假的 `__ModuleLoader__`
  实际执行 bundle，断言注册了哪些插槽、每个注册是否合法、
  以及 `dsh.client.inject` 是否覆盖了这些插槽的归属包
- 新增浏览器 E2E：在真实 Chrome 里执行 bundle，确认零 JS 异常

## [1.3.1] - 2026-10-02

### 修复

- **测试会污染用户的真实数据。**
  `run-all.mjs` 没有给子进程设置 `WB_CONSOLE_DATA_DIR`，于是
  `credit-samples` 这类测试把假账号（`uid=a`）写进了用户真实的
  `~/.dsh/plugin-data/dsh-workbuddy-console/credit-samples.jsonl`。
  实测已经写进去 11 条。

  两层修复：
  1. `run-all.mjs` 给子进程注入临时数据目录
  2. `credit-samples.mjs` 增加写入守卫：`WB_CI=1` 且未显式指定
     `WB_CONSOLE_DATA_DIR` 时**拒绝写入**（生产运行不受影响）

- **重复采样导致采样密度虚高。**
  每次刷新页面会同时触发 `/api/overview`（自动采样）与
  `/api/credit/sample`（「刷新消耗」按钮），同一秒写入两条完全相同
  的记录。现在 `recordSample` 会去重：间隔 <3s 且**余额未变**时跳过；
  余额变了仍然记录（否则会漏掉真实消耗）。

- **`credit-samples-test.mjs` 的用例没有被 await**，导致测试实际跑了 0 项
  却显示「0 通过 0 失败」。测试的执行器改为 async 并补上 await。

### 测试

- 从 176 项增加到 **181 项**（新增去重 4 项、写入守卫 1 项）

## [1.3.0] - 2026-10-02

### 新增

- **WorkBuddy 技能市场**
  - 浏览 WorkBuddy 技能市场（实测 **10000+** 技能），支持关键字搜索
  - 一键安装到 `<DSH 根目录>/skills/<名字>/SKILL.md`
  - `dsh-skill-filesystem` 会 watch 该目录，**装完不需要重启 DSH**
  - 已安装的技能会标记出来，可重装或卸载

  实测确认技能包是标准结构，与 DSH 完全兼容，因此**不需要格式转换**：

  ```
  SKILL.md          YAML frontmatter（name/description/allowed-tools）+ 正文
  reference.md      可选参考资料
  scripts/*         可选脚本
  workbuddy.json    WorkBuddy 自己的元数据
  ```

  上游接口：
  `POST /v2/operation-platform/market/skill/list`（列表）、
  `.../skill/get-by-ids`（详情）、
  `.../skill/download-url`（下载地址）。

- 新增 `lib/skill-market.mjs` 与 4 条路由
  （`/api/skills/list`、`/installed`、`/install`、`/uninstall`）

### 安全

安装会往磁盘写文件，因此加了多重校验：

- **解压路径必须在目标目录内** —— zip 里的 `../` 或绝对路径会导致任意文件写入
- 技能名必须符合 DSH 的 kebab-case 规则（否则装了也不会被发现）
- 下载 ≤30MB、解压 ≤50MB（防 zip 炸弹）
- 先解压到临时目录再原子改名，失败不留半个技能
- 卸载只允许删 `skills/` 的直接子目录（双重路径校验）

### 测试

- 从 154 项增加到 **176 项**（新增 `skill-market-test.mjs` 22 项：
  路径穿越防护、frontmatter 解析、卸载边界、上游错误归一化）
- 浏览器 E2E 增加技能市场断言
- 另有一次真实端到端验证：从市场实装一个技能 → 校验 frontmatter 具备
  DSH 必需字段 → 确认重新扫描能识别 → 卸载

## [1.2.1] - 2026-10-02

### 修复

- **严重：插件会导致 DSH 无法启动。**
  `package.json` 声明了 `dsh.client` 却没有在 `exports` 里提供 `"./client"`，
  于是 DSH 在客户端组装阶段直接判定 required plugin 未激活并中止启动：

  ```
  client-modules: dsh-workbuddy-console declares dsh.client but exports no "./client" bundle
  ```

  现在补上 `"./client": "./lib/client.js"`。

- 新增 `test/manifest-test.mjs`（9 项）静态校验「声明 dsh.client 就必须有
  且能解析到 `./client`」，并把 `scripts/check-manifest.mjs` 作为安装前自检。
  这类错误在运行期完全看不出来，只有启动崩了才知道，必须在 CI 挡掉。

- `run-all.mjs` 漏拷 `cordis.patch.yml` 等根文件，导致 manifest 测试在
  runner 里出现假阳性失败。

## [1.2.0] - 2026-10-02

### 新增

- **积分消耗统计**：按余额差值统计「消耗」与「入账」，支持 24h / 7 / 30 天窗口，
  并给出按账号明细。
  - **消耗与入账分开累计**，不混为净值 —— 签到 +100 后又花 30，
    净值是 +70，但那不是消耗。这是本模块存在的主要理由。
  - 同一时刻的重复采样只取最后一条，避免并发采样造成抖动误算。
  - 每次打开页面自动采样；也可手动「刷新消耗」。
- **单次对话积分采集（默认关闭）**
  - 实测发现上游 SSE 的 usage 帧带 `credit` 字段，即该次请求的真实计费值
    （glm-5.3-flash → 0，glm-5.3 → 0.01，kimi-k3-1 → 0.08）。
    因此无需用 token × 倍率估算。
  - `lib/credit-meter.mjs`：SSE 解析 + 流旁听（字节原样透传，不改写）。
  - `lib/billing-proxy.mjs`：包在 xdpool shim 外的计费代理，**对 xdpool 零改动**
    （它装在 node_modules，改它会被升级覆盖）。
  - 默认不启用：它要求模型流量经过代理，会动到模型链路。
    需要时用配置项 `creditMeter: true` 开启。

### 改进

- 测试从 98 项增加到 145 项（新增 credit 19、credit-samples 15、proxy 13）
- 浏览器 E2E 增加消耗面板断言
- E2E 与截图改为共用 `test/mock-data.json`，避免两处各写一份 mock 而漏接口
  （此前正是因此导致 e2e 少了 `/credit/summary`）

### 修复

- `web/i18n.js` 里 `btn.history` 重复定义（对象字面量会静默取后者）

## [1.1.0] - 2026-10-01

### 新增

- **一键安装脚本** `node scripts/install.mjs`
  - 自动定位 DSH profile、注册插件、写入依赖，支持 `--dry-run` / `--profile` / `--uninstall`
  - 主动纠正常见的 `file:` 误用（那是拷贝语义，会导致改动不生效）
  - 幂等：反复运行不会产生重复的注册条目
  - 卸载会完整还原 `cordis.patch.yml`，且不触碰其它插件的配置
- **中英双语界面**（142 个文案 key），右上角可切换，语言记在 localStorage
  - `README.en.md` 英文文档
- **签到历史与趋势图**
  - 每次签到与打开页面自动记录本地快照（JSONL）
  - 折线图 + 每日涨跌，支持 7 / 30 / 90 天
  - 同一天同一账号只取最后一次快照，避免刷新页面导致重复计数
  - 保留 90 天 / 5000 条，自动裁剪
- **GitHub Actions CI**：Node 20/22/24 × Ubuntu/Windows，含字典同步与 README 链接校验
- `GET /wb-console/api/history`、`POST /wb-console/api/history/prune`、`POST /wb-console/api/history/clear`

### 改进

- 静态资源改为表驱动注册，新增前端文件只需改一行
- 测试从 65 项增加到 98 项
  - 新增 `i18n-test.mjs`（3）、`installer-test.mjs`（13）、`history-test.mjs`（16）
  - `check-test.mjs` 增加「无凭证时安全返回空数组」用例
- 测试可在无 DSH profile、无本机凭证的干净环境运行（`run-ci.mjs`）
- `e2e-i18n.mjs` 不依赖 DSH 即可验证前端，并新增折线图与涨跌标注断言

### 修复

- 英文界面下 `document.documentElement.lang` 仍为 `zh-CN`（影响屏幕阅读器）
- `taskRow(t)` 的参数名遮蔽了全局翻译函数 `t()`
- 安装器卸载时会在 `cordis.patch.yml` 留下注释残留
- 测试在无凭证环境下因 `readdirSync` 抛异常而整体崩溃，现改为干净跳过

## [1.0.0] - 2026-10-01

首个公开版本。

### 新增

- **账号池**：显示每个 WorkBuddy 账号的昵称、连签天数、今日签到状态、
  各积分包余额、冷却 / 保底状态。
- **一键全部签到**：批量遍历所有启用账号（串行 + 700ms 间隔防风控），
  逐账号汇报结果。xdpool 插件本身只有单账号签到接口，批量能力由本插件补齐。
- **未完成任务**：列出各账号的 growth 成长任务，区分「未完成 / 可领取」，
  带进度条与可获得的积分；达标的可一键领取。
- **账号检查**：逐个账号实时调上游验证登录态，区分
  「有效 / 已失效 / 无法确认」，并标出凭证来源（桌面端当前登录 / 历史快照）。
- **登录入口**：打开官网登录页、拉起 WorkBuddy 桌面版两个入口，
  不存储、不代填账号密码。
- **自动化任务**：展示 5 个任务（签到 / 活跃上报 / 任务奖励 / 连登奖励 / 猫咪旅行）
  的今日收益与计划时间，可手动「立即运行」。
- **模型池**：模型列表与积分倍率。
- 单账号操作：签到、启用 / 禁用、设置保底积分。
- 重扫账号、刷新模型目录、重置冷却。
- 诊断接口 `GET /wb-console/api/diag`，页面打不开时用于定位。

### 设计取舍

- 页面挂在 **DSH 自己的 webServer** 上（`/wb-console`），而不是独立进程，
  因此 DSH 一启动页面就在，不存在「拒绝连接」。
- 账号凭证始终由 `dsh-workbuddy-xdpool` 管理，本插件只读本机 auth 文件，不落盘、不外发。
- 前端静态资源每次请求重新读盘：改 HTML/CSS/JS 刷新页面即可生效。
- 所有 handler 包了错误可见层：出错时返回可读的错误页而不是空白 400。

### 已知限制

- **无法自动登录**：WorkBuddy 使用交互式浏览器 OAuth（Keycloak），
  登录必须由人在浏览器里完成。本插件只提供登录入口。
- **自动化总开关不在网页里**：xdpool 未开放该 HTTP 路由，
  启停与时间表仍需在 DSH 设置卡片中配置；网页可查看状态并手动触发单个任务。
- 依赖 `dsh-workbuddy-xdpool` 提供账号发现与上游调用；未安装时任务与模型池不可用。
