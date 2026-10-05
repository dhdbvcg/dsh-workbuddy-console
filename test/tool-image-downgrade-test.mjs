/**
 * 守卫：历史里的工具消息带图时，WorkBuddy 模型仍能发请求。
 *
 * 用户报告（2026-10-04）：一段旧会话（历史里有带图的工具结果）切到 WorkBuddy
 * 模型后，整个会话发不出去，报
 *   UNSUPPORTED_CONTENT: pi-ai cannot represent an image in an in-history … message
 *
 * 根因：宿主 `PiAiAdapter.stream` 在调用 provider **之前**就把 DSH 历史转成
 * pi-ai 历史，`assertSupportedHistory` 遇到非 user 角色的图片块直接抛错。
 * 官方 DeepSeek 适配器能表示（转 handle+base64），pi-ai 不能 —— 所以同一段历史
 * 换官方模型没事，换本插件就死。宿主没有留历史改写钩子，唯一能动的是 adapter
 * 边界：进宿主之前先把非 user 消息里的图片块降级成文字占位。
 *
 * 这里做三层验证：
 *   1. 降级函数本身（各种消息形状）
 *   2. 代理确实在「宿主看到之前」改掉了 messages
 *   3. **端到端**：真 PiAiAdapter + 真 provider + 本地 HTTP 服务器当 shim，
 *      断言请求真的发出、且请求体里工具消息不再含图片
 */
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VENDOR = path.join(ROOT, 'vendor', 'xdpool');
const mod = await import(pathToFileURL(path.join(VENDOR, 'lib', 'index.js')).href);

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const t = async (name, fn) => {
  try { await fn(); ok(name); } catch (e) { bad(name + ' —— ' + (e && e.message ? e.message : e)); }
};
const assert = (await import('node:assert/strict')).default;
const { downgradeUnsupportedImages, withToolImageDowngrade, WorkBuddyCatalog, createWorkBuddyAdapter } = mod;

console.log('\n历史工具消息带图 → 仍可发请求');

// 真实图片块带 width/height —— pi-ai 据此拼「request preview WxHpx」发给模型，
// 缺失即失效附件（上游会拒）。假数据必须带尺寸，否则测的不是真实形状。
const img = (id = 'att-1', width = 1920, height = 1080) => ({ type: 'image', attachment: { attachmentId: id, width, height } });
/** 失效附件：没有尺寸信息 */
const deadImg = (id = 'att-dead') => ({ type: 'image', attachment: { attachmentId: id } });
const txt = (text) => ({ type: 'text', text });

// ——— 1. 降级函数 ———

await t('工具消息里的图片被换成文字占位，原文本保留', () => {
  const out = downgradeUnsupportedImages([
    { role: 'tool', content: [img(), txt('分析完成')] },
  ]);
  assert.strictEqual(out.length, 1);
  // 图片原位换成占位文字，其余内容原样保留
  assert.deepStrictEqual(out[0].content, [txt('[图片输出已省略（1 张）]'), txt('分析完成')]);
});

await t('工具消息只有图片时补一行占位说明（不留空内容）', () => {
  const out = downgradeUnsupportedImages([{ role: 'tool', content: [img()] }]);
  assert.strictEqual(out[0].content.length, 1);
  assert.match(out[0].content[0].text, /图片输出已省略/);
});

await t('assistant 消息里的结构化图片输出同样降级', () => {
  const out = downgradeUnsupportedImages([{ role: 'assistant', content: [img()] }]);
  assert.ok(!out[0].content.some((b) => b.type === 'image'));
});

await t('user 消息里的图片原样保留（那是 pi-ai 的受支持路径）', () => {
  const messages = [{ role: 'user', content: [img(), txt('看这个')] }];
  assert.strictEqual(downgradeUnsupportedImages(messages), null, 'user 图片不该被动');
});

await t('没有图片时返回 null（快路径，不复制数组）', () => {
  assert.strictEqual(downgradeUnsupportedImages([{ role: 'user', content: [txt('hi')] }]), null);
  assert.strictEqual(downgradeUnsupportedImages([{ role: 'assistant', content: [txt('yo')] }]), null);
});

