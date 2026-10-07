# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.40] - 2026-10-07

### 找到「Image request width must be a positive integer」的真正根因

这条报错从 2.0.31 起追了五轮都没解决，根因是**两边看的值不一样**：

宿主 `@deepseek-ai/dsh-attachment` 的 `requestImageDimensions()`：

```js
const scale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
if (scale === 1) return { width, height };   // ← 不需要缩放时**原样透传**
```

**图片不需要缩放时，宿主把 `ref.width/height` 原样返回，不做取整。**

于是只要附件引用上的尺寸是**非整数**（如 `1920.5`）或**字符串**（如 `"1920"`）：

| 环节 | 看到的值 | 判断 |
|---|---|---|
| 本插件（先 `Math.floor`） | `1920` | 安全整数 → **放行** |
| 宿主（原样透传） | `1920.5` | `Number.isSafeInteger` 不过 → **抛错** |

这解释了「代码改了、错误一字未变」：我一直在改**判定**，但两边看的根本不是同一个值。

### 修法：把规范化结果真正写进一个新附件对象

`ref` 是冻结的（不能赋值），但**块可以换**：

```js
const normalizeImageBlock = (block) => {
  const size = readImageSize(block.attachment);          // 取整后的安全整数
  if (block.attachment.width === size.width && ...) return block;  // 已合法，零拷贝
  return { ...block, attachment: { ...block.attachment, width: size.width, height: size.height } };
};
```

- 尺寸合法但非整数 → 换成带**整数**尺寸的新 attachment（新对象不冻结）
- 已经是整数 → 原样返回，保持零拷贝快路径（`changed=false` → 返回 `null`）
- 读不出尺寸 → 交给 `imageOk` 降级剔除

### 排查过程里的两次自我纠错

1. 上一轮我断言「适配器从未被调用」——**错的**。探针目录在
   `~/.dsh/.workbuddy-xdpool/`（`PLUGIN_DATA_DIR_NAME` 本身带点前缀，
   中间没有 `plugin-data` 段），我查错了地方。实际日志显示
   `messagesFound=true images=1` —— 适配器一直在工作。
2. 我一直用"手写的等价算式"验证 `requestImageDimensions`（那份算式**总是取整**），
   所以得出「小数没问题」的错误结论。直到读**真实实现**才看到
   `if (scale === 1) return { width, height }` 这条短路。

### 守卫

`test/image-size-normalize-test.mjs`（13 项）覆盖两条独立的错误：

- **冻结 ref 不能抛**（2.0.38 的事故）
- **非整数/字符串尺寸必须换成整数**（本次根因）

`scripts/prove-image-guards.mjs` 分别把代码改回这两种错误版本，
对应测试**立刻失败**（已实测），再逐字节还原。

### 测试

- 373 → **376 项**，全绿

## [2.0.39] - 2026-10-07

### 紧急修复：2.0.38 把每个带图请求都弄挂了

**2.0.38 是我的错，必须先说清楚。**

那个版本里我写了 `normalizeImageSize(ref)`，直接 `ref.width = ...` **就地写回**。
而 DSH 的附件引用对象是**冻结的**（read-only），赋值会抛：

```
TypeError: Cannot assign to read only property 'width' of object '#<Object>'
```

这段代码在图片净化的**热路径**上，于是**每一个带图请求都失败**，
用户直接在对话里看到「本轮运行失败 ...read only property 'width'」。

而且这个写回**从一开始就是多余的**：宿主的 `requestImageDimensions()`
内部会 `Math.floor`，小数尺寸它自己能处理。真正需要拦的只有
**尺寸缺失/非有限**这一种情况 —— 那种情况靠"丢弃这张图"就能解决，
根本不需要改动对象。

### 修法

把 `normalizeImageSize(ref)`（会写）换成 `readImageSize(ref)`（只读）：

```js
function readImageSize(ref) {
  // …只读取 + 计算，绝不赋值
  return { width: Math.max(1, Math.floor(rawW)), height: Math.max(1, Math.floor(rawH)) };
}
```

- 不碰 ref → 冻结对象也不会抛
- 外层再包 `try/catch` → 连带 getter 的怪对象也安全
- `imageOk` 用它的返回值判定，口径仍是 `Number.isSafeInteger`（与宿主一致）
- 判不出来 → 返回 `false`，交给降级路径给用户「图片未发送」的明确说明

### 守卫（这次是给我自己写的）

`test/image-size-normalize-test.mjs` 把「冻结对象不能抛」作为一等公民：

- `readImageSize` 对冻结对象不抛
- `downgradeUnsupportedImages` 对冻结 ref 不抛（端到端）
- 冻结 ref + 坏尺寸 → 走降级（不抛、不把坏尺寸送出去）

并附 `scripts/prove-frozen-ref-guard.mjs`：把代码改回"写回"版本，
该测试**立刻失败**（已实测）。这条守卫就是防止我再犯同一个错。

### 关于「Image request width must be a positive integer」

这条原始报错**仍未定位到确定根因**。已排除的：

- 不是预算字段名问题（`requestImagePixelBudget` → `maxPixels` 映射正确，值也在）
- 不是"模型不支持图片"（17 个模型里 16 个支持，启用的 4 个都在 `imageModelIds` 里）
- 不是小数尺寸（宿主 `requestImageDimensions` 内部会取整）

现在有了 `readImageSize` 的严格判定，**尺寸确实无效的图会被降级拦下**
（用户看到「图片未发送」而不是上游报错）。若仍出现那条报错，
说明尺寸在插件判定之后、宿主使用之前被改动 —— 属于宿主侧行为。

### 测试

- 372 → **373 项**，全绿

## [2.0.38] - 2026-10-05

### 修复：粘贴截图后点发送报「Image request width must be a positive integer」

现象：输入框里能看到缩略图，点发送**立刻**失败，图片一张都没发出去。

#### 根因：两处校验强度不一致

| 环节 | 校验 | 对"尺寸有问题"的处理 |
|---|---|---|
| 本插件 `imageOk` | `Number.isFinite(w) && w > 0` | **宽松** → 放行 |
| 宿主 `validateTarget` | `Number.isSafeInteger(w) && w > 0` | **严格** → 抛错 |

链路是：`requestImageTarget(ref, budget)` 用 `ref.width/height` 算出尺寸
交给宿主，宿主校验不过就抛错。中间这道宽松检查放行了坏尺寸，
错误一路带到上游才炸，用户只看到「本轮运行失败」。

#### 排查中修正的一次误判

一开始我推断是"尺寸存成了浮点数"，但实测 `requestImageDimensions`：

```
1920.5 x 1080.4 -> 1920 x 1080   （内部 Math.floor，合法）
undefined       -> {}            （只有这个才报错）
```

所以**不是小数问题，是尺寸缺失/非有限数**。这点必须写清楚，
否则后来人会照着错误结论去改。

#### 修法：判定前先规范化尺寸

在 `imageOk()` 里、判定之前调用 `normalizeImageSize(ref)`：

- 已是安全正整数 → 保留
- 有限小数 → 取整
- 缺失/非法 → 置为 `undefined`，交给降级路径给用户
  **明确的「图片未发送」提示**，而不是一句上游报错

