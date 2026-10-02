# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