await t('多条消息混合：只动含图的那条，其余原样（同一引用）', () => {
  const a = { role: 'user', content: [txt('q')] };
  const b = { role: 'tool', content: [img(), txt('r')] };
  const out = downgradeUnsupportedImages([a, b]);
  assert.strictEqual(out[0], a, '未受影响的消息应保持引用不变');
  assert.notStrictEqual(out[1], b, '被改动的消息应是新对象');
});

await t('空数组 / 非法项不炸', () => {
  assert.strictEqual(downgradeUnsupportedImages([]), null);
  assert.strictEqual(downgradeUnsupportedImages([null, void 0]), null, '无图时应返回 null（不改）');
});

// ——— 1b. 模型不支持图片时，user 的图也要降级 ———
// 宿主第一道检查是「历史里有任何图 && 模型不支持 image 输入」就抛
// `pi-ai model … does not support image input`。本池子并非所有模型都收图
//（卡片里每个模型都有独立的「图片输入」开关），所以只降级工具消息不够。

await t('模型不支持图片：user 消息里的图也被降级，并说明原因', () => {
  const out = downgradeUnsupportedImages([{ role: 'user', content: [img('att-u'), txt('看这个')] }], {
    allowUserImages: false,
  });
  assert.ok(!out[0].content.some((b) => b.type === 'image'), '不该再留图片块');
  assert.match(out[0].content[0].text, /不支持图片输入/, '应说明是模型能力所限');
});

await t('模型支持图片：user 消息里的图保留（默认行为）', () => {
  const messages = [{ role: 'user', content: [img(), txt('看这个')] }];
  assert.strictEqual(downgradeUnsupportedImages(messages), null, '支持图片时不该动 user 的图');
  assert.strictEqual(
    downgradeUnsupportedImages(messages, { allowUserImages: true }),
    null,
    '显式传 true 也不该动',
  );
});

await t('不支持图片的模型：工具与 user 两侧都被降级，且用不同措辞', () => {
  const out = downgradeUnsupportedImages(
    [
      { role: 'user', content: [img('att-u')] },
      { role: 'tool', content: [img('att-t')] },
    ],
    { allowUserImages: false },
  );
  assert.match(out[0].content[0].text, /不支持图片输入/);
  assert.match(out[1].content[0].text, /图片输出已省略/);
});

// ——— 2. 代理在宿主之前改参数 ———

await t('代理：宿主侧看到的是净化后的 messages', async () => {
  let seen;
  const fakeHost = {
    marker: 'host',
    stream(options) { seen = options.messages; return 'ok'; },
  };
  const wrapped = withToolImageDowngrade(fakeHost);
  const res = wrapped.stream({ provider: 'p', model: 'm', messages: [{ role: 'tool', content: [img()] }] });
  assert.strictEqual(res, 'ok', '返回值应原样透传');
  assert.ok(!seen[0].content.some((b) => b.type === 'image'), '宿主不该再看到图片块');
});

await t('代理：this 绑定正确（方法能读到自身字段）', () => {
  const fakeHost = {
    tag: 'adapter',
    whoAmI() { return this.tag; },
  };
  assert.strictEqual(withToolImageDowngrade(fakeHost).whoAmI(), 'adapter');
});

await t('代理：不受影响的方法原样放行、非函数属性照常返回', () => {
  const fakeHost = { id: 'workbuddy-xdpool', listModels() { return ['m']; } };
  const wrapped = withToolImageDowngrade(fakeHost);
  assert.strictEqual(wrapped.id, 'workbuddy-xdpool');
  assert.deepStrictEqual(wrapped.listModels(), ['m']);
});