并且把 `imageOk` 的判定也收紧成 `Number.isSafeInteger`，与宿主同口径。

#### 实现中的一个坑（被测试抓到）

最初我写了"只有一边有尺寸就按 1:1 补齐"，结果 `width=0, height=1080`
被补成 `1080x1080` 从而**放行** —— 这正是同一类错误（掩盖坏尺寸）。
改为：**一边不合法就整张判定不可用**。

#### 守卫

`test/image-size-normalize-test.mjs`（9 项），覆盖：正常整数、有限小数、
完全缺失、`width=0`、负数、`NaN`、`Infinity`，并断言规范化后能过宿主校验。
已加入 `run-all` 与 `run-ci`。

### 测试

- 363 → **372 项**，全绿

## [2.0.37] - 2026-10-05

### 修复：兜底探针位置错误 —— 自己制造的观测盲区

v2.0.35 把 `shim-requests.log` 的写入放在 **bearer / Host / Origin 校验之后**。
于是任何被 401/403 拦掉的请求**完全不留痕迹** —— 看起来就像「请求根本
没到达 shim」，从而把排查引向错误方向。

**探针必须放在最靠前的位置，早于一切可能提前 return 的分支。**
这是通用原则：只要探针前面还有 `return`，观测就是有条件的、会骗人的。

修正后：

- 写在 `handle()` 开头的第一步（早于所有校验）
- 用 `res.on("close")` 记录**最终状态码**，并在 `writeHead` 上取值
- 一并记录 `host` / `origin` / `hasAuth` / 耗时 —— 这样「到了但被拒」
  与「根本没到」能一眼区分

### 本地验证（真实 shim，不是假对象）

起了真实的 `createWorkBuddyShim`，打两个**无鉴权**请求（预期被 401 拦掉）：

```
2026-10-05T05:41:27.907Z POST /v1/chat/completions status=401 host=127.0.0.1:63473 origin=- hasAuth=n ms=23
2026-10-05T05:41:27.947Z GET  /healthz              status=401 host=127.0.0.1:63473 origin=- hasAuth=n ms=6
```

被拒的请求也留痕，盲区消除。

### 附带发现

无 `Authorization` 的请求会被 401 拦掉（鉴权是强制的）。若 pi-ai 因故未带上
正确 bearer，请求会止步于此并报 `missing or invalid Authorization bearer`
—— 那与当前的 width 错误不同，可据此区分两种失败。

## [2.0.36] - 2026-10-05

### 修复：块上元数据完好、但附件文件已丢失的图片（第五层）

用户换模型对照（Space-Bunny → DeepSeek V4.1 Flash）后错误不变 ——
排除了「图像模型特有」的假设，同时说明问题与模型无关。

调用探针给出关键差异：`messages:2320 images=2` —— 请求**仍带 2 张图**，
但它们**没被降级**（`image-downgrade.log` 无新增）。原因是那 2 张图块上
`width/height` 完好，通过了 v2.0.34 的尺寸检查。

而实地核查 `~/.dsh/attachments/v1/files/` **只剩一个 txt** —— 截图原文件
早已被清理。**块上的元数据是陈旧的**：尺寸看着合法，pi-ai 去读文件却读不到，
上游照样报「Image request width must be a positive integer」。

### 修法：用宿主附件服务判定「文件是否真的可读」

`withToolImageDowngrade` 新增第 4 个参数 `isImageUsable(ref)`，由
`options.ctx.get("attachments").imageHostPath(ref)` 实现（返回 undefined
即文件不存在）。净化时两层检查缺一不可：

1. 块上 `width/height` 合法（pi-ai 靠它拼 `request preview WxHpx`）
2. **附件文件真的可读**（元数据可能陈旧）

判不出来（服务缺失/抛错）时按「可用」处理 —— 宽松方向，宁可让宿主报
它自己的错，也不要误杀用户刚发的图。

### 测试

- `test/tool-image-downgrade-test.mjs` 26 项：新增 1 项覆盖三种情形
  （文件不可读被剔除、判定器抛错按可用处理、未提供判定器行为不变）

## [2.0.35] - 2026-10-05

### 新增：shim 兜底请求日志（确认请求是否真的到达）

`upstream-request-shape.log` 与 `upstream-errors.log` 始终没被创建，
说明 `chatCompletions` 从未执行 —— 于是「请求是否到达 shim」从假设
变成了必须观测的事实。

新增 `shim-requests.log`：记录**所有**到达 shim 的请求（方法 + 路径，
含 query），位置在 Origin/Authorization 校验之后、路由匹配之前。

## [2.0.34] - 2026-10-05

### 修复：失效附件（缺尺寸）被剔除 —— 第四层

用户复现后实测：请求是 `messages:2311 images=2`，不是上一轮以为的 `images=0`。
漏看的是「保留窗口内 user 图」那一支 —— 它直接 `push` 原消息、**完全绕过降级**。

真因：图片块自带 `attachment.width/height`，pi-ai 据此拼出
「request preview WxHpx」发给模型（`requestImageHandleText`）。附件被清理后
这两个字段缺失或为 0，上游解析这句**说明文字**时报错。

修法：保留分支改为**逐块检查尺寸元数据**，无效的替换为
「[图片未发送：附件已失效]」；有效图照常走 pi-ai 附件路径。

### 流程反省（连续漏提交两次）

profile 是**链接**指向开发目录，因此「改完文件」不等于「运行中的 DSH 会跑新代码」
—— 未提交虽然文件已变，但一旦我以为「已提交」就会误判排查结果。
v2.0.33 与 v2.0.34 连续两次改完忘记提交，均已在后续补上。

## [2.0.33] - 2026-10-05

### 诊断：把「Image request width must be a positive integer」定位到上游

v2.0.31 已生效（调用日志显示 694 张图全降级、请求里 `images=0`），但这句错误
仍在界面上。这轮做的是**穷尽式排除**，把不可能的地方全部划掉：

| 搜索范围 | 结果 |
|---|---|
| 插件代码 | 无 |
| `@earendil-works/pi-ai` dist | 无（连 `positive integer` 都没有） |
| app.asar 整包（115MB 逐字节） | 仅 1 次命中，且是**目录元数据**里的文件名，非代码 |
| npm 全局 `@deepseek-ai` 全部 2728 个 js | 无 |
| 本地 skills / plugins | 无 |

结论：**这句话由上游 WorkBuddy 网关运行时生成**。本地无从得知是哪个请求
触发的 —— 而请求里的图片数已经是 0。

### 新增：上游失败现场记录

`upstream-errors.log`：shim 每次拿到上游非 2xx 时记一行
（时间 / 模型 / 账号 / 错误种类 / HTTP 状态 / 上游原文截断），配合
`upstream-request-shape.log`（请求结构），下次复现即可对齐
「哪个模型、什么状态码、上游原话」。

### 教训

**排除法也有价值，但必须有终止条件。** 前三轮都在「代码里找那句话」，
而它根本不在代码里。真正有效的一步是承认「这句话来自我控制范围之外」，
转而记录**边界上的数据**（发给上游的请求 + 上游返回的错误）——
观测点应放在系统边界，而不是内部实现。

## [2.0.32] - 2026-10-05

### 新增：上游请求结构探针 + 探针轮换

