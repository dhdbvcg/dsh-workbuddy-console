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
import http from 'node:http';
import path from 'node:path';
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

const img = (id = 'att-1') => ({ type: 'image', attachment: { attachmentId: id } });
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
  assert.deepStrictEqual(dropped[0], { modelId: 'no-image', images: 3, userImages: 1, historyImages: 2 });

  // 支持图片的模型 + 只有工具图：也要报，但计数归到历史
  dropped.length = 0;
  wrapped.stream({ model: 'with-image', messages: [{ role: 'tool', content: [img('t3')] }] });
  assert.deepStrictEqual(dropped[0], { modelId: 'with-image', images: 1, userImages: 0, historyImages: 1 });

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

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);