await t('代理：按模型能力决定 user 图片是否降级', () => {
  const seenBy = new Map();
  const fakeHost = {
    stream(options) { seenBy.set(options.model, options.messages); return 'ok'; },
  };
  // 每次调用都要全新的数组：净化是「返回新数组」，复用同一个引用会让
  // 两次调用看到同一份内容，测不出差别
  const fresh = () => [{ role: 'user', content: [img()] }];

  // 判定器：只有 with-image 收图
  const wrapped = withToolImageDowngrade(fakeHost, (modelId) => modelId === 'with-image');
  wrapped.stream({ model: 'with-image', messages: fresh() });
  wrapped.stream({ model: 'no-image', messages: fresh() });

  assert.ok(seenBy.get('with-image')[0].content.some((b) => b.type === 'image'), '支持图片的模型应保留 user 的图');
  assert.ok(!seenBy.get('no-image')[0].content.some((b) => b.type === 'image'), '不支持图片的模型应连user 的图一起降级');
});

await t('代理：判定不出来时按「支持图片」处理（不静默丢用户的图）', () => {
  const seen = [];
  const fakeHost = { stream(options) { seen.push(options.messages); } };
  const wrapped = withToolImageDowngrade(fakeHost, () => undefined);
  wrapped.stream({ model: 'weird', messages: [{ role: 'user', content: [img()] }] });
  assert.ok(seen[0][0].content.some((b) => b.type === 'image'), '判定不了就当支持，别擅自丢图');
});

await t('降级会报告丢弃计数（静默降级必须可诊断）', () => {
  const seen = [];
  const fakeHost = { stream(options) { seen.push(options.messages); } };
  const dropped = [];
  const wrapped = withToolImageDowngrade(fakeHost, (id) => id === 'with-image', (modelId, info) => dropped.push({ modelId, ...info }));
  wrapped.stream({
    model: 'no-image',
    messages: [
      { role: 'user', content: [img('u1'), txt('a')] },
      { role: 'tool', content: [img('t1'), img('t2')] },
    ],
  });
  assert.strictEqual(dropped.length, 1, '应恰好上报一次');
  assert.deepStrictEqual(
    { images: dropped[0].images, userImages: dropped[0].userImages, historyImages: dropped[0].historyImages },
    { images: 3, userImages: 1, historyImages: 2 },
  );
  // sites 记录「哪条消息、什么 role、图片在第几层」—— 探针与日志都靠它定位
  assert.deepStrictEqual(
    dropped[0].sites.map((s) => `${s.role}x${s.count}@${s.depth.join('/')}`),
    ['userx1@0', 'toolx2@0'],
    'sites 应按消息记录 role 与图片所在层级',
  );
  assert.strictEqual(dropped[0].model, 'no-image', '应带上触发的模型 id');

  // 支持图片的模型 + 只有工具图：也要报，但计数归到历史
  dropped.length = 0;
  wrapped.stream({ model: 'with-image', messages: [{ role: 'tool', content: [img('t3')] }] });
  assert.deepStrictEqual(
    { images: dropped[0].images, userImages: dropped[0].userImages, historyImages: dropped[0].historyImages },
    { images: 1, userImages: 0, historyImages: 1 },
  );

  // 无图时不报（否则每次请求都刷日志）
  dropped.length = 0;
  wrapped.stream({ model: 'with-image', messages: [{ role: 'user', content: [txt('hi')] }] });
  assert.strictEqual(dropped.length, 0, '没降级就不该上报');
});

// ——— 3. 端到端：真 PiAiAdapter + 真 provider + 本地 HTTP 当 shim ———