shim 侧记录发往上游的请求**结构**：顶层键名、数值型字段、content 部分的类型
直方图，以及递归找出的所有 `width`/`height`/`size`/`resolution` 字段及其值。
**只记结构不记内容** —— 正文可能含用户私密对话。

同时修探针自身缺陷：调用日志已 397 行、最后一条停在 00:39，而用户 09:04 复现
时它早已失声（重试每 10 秒一次就烧完配额）。改为写满即轮换（保留最近 200 行），
保证文件里永远是「最近发生过什么」。

## [2.0.31] - 2026-10-05

### 修复：上游拒绝历史旧图（`Image request width must be a positive integer`）

v2.0.29 生效了 —— 调用级探针 + 降级日志双双证实：

```
image-downgrade.log:  model=hy4-preview images=1 sites=toolx1@depth1
adapter-invocations.log:  prepareCall.<returned>.stream(object(messages:2057)) images=25
```

工具图降级成功、请求首次真正到达上游。但 25 张**保留的 user 历史图**里有一张
被上游网关拒绝：`Image request width must be a positive integer`（该错误文本
不在任何本地包里 —— 来自上游，旧附件的尺寸数据已失效/文件已不可解析）。

### 修法：只保留最近几条消息里的 user 图片

`downgradeUnsupportedImages` 新增 `keepLastMessages`（默认 3）：更早消息里的
图片一律降级。产品依据：**12 天前历史里的截图对当前对话几乎没有价值**，
而用户最近发的截图才是真正要保的；与其逐张排查 25 张旧附件哪个坏了，
不如只保窗口内的。

- 窗口内的 user 图照常走附件服务（pi-ai 受支持路径）
- 窗口外的 user 图降级，带「图片未发送」说明
- tool / assistant 图照旧全量降级

### 教训

这一层的修复是**顺着上一层的成功**找到的：请求通到上游之后，暴露的才是
下一层的问题。分层剥洋葱时，每修好一层就立刻复测一次，别指望一次修完。

## [2.0.29] - 2026-10-05

### 修复：净化被 `prepareCall` 整条绕过 —— 调用级探针定位到的真正入口

v2.0.28 的调用级探针立功了。用户复现后读
`~/.dsh/.workbuddy-xdpool/adapter-invocations.log`，铁证如下：

```
23:22:00 imageRequestPricing(string, string)
23:22:00 resolveModel(string, string, object)
23:22:00 prepareCall(string, string, object)   ← 用户发消息的时刻
（之后没有任何 stream 调用）
```

宿主的流式请求**不经过 `adapter.stream`**，而是：

```
prepared = await adapter.prepareCall(provider, model, signal)
// prepared = { model, stream: (options) => streamWithSnapshot(options, snapshot) }
await prepared.stream({ provider, model, messages })   ← 消息走这里
```

`stream` 是 `prepareCall` **内部创建的闭包**，直接指向 `streamWithSnapshot`
—— 我之前包的「方法层」被整条绕过，所以净化从未生效、探针（只在降级时写）
从未落盘。前三轮修的（嵌套形状、调用形状、真实库）都对，但全被这一层绕过。

### 修法

代理的方法包装现在会检查**返回值**：
- 返回 Promise<普通对象> → 等待后把对象上的**函数属性也包一层净化**
  （`prepareCall` 正是这种）
- 返回普通对象 → 同上
- 返回其它（AsyncGenerator、数组等）→ **原样放行**：
  展开生成器会弄丢内部状态导致迭代失效，数组展开成普通对象也会破坏形状

### 验证

- **宿主真实路径**（`prepareCall` → 返回的 `stream`）+ 真实嵌套形状 →
  请求到达 shim、请求体无图片、含降级说明
- 新增端到端测试锁住这条路径（此前所有端到端都走 `adapter.stream`，
  而宿主根本不这么调 —— 这就是测试全绿但真机报错的原因）

### 教训

**给不属于自己的接口包代理前，必须先用探针确认真实调用路径。**
我连续三轮都在给「想象中的入口」加固，而真实入口是返回值里的闭包 ——
探针（记录每次调用与方法名）一轮就把它钉出来了。如果第一轮就有探针，
这个 bug 早就修完了。

## [2.0.27] - 2026-10-04

### 新增：图片降级探针（把「实际发生了什么」变成可读文件）

图片降级已经连错三轮（顶层 vs 嵌套、调用形状、真实库与 app.asar 不同），
每一轮都要靠读源码反推宿主到底传了什么。这次把猜测换成证据：

每次**真的发生降级**时，往 `~/.dsh/.workbuddy-xdpool/image-downgrade.log`
追加一行，记录：

```
2026-10-04T13:06:07.058Z model=hy4-preview images=1 sites=toolx1@depth1
```

- `model` — 触发的模型 id
- `images` — 丢弃总数
- `sites` — 每条消息的 `role x 图片数 @ 图片所在层级`
  （`toolx1@depth1` = 一条 tool 消息、1 张图、嵌在第 1 层即 tool-result 内）

有了它，下一轮再出问题**读文件即可**，不用再翻源码猜形状。

设计约束：
- **只在真降级时写** —— 正常会话零开销、无文件增长；无图那次调用不写
- 超过 256KB 自动轮换（只留最后 64KB），不会无上限增长
- 写入失败被 try/catch 吞掉 —— 探针绝不能反过来弄坏请求
- `sites` 里的层级信息正是本插件连错三轮的关键（第一版只扫顶层 depth0）

### 测试

- `test/tool-image-downgrade-test.mjs` 22 项：新增 1 项锁住探针行为
  （无降级不写文件、降级写且只写一行、记录 model / images / role+层级）
  —— 用**子进程**跑：本模块已在当前进程 import 过，同进程内改 `DSH_HOME`
  的生效时机依赖插件内部读 env 的那一刻，断言不可靠（在这上面踩过一次）
- `dropped` 计数断言改为按字段比对：新增 `sites` / `model` 字段后，
  整体 `deepStrictEqual` 会因多出的字段而失败

## [2.0.26] - 2026-10-04

### 修复：图片嵌在 tool-result 里，净化器漏掉了（这才是真正的根因）

v2.0.25 改对了调用形状，但**仍然没修好** —— 真正的根因在另一层。

关键发现：插件运行时解析到的 `@deepseek-ai/dsh-llm-pi-ai` 是 **npm 全局安装的
DSH 0.1.5-rc.3**（不是 app.asar 里那份，两份代码不同）。它的判定是**递归**的：

```js
function contentHasImage(content) {
  return content.some((block) => block.type === "image"
    || block.type === "tool-result" && contentHasImage(block.content));
}
```

即真实会话里工具结果的形状是
`{ role: "tool", content: [{ type: "tool-result", content: [ …, {type:"image"} ] }] }`
—— **图片嵌在 tool-result 内部**。我的净化器只扫顶层 content，一个都没替换，
返回 null 原样放行，断言照抛。

我的测试之所以一直「通过」：造的假数据是**顶层**图片，而真实会话是嵌套的。
**端到端测试用了错的输入形状，等于没测。**

修法：`replaceImages()` 递归进任何带 `content` 数组的块，原位替换并保持外层
结构（`tool-result` / `toolCallId` 不丢）。

### 验证（用插件运行时实际解析到的那份库）

