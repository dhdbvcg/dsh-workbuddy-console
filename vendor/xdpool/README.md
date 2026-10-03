# vendor/xdpool —— 并入自 dsh-workbuddy-xdpool

- 上游：https://github.com/XDTrees/dsh-workbuddy-xdpool
- 版本：1.7.1
- 作者：XDTrees
- 许可：MIT（见 LICENSE-ORIGINAL）

## 为什么要并进来

原计划是让本插件只做「控制台 + 技能市场」，把「账号池 / 模型 / 签到」
交给 xdpool。后来决定把两者合成一个插件，于是把 xdpool 的运行时代码
整体搬到这里，代码**未做任何修改**，以便随时与上游对照。

## 目录

| 文件 | 说明 |
|---|---|
| `lib/index.js` | 宿主侧：账号发现、模型池、shim 服务、签到/任务 |
| `lib/client.js` | 浏览器侧：设置页的「XD Pool」卡片 |
| `lib/bin.js` | 命令行：`dsh-workbuddy-xdpool doctor` 等 |
| `lib/index.d.ts` | 类型定义 |

## 升级上游的方法

1. 从 https://github.com/XDTrees/dsh-workbuddy-xdpool 取新版本的 `lib/`
2. 覆盖本目录下的同名文件
3. 跑 `node test/xdpool-bundle-test.mjs` 确认没坏

## 许可

MIT 允许合并与再分发，条件是保留版权与许可声明 ——
`LICENSE-ORIGINAL` 即该声明，请勿删除。