await t('端到端：带图历史不再抛 UNSUPPORTED_CONTENT，请求真的到达 shim', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const catalog = new WorkBuddyCatalog();
    catalog.update([{
      id: 'hy4-preview',
      name: 'Hy4 preview',
      contextWindow: 200000,
      maxOutputTokens: 32000,
      supportsImages: true,
      multiplier: 0,
      supportedEfforts: ['high'],
    }]);
    const shim = { baseUrl: () => `http://127.0.0.1:${port}`, token: () => 'test-token' };
    const ctx = { get: () => undefined };
    const { adapter } = createWorkBuddyAdapter({ shim, catalog, ctx, providerId: 'workbuddy-xdpool' });

    const messages = [
      { role: 'user', content: [txt('看看这张图')] },
      // 宿主真实历史里 assistant 消息带 source（replay 元数据载体），
      // 缺了它 toPiAssistant 会读 source.kind 报错 —— 补上才是真实形状
      { role: 'assistant', content: [txt('好的')], source: { kind: 'model' } },
      // 旧会话遗留：工具结果里带图 —— 官方模型能表示，pi-ai 不能
      { role: 'tool', content: [img('att-tool'), txt('截图如下')] },
      { role: 'user', content: [txt('继续')] },
    ];

    // 消费流；转换失败会以 UNSUPPORTED_CONTENT 抛错，这里只关心「不抛这个」
    let streamError;
    try {
      for await (const _event of adapter.stream({ provider: 'workbuddy-xdpool', model: 'hy4-preview', messages })) {
        // 正常情况下会有若干事件；这里不校验内容
      }
    } catch (e) {
      streamError = e;
    }
    assert.ok(
      streamError === undefined || !/cannot represent an image|UNSUPPORTED_CONTENT/.test(String(streamError?.message ?? '')),
      `仍因历史图片失败：${streamError?.message}`,
    );

    // 请求确实到了 shim（而不是死在转换阶段）
    assert.ok(received.length > 0, 'shim 没收到任何请求');
    const sent = received.at(-1).body;
    assert.ok(!/image_url|data:image/.test(sent), '请求体里不该再有图片');
    assert.match(sent, /图片输出已省略/, '请求体里应有降级说明');
  } finally {
    server.close();
  }
});

await t('端到端：不支持图片的模型 + user 发了图 → 也能发出去', async () => {
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  try {
    const catalog = new WorkBuddyCatalog();
    catalog.update([{
      id: 'text-only',
      name: '纯文本模型',
      contextWindow: 200000,
      maxOutputTokens: 32000,
      supportsImages: false,
      multiplier: 0.5,
    }]);
    const shim = { baseUrl: () => `http://127.0.0.1:${port}`, token: () => 'test-token' };
    const { adapter } = createWorkBuddyAdapter({ shim, catalog, ctx: { get: () => undefined }, providerId: 'workbuddy-xdpool' });

    // 用户刚发了一张图，但这个模型收不了 —— 以前整段会话直接报
    // 「pi-ai model … does not support image input」
    const messages = [
      { role: 'user', content: [img('att-user'), txt('这张图里有段代码')] },
      { role: 'assistant', content: [txt('我看看')], source: { kind: 'model' } },
      { role: 'user', content: [txt('继续')] },
    ];

    let streamError;
    try {
      for await (const _event of adapter.stream({ provider: 'workbuddy-xdpool', model: 'text-only', messages })) {
        // 只关心请求能否发出
      }
    } catch (e) {
      streamError = e;
    }
    assert.ok(
      streamError === undefined || !/does not support image input|UNSUPPORTED_CONTENT/.test(String(streamError?.message ?? '')),
      `仍因图片失败：${streamError?.message}`,
    );
    assert.ok(received.length > 0, 'shim 没收到任何请求');
    const sent = received.at(-1);
    assert.ok(!/image_url|data:image/.test(sent), '请求体里不该有图片');
    assert.match(sent, /不支持图片输入/, '应说明图没送出去的原因');
  } finally {
    server.close();
  }
});