- 真实形状 + 真实库 → 请求到达 shim、请求体无图片、含降级说明
- **反向验证**：临时禁掉递归 → 立刻复现「shim 收到 0 个请求」，与用户故障一致

### 测试

- `test/tool-image-downgrade-test.mjs` 21 项：新增 2 项锁住嵌套形状
  （tool-result 内图片被降级且外层结构不变；多层嵌套与多个 tool-result 计数正确）

### 教训

**端到端测试的输入形状必须来自真实数据，不能凭想象构造。** 这次的假数据
「看起来很合理」，于是测试绿灯、真机继续报错 —— 比没有测试更危险。

## [2.0.25] - 2026-10-04

### 修复：图片降级对「非标准调用形状」静默失效（用户实测报障）

v2.0.23/24 上线后，用户重启 DSH 复测**错误一字未变**：
`UNSUPPORTED_CONTENT: pi.ai cannot represent an image in an in-history … message`。

逐条排除的假设：

| 假设 | 结论 |
|---|---|
| profile 里是陈旧拷贝 | **否** —— inode 与开发目录相同，是链接，version 2.0.24 |
| 插件入口没加载新代码 | **否** —— `lib/index.js` 静态 `import '../vendor/xdpool/lib/index.js'`，vendor 即开发目录 |
| 有第二份插件副本在生效 | **否** —— 全盘只有一份 2.0.24 |
| app.asar 版本变了导致断言不同 | **否** —— mtime 仍是 9/29，断言与之前读的一致 |
| 净化逻辑判断错了 | **否** —— 宿主 `contentHasImage` 就是 `content.some(b => b.type === "image")`，与净化器一致 |
| `new PiAiAdapter` 有多处构造、绕过包装 | **否** —— 全文件仅一处，且已包装 |

剩下的唯一解释：**净化器根本没被调用** —— 它只认「顶层参数上的 `messages`」，
而宿主实际调用适配器的签名不由我们决定。

改成 `sanitizeHistoryDeep()`：递归（深度 ≤6）扫描参数里的 `messages` 数组，
对任何签名 / 嵌套形状都成立。只修改本次调用中由我们复制出来的对象
（沿途容器浅拷贝），**不就地改写调用方的对象** —— 宿主可能复用同一个
options 对象。

教训：**当症状是「代码改了但行为一字未变」时，优先怀疑「那段代码根本没
被执行」，而不是「它执行了但算错了」。** 本次正是被「只认顶层 `arg.messages`」
这个隐含假设拖了很久。

### 测试

- `test/tool-image-downgrade-test.mjs` 19 项：新增 1 项锁住**三种调用形状**
  （`input.messages` 嵌套 / options 在第二参 / 顶层）都能拦到，
  且验证不就地修改调用方对象

## [2.0.24] - 2026-10-04

### 修复：不支持图片的模型上，用户自己发的图也会让整段会话报废

v2.0.23 处理了「历史工具结果带图」，但宿主还有**第二道**检查没过：
`containsImage && !model.input.includes("image")` → 抛
`pi-ai model … does not support image input`。它扫的是**所有**消息，
所以用户刚发的截图撞上不支持图片的模型，整段会话照样发不出去。

而本池子并非所有模型都收图 —— 卡片里每个模型都有独立的「图片输入」开关。
所以同一段带图的历史，换成不支持图片的模型还是 unusable。

改法：把图片降级改成**模型感知**。
`downgradeUnsupportedImages(messages, { allowUserImages })` 在
`withToolImageDowngrade` 里按 `catalog.find(modelId)?.supportsImages` 决定：

| 模型能力 | user 消息里的图 | 工具 / assistant 消息里的图 |
|---|---|---|
| 支持图片 | **保留**（pi-ai 受支持路径，走附件服务） | 降级为文字说明 |
| 不支持图片 | 降级为文字说明 | 降级为文字说明 |

两侧用不同措辞（`[图片未发送：当前模型不支持图片输入]` /
`[图片输出已省略（N 张）]`），避免「模型看不见图」变成没有线索的静默丢失。

判定不出来时（未知模型 id、解析失败）一律**按支持图片处理** ——
宁可让宿主报它自己的错，也不要在判定不出来时悄悄丢掉用户刚发的截图。

### 测试

- `test/tool-image-downgrade-test.mjs` 扩到 17 项：
  - 降级函数新增 3 项（不支持图片时 user 的图也降级、支持时保留、两侧措辞不同）
  - 代理新增 2 项（按模型能力分流、判定不出来时保守处理）
  - 端到端新增 1 项：**不支持图片的模型 + user 发了图** → 请求依然到达 shim，
    请求体无图片、且带「不支持图片输入」说明

### 审计：同一类「让会话彻底不可用的硬失败」其余两条

顺着 v2.0.23/24 的思路把宿主对请求内容的断言都过了一遍，另外两条的结论是
**不动**，理由一并记在这里免得重复排查：

- **`tool-addition` / `tool-removal`（工具变更块）**：pi-ai 完全无法表示
  （`Tool-change blocks require developer role`），但**官方 DeepSeek 适配器
  同样拒绝**（`DeepSeek Messages cannot represent tool-change blocks`），
  且 DSH 的会话格式要求这类块必须放在 developer 消息里 —— 所以这是 DSH 全局
  行为而非本插件缺陷。剥掉它会静默改变工具声明的语义，在没有真实复现前不该猜。
- **图片体积上限**（profile 的 `maxRequestImageBytes: 20MB`）：超限会抛
  `IMAGE_OFFLOAD_REQUIRED`，但 `dsh-compaction-image-offload` 会捕获该信号、
  自动降级最旧的图并重试 —— 是受支持的流程，不是死路，因此不设更小的预算。

### 静默降级改为可诊断

图片降级对模型是无声的（它只看到一行文字说明），用户若发现「模型怎么没看见
我的图」只能靠猜。现在每次降级会经 `ctx.logger.info` 记一行：丢弃总数、其中
来自 user 消息 / 来自工具历史各多少、以及当时的模型 id。无降级时不记日志。

### 修：降级代理破坏了 adapter 的 class 身份

图片降级代理会包裹 `PiAiAdapter` 的**每一个**方法，而它在真实宿主里作用于
**所有**请求 —— 不只是带图的。所以代理一旦在其它路径上出偏差，用户会看到
「模型选择器坏了 / 正常聊天也坏了」，而且只会在重启后才发现。

实测抓到一处：get 陷阱把 `constructor` 也当成方法包了一层，导致
- `wrapped.constructor === PiAiAdapter` 变成 **false**
- `wrapped.constructor.name` 变成**空串**（宿主里任何 class 身份判断、
  或拼错误信息用到它都会拿到错的东西）

已排除 `constructor` 不包。`instanceof` 与 `prototype` 本来就没被破坏
（Proxy 默认转发 `getPrototypeOf`）。

### 配套测试：A/B 对比代理前后的 adapter 行为

`test/adapter-proxy-safety-test.mjs`（新增 6 项）拿**真实的** PiAiAdapter
（不是假对象）做包装前后 A/B，方法面逐个跑、结果必须逐字相同：
class 身份、同步方法、模型方法（`listModels` / `resolveModel`，
含 UI 依赖的 `inputModalities`）、未知 provider/模型的失败路径、`prepareCall`，
以及插件真实 adapter 的 `providerInfo` / `listModels`。

