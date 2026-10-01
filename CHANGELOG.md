# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