await t('代理：嵌套形状里的 messages 也能拦到（签名无关）', () => {
  // 回归：早先只认顶层 `arg.messages`。宿主实际调用签名不由我们决定，
  // 一旦形状不同（options 在别的参数里、或 messages 嵌套一层），
  // 净化会**静默跳过** —— 症状是「代码改了，错误一字不变」，极难定位。
  const seen = [];
  const fakeHost = { stream(...args) { seen.push(args); return 'ok'; } };
  const wrapped = withToolImageDowngrade(fakeHost, () => true);

  wrapped.stream({ model: 'hy4', input: { messages: [{ role: 'tool', content: [img()] }] } });
  wrapped.stream('hy4', { model: 'hy4', messages: [{ role: 'tool', content: [img()] }] });
  wrapped.stream({ model: 'hy4', messages: [{ role: 'tool', content: [img()] }] });

  assert.strictEqual(seen.length, 3);
  // 三种形状里的 messages 都应已被降级（位置分别在 args[0].input / args[1] / args[0]）
  const pick = (args) => args.find((a) => a !== null && typeof a === 'object')?.input?.messages
    ?? args.find((a) => a !== null && typeof a === 'object')?.messages;
  for (const [i, args] of seen.entries()) {
    const msgs = pick(args);
    assert.ok(Array.isArray(msgs), `形状 ${i} 里没找到 messages`);
    assert.ok(!msgs[0].content.some((b) => b.type === 'image'), `形状 ${i} 的图片未被降级`);
  }

  // 原始入参不能被就地改写（宿主可能复用同一个 options 对象）
  const original = { model: 'hy4', messages: [{ role: 'tool', content: [img()] }] };
  const before = JSON.stringify(original);
  withToolImageDowngrade(fakeHost, () => true).stream(original);
  assert.strictEqual(JSON.stringify(original), before, '不应就地修改调用方的对象');
});

await t('图片嵌在 tool-result.content 里也会被降级（真实会话形状）', () => {
  // 回归：真实会话里工具结果不是「顶层 image 块」，而是
  //   { role:'tool', content:[{ type:'tool-result', content:[ …, {type:'image'} ] }] }
  // 宿主的 contentHasImage 是**递归**的
  //（block.type === "image" || block.type === "tool-result" && contentHasImage(block.content)），
  // 而净化器原来只扫顶层 -> 一个都没替换 -> 请求照旧失败。
  const out = downgradeUnsupportedImages([{
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: 't1',
      content: [{ type: 'text', text: '截图:' }, { type: 'image', attachment: { attachmentId: 'a1' } }],
    }],
  }]);
  const inner = out[0].content[0].content;
  assert.ok(!inner.some((b) => b.type === 'image'), '嵌套图片未被降级');
  assert.ok(inner.some((b) => b.type === 'text' && /图片输出已省略/.test(b.text)), '应写入降级说明');
  // 外层结构保持不变（tool-result / toolCallId 不能丢）
  assert.strictEqual(out[0].content[0].type, 'tool-result');
  assert.strictEqual(out[0].content[0].toolCallId, 't1');
});

await t('多层嵌套与多个 tool-result 都能数对', () => {
  const out = downgradeUnsupportedImages([{
    role: 'tool',
    content: [
      { type: 'tool-result', content: [{ type: 'image', attachment: { attachmentId: 'a' } }] },
      { type: 'tool-result', content: [{ type: 'image', attachment: { attachmentId: 'b' } }, { type: 'image', attachment: { attachmentId: 'c' } }] },
    ],
  }]);
  const hasImage = (bs) => bs.some((b) => b.type === 'image' || (Array.isArray(b.content) && hasImage(b.content)));
  assert.ok(!hasImage(out[0].content), '仍有图片残留');
});

await t('探针文件：记录真实结构，无降级时不写', () => {
  // 探针的存在意义：下一轮再出问题时读文件就知道真实形状，不必读源码反推。
  // 用**子进程**跑：本模块已在当前进程 import 过，同进程内改DSH_HOME 的生效
  // 时机依赖插件内部读 env 的那一刻，断言不可靠（我在这上面已经踩过一次）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdpool-probe-'));
  const entry = pathToFileURL(path.join(ROOT, 'vendor', 'xdpool', 'lib', 'index.js')).href;
  const script = [
    `const mod = await import(${JSON.stringify(entry)});`,
    `const img = { type: 'image', attachment: { attachmentId: 'a' } };`,
    // 第一次没有图 -> 不该写任何东西
    `mod.downgradeUnsupportedImages([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], { allowUserImages: true, model: 'm1' });`,
    // 第二次真实形状 -> 写一行
    `mod.downgradeUnsupportedImages([{ role: 'tool', content: [{ type: 'tool-result', content: [img] }] }], { allowUserImages: true, model: 'hy4-preview' });`,
  ].join('\n');
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, DSH_HOME: dir },
      stdio: 'pipe',
    });
    const probe = path.join(dir, '.workbuddy-xdpool', 'image-downgrade.log');
    assert.ok(fs.existsSync(probe), '降级后应写出探针文件');
    const lines = fs.readFileSync(probe, 'utf8').trim().split('\n');
    assert.strictEqual(lines.length, 1, '只有真正降级的那次该写一行（无图那次不写）');
    assert.match(lines[0], /model=hy4-preview/, '探针应记录模型 id');
    assert.match(lines[0], /images=1/, '探针应记录图片数');
    assert.match(lines[0], /toolx1@depth1/, '探针应记录 role 与图片所在层级（tool-result 内第 1 层）');
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响结论 */ }
  }
});