（写测试时踩到：`modelInfo(snapshot, provider, model)` 是**内部**方法，
第一参是 snapshot，拿它做 A/B 会因签名不同而误报 —— A/B 要用公开入口。）

### 测试

- `test/tool-image-downgrade-test.mjs` 18 项：新增 1 项锁住日志计数
  （user 1 张 + 工具 2 张 → `{ images: 3, userImages: 1, historyImages: 2 }`，
  且无降级时不上报）

## [2.0.23] - 2026-10-04

### 修复：历史里有图片的旧会话切到 WorkBuddy 模型就发不出去

用户报告：一段旧会话（历史工具结果里带图）切到 WorkBuddy 模型后，整个会话
报 `UNSUPPORTED_CONTENT: pi.ai cannot represent an image in an in-history …
message`，完全无法对话。

**根因**：宿主 `PiAiAdapter.stream` 在调用 provider **之前**就把 DSH 历史转成
pi-ai 历史，`assertSupportedHistory` 遇到非 user 角色的图片块直接抛错。
官方 DeepSeek 适配器能表示这些图（转 handle + base64），pi-ai 不能 ——
所以同一段历史换官方模型没事，换本插件就死。

宿主没有留历史改写钩子，唯一能动的是 **adapter 边界**：新增
`withToolImageDowngrade()` 包住 `PiAiAdapter`，任何拿到 `messages` 的方法
在进宿主转换器之前，先由 `downgradeToolImageBlocks()` 把非 user 消息里的
图片块**原位替换**成一行文字说明（`[图片输出已省略（N 张）]`）。

取舍说明：
- **user 消息里的图片不动** —— 那是 pi-ai 的受支持路径（走附件服务），
  降级它等于白扔用户刚发的截图
- 连续多张图只留一条说明，避免刷屏
- 图片属于**旧上下文**，降级成一行文字远好于整段会话硬失败
- 净化只在真有图片时发生（快路径返回 `null`），正常会话零开销

### 测试

- `test/tool-image-downgrade-test.mjs`（新增 11 项）：
  - 降级函数：占位替换 / 仅图片时补说明 / assistant 图片 / user 图片不动 /
    无图为 `null` 快路径 / 混合消息保持引用 / 非法项不炸
  - 代理：宿主侧看到的是净化后的 messages、`this` 绑定正确、非方法属性透传
  - **端到端**：真 `PiAiAdapter` + 真 provider + 本地 HTTP 服务器当 shim ——
    断言请求真的到达 shim，且请求体里工具消息不再含 `image_url` / `data:image`
  - **反向验证**：关掉包装后立刻复现「shim 没收到任何请求」，确认测试非假信心

## [2.0.22] - 2026-10-04

### 修复：advertise `shigh` 的模型在 DSH 自带列表里丢「超高」档

用户要求把模型支持的思考强度做到 DSH 自带的推理等级列表里 —— 但对不上：
DSH 的「超高」叫 `xhigh`，上游线格式叫 `shigh`（同一个档位，都排在
high 和 max 之间，只是两套命名）。`thinkingLevelMap` 原来做精确字符串匹配，
于是 advertise `low / medium / high / shigh / max` 的模型在 DSH 里只剩
低 / 中 / 高 / 极致 4 档，而 WorkBuddy 客户端同一模型有完整的 5 档。

修法：上游只报 `shigh`（没有 `xhigh`）时，把 DSH 的 `xhigh` 映射到线值
`shigh`；上游真报 `xhigh` 时仍用原值；两者都没有时不凭空造档。

选「超高」时线上现在会发 `reasoning_effort: "shigh"`，上游按其 advertise
接受。Max 模式兜底不受影响（仍取最强档 `max`）。

### 测试

- `test/shigh-alias-test.mjs`（新增 7 项）：走**真实** `adapter.buildModels()`
  路径断言 DSH 可见档位阶梯与客户端一致（5 档）、真 xhigh 不被改写、
  无此档不造档、旧路径不回归、Max 模式兜底不受影响

## [2.0.21] - 2026-10-04

### 修复：模型卡片点保存要等好几秒才生效

用户报告：改完模型点保存，界面延迟好几秒才变；其它设置项没有这个问题。

**根因一（主因）：status 查询逐账号串行打上游**

`poolWebStatus` 对每个非冷却账号**串行** `await fetchCredits` + `await fetchCheckinStatus`
—— N 个账号就是 2N 次串行上游往返，每次几百毫秒，一轮 status 轻松好几秒。
卡片的挂载、30 秒轮询、保存后的刷新全走这一条路，上游一慢处处都慢。

改成每个账号的两项查询**并发**发出（`Promise.all`）：
一轮的耗时从「账号数 × 2 × 往返」降到「≈ 最慢一次往返」，不再随账号数线性变长。
单账号失败仍只影响自己那一行（`creditsError` / `checkinError`），语义不变。

**根因二：保存成功后不刷新 status**

卡片里其它写操作（切换调度策略、重扫账号、冷却重置…）都是写完立刻
`await refresh()`，唯独 `saveModels` 漏了 —— 保存后只能等最多 30 秒的下一轮轮询。
而且 `setDraft(void 0)` 会让界面回落到 `draftFromStatus(status)`，
用还是那份**旧** status，看起来就是「点了保存先弹回去，过几秒才变」。

现在保存成功后**先拉一次新状态、再丢草稿**，界面直接落到服务端真值上，
不再有「弹回旧值再等轮询」的过程。

**顺带：status 路由加在途去重**

同一区域的并发请求共享同一次在途查询（挂载 / 轮询 / 保存刷新撞在一起时
不再各自起一轮 2N 次往返）。缓存的是「这一次查询」而非结果本身，
不引入任何陈旧读 —— 保存后的刷新拿到的永远包含最新选择。

### 测试

- `test/status-latency-test.mjs`（新增 6 项）：并发峰值 > 1、4 账号 × 80ms 查询
  总耗时远小于串行、响应形状不变、单账号失败不波及他人、
  并发请求共享一次在途查询、查询结束后去重正确释放
- `model-row-browser-test.mjs` 增补：保存后 status 请求计数必须立即 +1

## [2.0.19] - 2026-10-04

### 新增：模型上下文选择 / Max 模式（思考强度交给宿主）

对标 WorkBuddy 客户端模型选择器里的控件，加到设置里的模型卡片
（原来只有「勾选启用 + 图片输入 + 两档上下文单选」）。

**1. Max 模式（新增区域级开关）**

对齐客户端同名开关：一个开关让所有模型都用满能力。
`catalog.visible()` 在打开时忽略 `contextBudgets`（窗口回到原生上限），
思考强度则取该模型 advertise 的最强档。

**3. 上下文档位选择（原有，保留并确认没被改坏）**

原本就有 200K / 原生上限两档单选，这次补了浏览器渲染断言防止回归。

**4. 思考强度：不加自己的选择框，用 DSH 自带的推理等级列表**

一开始在卡片里给每个模型加了一个「思考强度」下拉。后来发现是**多余的实现**：
DSH 自带的模型选择器里本来就有推理等级列表，而它是从 `thinkingLevelMap`
派生的（`getSupportedThinkingLevels`），已经精确到每个模型：

