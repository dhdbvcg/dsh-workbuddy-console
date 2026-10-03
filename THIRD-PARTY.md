# 第三方代码与许可

本项目包含以下第三方作品。

## dsh-workbuddy-xdpool

- **来源**：https://github.com/XDTrees/dsh-workbuddy-xdpool
- **作者**：XDTrees
- **许可**：MIT（`Copyright (c) 2026 XDTrees`）
- **并入版本**：1.7.1
- **位置**：`vendor/xdpool/`

### 为什么在这里

原本是两个插件：`dsh-workbuddy-xdpool`（账号池 / 模型池 / 签到）与
`dsh-workbuddy-console`（控制台 / 技能市场）。两者共用同一套账号发现、
同一个账号池、同一个 web server，分成两个插件只会带来两个设置入口、
两个开关和两份需要同步的配置。于是合并成一个。

### 保留了什么

- `vendor/xdpool/LICENSE-ORIGINAL` —— 原作者的 MIT 声明，**请勿删除**
- `vendor/xdpool/lib/*` —— 运行时代码，**未做任何修改**，便于与上游对照升级
- `vendor/xdpool/README.md` —— 来源、目录说明与升级方法

### 怎么升级上游

1. 从 https://github.com/XDTrees/dsh-workbuddy-xdpool 取新版本的 `lib/`
2. 覆盖 `vendor/xdpool/lib/` 下的同名文件
3. 跑 `node scripts/gen-xdpool-client.mjs` 重新生成内联块
4. 跑 `node test/run-all.mjs` 确认没坏

### 其它说明

- 本仓库的 `LICENSE` 是本项目自身的 MIT（Copyright (c) 2026 dhdbvcg），
  **不覆盖** vendor 目录里第三方代码原有的许可。
- `vendor/xdpool` 下的代码不因本仓库的许可而改变其版权归属。