await t('端到端（宿主真实路径）：prepareCall 返回的 stream 也会被净化', async () => {
  // 回归：宿主不调 adapter.stream，而是 prepareCall() 拿 {model, stream} 后
  // 调返回对象上的 stream —— 消息走内部闭包，只包方法层会被整条绕过。
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(body);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const catalog = new WorkBuddyCatalog();
    catalog.update([{ id: 'hy4-preview', name: 'Hy4', contextWindow: 200000, maxOutputTokens: 32000, supportsImages: true, multiplier: 0 }]);
    const { adapter } = createWorkBuddyAdapter({ shim: { baseUrl: () => `http://127.0.0.1:${server.address().port}`, token: () => 't' }, catalog, ctx: { get: () => undefined }, providerId: 'workbuddy-xdpool' });
    const messages = [
      { role: 'user', content: [txt('看图')] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 't1', content: [{ type: 'image', attachment: { attachmentId: 'a' } }] }] },
      { role: 'user', content: [txt('继续')] },
    ];
    const prepared = await adapter.prepareCall('workbuddy-xdpool', 'hy4-preview', undefined);
    let streamError;
    try { for await (const _ of prepared.stream({ provider: 'workbuddy-xdpool', model: 'hy4-preview', messages })) {} }
    catch (e) { streamError = e; }
    assert.ok(streamError === undefined || !/cannot represent an image|UNSUPPORTED_CONTENT/.test(String(streamError?.message ?? '')), `仍失败：${streamError?.message}`);
    assert.ok(received.length > 0, 'shim 没收到请求');
    const sent = received.at(-1);
    assert.ok(!/image_url|data:image/.test(sent), '请求体里有图片残留');
    assert.match(sent, /图片输出已省略/, '应有降级说明');
  } finally { server.close(); }
});

await t('旧历史里的 user 图片也降级，只留最近几条消息的（上游拒绝失效旧附件）', () => {
  // 回归：2057 条消息、25 张历史图 —— 上游网关拒绝其中一张失效旧附件
  //（"Image request width must be a positive integer"，文本来自上游而非本地包）。
  // 与其逐张排查旧附件，不如只保留最近 3 条消息里的图：新截图要保，旧截图本就该弃。
  const img = (id) => ({ type: 'image', attachment: { attachmentId: id, width: 1920, height: 1080 } });
  const messages = [
    { role: 'user', content: [img('old-1'), txt('很久以前')] },
    { role: 'assistant', content: [txt('好的')], source: { kind: 'model' } },
    { role: 'user', content: [img('old-2'), txt('上周')] },
    { role: 'assistant', content: [txt('嗯')], source: { kind: 'model' } },
    { role: 'user', content: [img('new-1'), txt('刚刚发的')] },
  ];
  const out = downgradeUnsupportedImages(messages, { allowUserImages: true });
  // 5 条消息、keepLastMessages=3 -> 只有最后 3 条（index>=2）保留图片
  assert.strictEqual(out[0].content.some((b) => b.type === 'image'), false, 'index0 的旧图应被降级');
  assert.strictEqual(out[2].content.some((b) => b.type === 'image'), true, 'index2 在最后 3 条窗口内，应保留');
  assert.strictEqual(out[4].content.some((b) => b.type === 'image'), true, '最近消息里的图必须保留');
  // 降级说明带原因
  assert.match(out[0].content[0].text, /不支持图片输入|图片未发送|附件已失效/, 'user 图降级应有说明');
});