| 上游 advertise | DSH 列表显示 |
|---|---|
| `low` / `high` | 低 / 高 |
| `low` / `medium` / `high` / `max` | 低 / 中 / 高 / 极致 |
| 无 | 不显示（只有关闭） |

和 WorkBuddy 客户端完全一致（Hy4 preview 只有「高」、Hy3 有「低/高」）。

插件再放一个下拉会有三个问题：两套 UI 各说各话、插件那份永远追不上上游档位变化、
用户可能选了插件的却没意识到宿主的才是生效的那份。**所以删掉了卡片里的下拉**，
模型行只保留一行「思考档位：low / high」供对照，并加了 tooltip 指向宿主的选择器。

`reasoningEfforts` 配置项与 shim 注入逻辑（`applyDefaultEffort`）**保留**：
它们决定「用户没在宿主里选档位时的兜底」，Max 模式也依赖它取最强档。
卡片保存时仍会原样带回已存的值，不会因为不再编辑就抹掉。

### 配置新增字段

`modelSelectionCn` / `modelSelectionGlobal` 各多两个字段：

| 字段 | 含义 |
|---|---|
| `reasoningEfforts` | `{ [modelId]: 档位 }`，每模型默认思考强度 |
| `maxMode` | `boolean`，区域级 Max 模式 |

两个字段都做了校验（`parseSelection`）：非法档位名、非布尔值一律拒绝整个写入，
而不是存一个界面渲染不回来的值。

### 过程中被测试抓到的四个真 bug

- **改A 会不会把B 悄悄重置（隐蔽度最高）**：卡片保存时写的是 `maxMode: maxModeDraft`，
  而 `maxModeDraft` 的语义是「undefined = 本次没碰过这个开关，请沿用已存值」。
  但整段 selection 是**整体覆盖**的，宿主收到 undefined 会跳过该字段不写 ——
  于是用户只是勾了个模型点保存，**已存的Max 模式就被抹掉、自己关掉了**。
  其它字段不受影响是因为它们在卡片里是「从 status 整体重建」，
  只有 maxMode 走了「草稿叠加已存值」这条路。改成写合并后的 `maxMode`。
  补了 `save-preserves-untouched-test.mjs` 静态断言每个字段的值来源。
- **新字段根本没进设置文件**：`saveSelection` 是**手工逐字段构造payload**的，
  只有 `enabledModelIds` / `imageModelIds` / `contextBudgets` 三行。
  新加的 `reasoningEfforts` 与 `maxMode` 没人补那一行 → 被**静默丢弃**。
  表现是：界面能改、保存按钮会亮、不报任何错，但设置文档里根本没有那个值，
  重开卡片又变回原样。这类 bug 功能测试很难稳定抓到（要真跑一遍设置服务），
  所以补了 `selection-fields-test.mjs` 直接对齐五处字段名，并做了反向验证
  （把那两行删掉，测试确实失败）。
- **`topEffortFor` 返回了最弱档而不是最强档**：按 `SELECTION_EFFORTS` 正序找第一个
  命中项 —— 而这个数组是「由弱到强」的升序。加了反向遍历才符合 Max 模式的语义。
- **测试挂载错了卡片**：用 `/workbuddy/` 宽松匹配，结果挂到了技能市场上，
  模型区当然是空的。改成精确匹配 `workbuddy-xdpool`。
  另外假 status 少给 `ignored` / `creditReserves` 字段会让整页抛
  `Cannot read properties of undefined (reading 'length')` —— 与本次改动无关，
  但记下来免得下次再踩。

### 测试

- `test/model-effort-test.mjs`（新增 12 项）：目录侧的档位解析、Max 模式、
  陈旧配置丢弃、设置热切换
- `test/effort-pipeline-test.mjs`（新增 10 项）：**设置 → 请求体全链路**五环 ——
  schema 接受 → host 读取 → catalog 解析 → 写进请求体 → 显式档位不被覆盖
- `test/selection-fields-test.mjs`（新增 7 项）：schema / parseSelection /
  saveSelection / 卡片保存 / 卡片回显 五处字段集必须一致
- `test/save-preserves-untouched-test.mjs`（新增 9 项）：保存时不得抹掉用户
  没碰过的字段（断言每个字段的值来源是「整体重建」或「草稿 ?? 已存值」）
- `test/model-row-browser-test.mjs`（新增 9 项）：**真实 Chrome 里挂载模型卡片**，
  断言 Max 模式开关渲染、**思考强度下拉确实不存在**、模型行如实列出各模型档位，
  以及「只翻 Max 模式、一个模型都不改 → 点保存」真的写进设置且未触碰的档位没被冲掉
- 全量 **317 通过 0 失败**

### 顺带修的测试基础设施

`test/run-all.mjs` 的 `spawnSync` 原本**没有 timeout** —— 一个不退出的子测试
（浏览器测试里 Chrome 起不来、CDP 轮询空转）会把整个套件永久挂住。
实测挂过一次：25 分钟零输出，只能强杀。现已加 `timeout: 180_000` +
`killSignal: 'SIGKILL'`。

## [2.0.18] - 2026-10-04

### 修复：无法使用 workbuddy 的模型（模型列表空 / 选不了）

**根因**：provider 注册是异步的，且失败只写一行日志。

vendored 的 `apply()` 在 `Promise.all([cnShim.ready, globalShim.ready])`
的 `then` 里才向 `ctx.llm` 注册 provider。而它的 `apply()` 是**同步返回**
的 —— 也就是说宿主拿到 disposer 时，provider 还没注册。

于是 DSH 热重载时存在一个窗口：旧实例的 provider 已经进了
`ctx.llm.adapters`，但它的 disposer 因为 `apply` 还没返回而**没能被登记**。
新实例这时再注册同一批 provider：

- `registerAdapter()` 抛 `DUPLICATE_ADAPTER`
- `registerConfigurableProviders()` 抛 `DUPLICATE_DIRECTORY`

而 vendored 把整段包在 `try` 里，失败只 `ctx.logger.error`，并且 `finally`
里把**已经成功注册的三个一起撤掉**（all-or-nothing 语义）。

结果就是：插件显示「运行中」、控制台页面完全正常，
但 workbuddy 模型一个都没有 —— 而且原因只在日志里，从外面完全看不出来。

**修法**（`clearStaleLlmRoutes`）：转发 apply **之前**先按 provider id
清掉不属于本次的残留注册。只动 `workbuddy-xdpool` /
`workbuddy-xdpool-global` 两个 id，不碰别的插件，清了几条会打日志。

顺带加了两道防线：

- `watchLlmRegistration`：注册后主动确认 provider 真的进了 `ctx.llm.adapters`，
  12 秒内没进就把原因写进 `poolError`，`GET /wb-console/api/diag` 能直接看到
- diag 新增 `llm` 字段（registered / adapters / directory /
  workbuddyInAdapters），一眼能判断问题出在插件还是宿主

### 优化：继续降低点击延迟

在 2.0.17 的池状态缓存之上再压三处：

**1. in-flight 去重（`callPool`）**
缓存只能让「第二次以后」快。冷启动时前端并发拉 `/api/mode` 与
`/api/overview`，两者打的是同一个池 status —— 没有去重就打两次池，
而且两个请求在池那一侧排成队，第二个仍然要等第一个走完。
现在同一个 cache key 的并发请求合并成一个 Promise，池只被打 1 次。

**2. 前端并发（`web/app.js` 的 `load`）**
原来是 `await mode` → `await overview` 串行两次往返，
改成 `Promise.all` 并发发起。二次点击实测从 ~2.6s 降到 ~1.3s
（假池延迟 1300ms，见 `test/latency-bench.mjs`）。

**3. 任务列表 stale-while-revalidate（`/api/tasks`）**
逐账号拉成长任务实测 2.4~4.6s，是「点按钮要等好几秒」的主要来源。
原来只有 30s TTL 一层，30s 一过就又开始干等。现在加了 stale 窗口
（`max(TTL*10, 5min)`）：过期后先给旧数据 + `stale: true`，
后台悄悄刷新；前端看到 `stale` 会在 2.5s 后自动补拉一次，
用户最终一定看到最新状态，但点击永远是瞬时的。

另外清掉了前端 `/api/overview?credits=1` 这个遗留参数 ——
后端 overview 路由从来不读它，是个会误导后来人的死参数。

诊断信息：`poolCacheInfo()` 新增 `inflight` 与 `coalesced` 计数，
`WB_POOL_CACHE_MS` / `WB_TASKS_CACHE_MS` 可调（设为 0 即关闭缓存）。

### 测试

- `test/model-availability-test.mjs`（新增 7 项）：残留注册清理、
  不误删别的插件、清理有日志、无残留不造噪音、
  apply 先清后转发、diag 可读、llm 缺失时降级不崩
- `test/selftest.mjs` 新增 in-flight 去重断言
- `test/tasks-route-test.mjs` 新增 6 项 stale 判定断言（纯函数，不打网络）
- `test/latency-bench.mjs`（新增）：`npm run bench:latency`
  用假池量化优化前后耗时，验证并发不劣化墙钟、池只打 1 次、
  二次点击命中缓存 <200ms

两个修复都做了「反向验证」：把修复代码改成空实现后，
对应测试确实会失败（3 项 / 1 项），确认测试不是假信心。

## [2.0.17] - 2026-10-04

### 修复：点按钮要等好几秒

先把每个接口量了一遍（`scripts/time-endpoints.mjs`）：

| 接口 | 冷 | 热 |
|---|---|---|
| `/wb-console/api/tasks` | **4606 ms** | **2405 ms** |
| 池 `/status`（卡片主数据） | 1623 ms | 1287 ms |
| `/wb-console/api/overview` | 1258 ms | 1302 ms |
| `/wb-console/api/mode` | 1236 ms | 1338 ms |
| `/api/credit`、`/api/history`、页面 HTML | 7~20 ms | 7~20 ms |

**慢的全是要经过池的。** 在 vendored 的 `poolWebStatus()` 里找到了原因：

```js
for (const account of accounts) {
  if (!row.cooling) {
    const credits = await deps.client.fetchCredits(...);        // ← 每账号一次网络请求
    const checkin = await deps.client.fetchCheckinStatus(...);  // ← 每账号再一次
  }
}
```

**每次 status 都要对每个账号做两次网络往返**（3 个账号 = 6 次串行）。
而控制台刷新时 `load()` 串行拉 `mode` + `overview`，再加上 `tasks`
逐个账号去上游拉任务 —— 加起来 4~6 秒，就是「点按钮要等好几秒」。

（`tasks` 那边已经用了并发池，所以瓶颈是真实的网络 I/O，只能靠缓存。）

### 修法：两层缓存 + stale-while-revalidate

都在本插件自己的层里，**不动 vendored 代码**：

1. **池状态短缓存**（`callPool` 出口，默认 TTL 5s）
   - 只缓存 GET；**任何写操作立刻清空缓存**，所以不会「操作完看到旧数据」
   - 超过 TTL 但在 stale 窗口（30s）内：**先返回旧数据，后台再刷新**
     （stale-while-revalidate）→ 点按钮不再等网络，数据几百毫秒后自我更新
2. **任务列表缓存**（默认 TTL 30s）
   - 成长任务进度变化很慢，30s 完全够用
   - 领奖（`/api/tasks/claim`）与一键签到会立刻清掉它

可调：`WB_POOL_CACHE_MS` / `WB_TASKS_CACHE_MS`（设 0 即关闭）。
`/wb-console/api/diag` 里新增 `poolCache` / `tasksCache`，能直接看到
命中数、stale 命中数、后台刷新次数与是谁清掉的。

### 守卫

`selftest` 增加一项，用假池**数请求次数**：

- 第一次读 → 打池 1 次
- 紧接着再读 → 请求数不变（命中缓存）
- 发一个写请求后再读 → 必须重新打池（缓存已失效）

并实测有效：把 TTL 改成 0（等于关掉缓存）后该测试立刻失败。

### 测试

- 249 → **250 项**，全绿

## [2.0.16] - 2026-10-04

### 修复：转发给 vendored 的配置是空的（保存问题的最后一环）

2.0.15 之后设置层已经通了 —— 探针显示条目进了 settings 文档：

```
namespaces: [..., "llm-workbuddy-xdpool"]
exactMatch: true
formStatus: "ready"
formWritable: true
```

**但保存仍然不生效。** 继续查，发现是合并时写错了一行：

```js
const pool = xdpoolModule.apply(ctx, config.pool || {});   // ← 错
```

我们导出了 vendored 的 `Config` schema，所以**条目的 config 就是 vendored 的配置
本身**，字段全在顶层：

```yaml
config:
  modelSelectionCn: {...}      # ← 在顶层，不在 config.pool 里
  automationEarnings: {...}
```

`pool` 这个键根本不存在 → 实际传过去的是**空对象** → 后果：

- vendored 读不到任何设置 → `selection` 永远是 `{}`、模型永远"全部启用"
- 卡片把勾选**确实写进了设置文档**，但 vendored 读的是我们传进去的那份死配置，
  永远看不到变化 → 界面刷新后又变回原样
- 全程不报错 —— 这正是「取消勾选 → 保存 → 又变回勾选」的直接原因

**修法**：

```js
export function poolConfigFrom(config) {
  if (!config || typeof config !== 'object') return {};
  return config.pool && typeof config.pool === 'object' ? config.pool : config;
}
// …
const pool = xdpoolModule.apply(ctx, poolConfigFrom(config));
```

保留 `config.pool` 的兼容分支，万一将来把池配置收进子对象也还能用。

### 守卫

`selftest` 增加一项，同时检查**函数行为**与**调用点接线**：

- `poolConfigFrom({modelSelectionCn})` 必须原样返回（不能变成 `{}`）
- `lib/index.js` 里必须是 `xdpoolModule.apply(ctx, poolConfigFrom(config))`

第二项是必要的：只测函数体的话，把调用点改回 `config.pool` 测试照样通过
（已实测）。加上接线检查后，改回旧写法立刻失败。

### 测试

- 248 → **249 项**，全绿

## [2.0.15] - 2026-10-04

### 修复：模型勾选保存不了（真正的根因）

2.0.12 的探针在正确时机采到了决定性数据：