await t('尺寸元数据无效的图片（失效附件）被剔除，有效的照常保留', () => {
  // 根因：图片块自带 attachment.width/height，pi-ai 据此拼出
  // 「request preview {w}x{h}px」发给模型（requestImageHandleText）。
  // 附件被清理后 width/height 缺失或为 0，上游解析这句说明时报
  //「Image request width must be a positive integer」——
  // 而此时请求里确实带着图，不是「没有图」的问题。
  const good = { type: 'image', attachment: { attachmentId: 'a1', name: 'shot.png', width: 1920, height: 1080 } };
  const dead = { type: 'image', attachment: { attachmentId: 'a2', name: 'old.png' } };
  const zero = { type: 'image', attachment: { attachmentId: 'a3', width: 0, height: 0 } };
  const nImg = (bs) => bs.filter((b) => b?.type === 'image').length;

  // 混合：有效的必须留下，只有失效的被替换
  const mixed = downgradeUnsupportedImages([
    { role: 'user', content: [txt('hi')] },
    { role: 'assistant', content: [txt('ok')], source: { kind: 'model' } },
    { role: 'user', content: [good, dead, txt('看图')] },
  ], { allowUserImages: true });
  assert.strictEqual(nImg(mixed[2].content), 1, '有效图应保留，只剔除失效那张');
  assert.match(JSON.stringify(mixed[2].content), /附件已失效/, '应写入失效原因说明');

  // 全部有效 -> 零改动（快路径）
  assert.strictEqual(
    downgradeUnsupportedImages([{ role: 'user', content: [good, txt('新图')] }], { allowUserImages: true }),
    null,
    '全部有效时不该改动',
  );

  // 全部失效（缺字段 / 为 0 两种）
  const allDead = downgradeUnsupportedImages([{ role: 'user', content: [dead, zero] }], { allowUserImages: true });
  assert.strictEqual(nImg(allDead[0].content), 0, '缺字段与为 0 都算失效');
});

await t('附件文件不可读的图片也被剔除（块上元数据完好但文件已丢失）', () => {
  // 根因：块上的 width/height 可能是陈旧的 —— 附件文件早被清理、元数据还留着。
  // 此时尺寸检查通过，pi-ai 去读文件却读不到，上游照样报
  //「Image request width must be a positive integer」。
  // 故用宿主附件服务的 imageHostPath(ref)（返回 undefined 即文件不存在）。
  const good = { type: 'image', attachment: { attachmentId: 'ok', width: 1920, height: 1080 } };
  const ghost = { type: 'image', attachment: { attachmentId: 'gone', width: 1920, height: 1080 } };
  const nImg = (bs) => bs.filter((b) => b?.type === 'image').length;

  // 文件不存在 -> 剔除
  let out = downgradeUnsupportedImages([{ role: 'user', content: [good, ghost] }], {
    allowUserImages: true,
    isImageUsable: (ref) => ref.attachmentId !== 'gone',
  });
  assert.strictEqual(nImg(out[0].content), 1, '文件丢失的图应被剔除，好的留下');
  assert.match(JSON.stringify(out[0].content), /附件已失效/, '应说明失效原因');

  // 判定器抛错 -> 按可用处理（宽松方向，不误杀）
  out = downgradeUnsupportedImages([{ role: 'user', content: [good] }], {
    allowUserImages: true,
    isImageUsable: () => { throw new Error('service down'); },
  });
  assert.strictEqual(out, null, '判不出来时不该改动');

  // 未提供判定器 -> 只按尺寸判断（向后兼容）
  out = downgradeUnsupportedImages([{ role: 'user', content: [good] }], { allowUserImages: true });
  assert.strictEqual(out, null, '没提供判定器时行为不变');
});

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);