```
viewReady: true
namespaces: ["session-log-deepseek","agent-default-model","llm-pi-ai","permission",
             "ui-theme","locale","ui-settings", ...]     ← 21 个条目
exactMatch: false        ← 但【没有 llm-workbuddy-xdpool】
formStatus: "unavailable"
```

**我们的条目根本没被登记进 settings 文档。**

在 `dsh-settings` 里找到了那道关卡：

```js
function volatileForm(schema) {
  if (schema.meta.volatile) return plainSchema(schema);   // 只认 volatile 字段
  if (schema.type === "object") { ...递归... }
  // 都不是 → undefined → 这个条目被丢掉
}
```

而 vendored 的 `Config` 用 `asVolatile()` 包装字段：

```js
function asVolatile(schema) {
  return typeof schema.volatile === "function" ? schema.volatile() : schema;
}
```

**只要插件解析到的 schemastery 没有 `.volatile()`，`asVolatile` 就退化成空操作**
→ 没有任何 volatile 字段 → 条目进不了 settings 文档 →
账号池卡片拿不到可写作用域 → 「取消勾选 → 保存 → 又变回勾选」，**且不报任何错**。

### 为什么解析到了没有 `.volatile()` 的那份

`link-vendor.mjs` 原先建的是**一个整目录 junction**，只能整体选一个源：

| 位置 | schemastery | `.volatile()` |
|---|---|---|
| desktop profile（插件所在） | 3.18.4（与宿主一致） | ✅ 有 |
| 共享区 `profiles/node_modules` | 3.18.2（另一个全局 dsh 带进来的） | ❌ 没有 |

desktop **缺** `dsh-llm`/`dsh-settings`，共享区四个都全 ——
`covers()` 于是选了共享区，把 schemastery 一起带错了。

### 修法：按包逐个选源

`link-vendor.mjs` 重写为：

1. 每个包单独选源，**插件所在 profile 最优先**（与宿主版本一致）
2. 缺的包再去共享区补
3. **schemastery 额外要求「真的支持 `.volatile()`」**，否则换下一个源
4. 依赖清单改为**从代码提取**（手写清单曾漏掉 `@deepseek-ai/dsh-llm-pi-ai`，
   按包链接后那个包解析不到，vendored 模块直接 import 失败）
5. 能力检查走**子进程 + 动态 import**：那份 schemastery 可能是 ESM，
   用 `require()` 会抛 `ERR_REQUIRE_ESM` 而被误判成「不支持」

修复后实测：

```
链接处 schemastery .volatile : yes
Config 字段 meta.volatile    : 12/12 全部 true     （修复前：全部 falsy）
模拟宿主 volatileForm(Config): 生成 12 字段表单      （修复前：undefined）
```

### 守卫

- `test/volatile-schema-test.mjs`（8 项）：直接问「Config 的字段是不是 volatile」，
  并模拟宿主的 `volatileForm()` 判定
- `test/link-vendor-test.mjs` 重写：不再断言「移走链接就解析不到」
  （在 profile 下跑测试时父级本来就能提供，那条断言会误报），
  改为断言**解析到的那份 schemastery 必须支持 `.volatile()`**
- `scripts/prove-volatile-guard.mjs`：把链接换成错误的那份，实测两个守卫都会失败

### 测试

- 239 → **248 项**，全绿

## [2.0.14] - 2026-10-04

### 诊断补全：采 `status`，并纠正一处误读

读了 `dsh-client-ui-settings` 里 `ConfigFormController` 的实现，发现两件事：

```js
constructor(...) {
  this.store = createSnapshotStore({
    status: persistence === "host" ? "loading" : "unavailable",
    writable: false,            // ← 初始就是 false
    mode: persistence,
  });
}
derive() {
  const mirrored = this.mirror.getSnapshot();
  if (mirrored.view === undefined) return;   // ← view 没加载就什么都不做
  const { writable } = mirrored.view;        // ← writable 取自 describe view 顶层
  const view = mirrored.view.namespaces.find((c) => c.ns === this.spec.namespace);
  if (view === undefined) { /* status = "unavailable" */ return; }
  ...
}
```

1. **`writable: false` 很可能只是初始的 `loading` 状态** —— 我又测早了。
   真正要看的是 `status`（`loading` / `unavailable` / `ready`），
   而 2.0.12 的探针**没有采它**。本版补上 `formStatus` / `formMode` / `viewReady`。
2. **纠正一处误读**：`forms.get(entryId)` 是**惰性创建**的 ——
   对任何 id 都返回一个表单控制器。所以 2.0.12 里
   `formFound: true` **不能证明命名空间存在**；真正的信号是
   `view.namespaces` 里有没有它。

### 测试

- 239 项，全绿

## [2.0.13] - 2026-10-04

### 诊断加强（保存问题仍在）

2.0.12 的探针拿到了第一份真实数据：

```
hasConfigForms: true
namespaces: []
formFound: true
formWritable: false      ← 只读
hasSettingsScope: false
```

也就是说：**配置表单确实生成了（2.0.11 导出 `Config` 起作用了），但它是只读的。**

不过这份数据是**在 `apply()` 里同步取的**，而 settings 文档是异步加载的 ——
很可能取到的是「还没加载完」的中间态。据此下结论会误判。

本版因此：

- 改成**三次采样**：`t+0` / `t+3s` / `t+12s`，各上报一次，看它怎么变
- 增加 `docWritable` 与 `hasDocument`（`describe()` 的顶层字段），
  用来判断 settings 文档本身有没有就绪
- `namespaces` 取值加兜底（`view.namespaces ?? namespaces`）

顺带确认的两处宿主事实（读 asar 源码）：

- `dsh-settings` 的命名空间就是**条目 id**（`ns: entry.options.id`），
  不是模块名 —— 所以把模块 `name` 改成 `workbuddy-console` 不影响它
- `dsh-settings` 服务级 `writable` 是**硬编码 `true`**，
  所以 `formWritable: false` 来自客户端 `configForms` 的 per-form 计算

### 测试

- 239 项，全绿

## [2.0.12] - 2026-10-04

### 诊断（保存问题仍在）

2.0.11 导出了 `Config` schema，重启后勾选保存**仍然失败**。

已确认的事实：

- `cordis.patch.yml` 的**内容与 mtime 都没变** —— 保存没有落到任何配置文件
- 扫描 `.dsh` 近 30 分钟的全部写入：只有本插件自己的 `plugin-data`、
  `hub.log`、以及 `cordis.yml`（profile 根骨架被重置成规范的 `[]`，
  这按它自己的注释是正常的）—— **没有任何设置写入**
- 所以写入是**被拒绝 / 无处可去**，不是被覆盖

而写入走的是 `settingsScope.set(...)`，`settingsScope` 由 vendored 的
`resolveSettingsScope()` 决定 —— 它取到了什么，**只有浏览器端知道**。

本版给客户端加了诊断：`apply()` 时把 settings 作用域的真实状态
（有无 `configForms`、命名空间清单、命中的条目 id、表单是否 `writable`、
绑定的 namespace 是否可写）上报到 `/wb-console/api/diag` 的
`clientBoots[].settingsScope`。下一次就不用再猜。

### 测试

- 239 项，全绿

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
