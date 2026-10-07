/**
 * 守卫：图片尺寸的处理必须
 *   (1) 判定口径与宿主一致（安全正整数），坏尺寸交给降级而不是送出去；
 *   (2) **绝不改动 ref 对象** —— DSH 的附件引用是冻结的，
 *       赋值会抛 "Cannot assign to read only property 'width'"，
 *       而这个函数在净化热路径上，一抛就是每个带图请求都失败。
 *
 * (2) 是真实事故：2.0.38 里写了 `ref.width = ...` 就地写回，
 * 用户每次发图都看到「本轮运行失败 ...read only property 'width'」。
 * 所以这里把「冻结对象不抛」作为一等公民来断言。
 */
import assert from 'node:assert/strict';
import { readImageSize, downgradeUnsupportedImages, normalizeDeepImages, policyToHostTarget } from '../vendor/xdpool/lib/index.js';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };
const t = (name, fn) => {
  try { fn(); ok(name); } catch (e) { bad(name + '  → ' + String(e.message).split('\n')[0]); }
};

console.log('\n图片尺寸读取（只读，不改动 ref）');

t('正常整数原样读出', () => {
  assert.deepEqual(readImageSize({ width: 1920, height: 1080 }), { width: 1920, height: 1080 });
});

t('有限小数取整成安全整数', () => {
  assert.deepEqual(readImageSize({ width: 1920.5, height: 1080.4 }), { width: 1920, height: 1080 });
});

t('字符串数字也能识别', () => {
  assert.deepEqual(readImageSize({ width: '1920', height: '1080' }), { width: 1920, height: 1080 });
});

t('缺失 / 0 / 负数 / NaN / Infinity 一律读不到', () => {
  for (const ref of [
    {},
    { width: 0, height: 1080 },
    { width: -5, height: 1080 },
    { width: NaN, height: 1080 },
    { width: Infinity, height: 1080 },
    { width: 1920 },
    { height: 1080 },
  ]) {
    assert.deepEqual(readImageSize(ref), { width: undefined, height: undefined },
      '应当读不到: ' + JSON.stringify(ref));
  }
});

t('兜底字段 dimensions / meta 也能读到', () => {
  assert.deepEqual(readImageSize({ dimensions: { width: 800, height: 600 } }), { width: 800, height: 600 });
});

console.log('\n关键回归：冻结的 ref 不能抛');

t('readImageSize 对冻结对象不抛', () => {
  const frozen = Object.freeze({ width: 1920, height: 1080 });
  assert.deepEqual(readImageSize(frozen), { width: 1920, height: 1080 });
  assert.equal(frozen.width, 1920);
});

t('readImageSize 对冻结的坏尺寸也不抛', () => {
  assert.deepEqual(readImageSize(Object.freeze({})), { width: undefined, height: undefined });
});

t('downgradeUnsupportedImages 对冻结 ref 不抛（端到端）', () => {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: '看看这张图' },
        {
          type: 'image',
          attachment: Object.freeze({ attachmentId: 'a'.repeat(64), width: 1920, height: 1080, mediaType: 'image/png' }),
        },
      ],
    },
  ];
  // 契约：没有需要改动的地方就返回 null（改了才返回新数组）。
  // 以前这里会因为 ref.width = ... 抛 TypeError —— 那是 2.0.38 的事故，
  // 本断言就是它的回归守卫。
  const out = downgradeUnsupportedImages(messages, { allowUserImages: true, keepLastMessages: 3 });
  assert.equal(out, null, '尺寸有效的图不该被改动（返回 null 表示原样）');
});

t('冻结 ref + 坏尺寸 -> 走降级（不抛、不送坏尺寸）', () => {
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: '图坏了' },
        { type: 'image', attachment: Object.freeze({ attachmentId: 'b'.repeat(64), mediaType: 'image/png' }) },
      ],
    },
  ];
  const out = downgradeUnsupportedImages(messages, { allowUserImages: true, keepLastMessages: 3 });
  const flat = JSON.stringify(out);
  assert.ok(!flat.includes('"type":"image"'), '坏尺寸的图不该留在请求里');
  assert.ok(flat.includes('图片未发送'), '应当给出明确的中文说明');
});

console.log('\n核心修复：非整数尺寸必须换成整数再交给宿主');

/**
 * 为什么这条最重要（真正的根因）：
 *   宿主 dsh-attachment 的 requestImageDimensions 在**不需要缩放**时走
 *     if (scale === 1) return { width, height };   // 原样透传，不取整
 *   于是 ref.width = 1920.5 会一路带到 validateTarget，被
 *   Number.isSafeInteger 拒掉，报
 *     Image request width must be a positive integer
 *   而我们这边若只 Math.floor 判定就放行，就出现「代码改了、错误一字未变」。
 *   修法：保留时**换成带整数尺寸的新附件对象**（原 ref 冻结，改不了）。
 */
const keepImage = (ref) => {
  const frozen = Object.freeze({ attachmentId: 'c'.repeat(64), mediaType: 'image/png', ...ref });
  const messages = [
    { role: 'user', content: [{ type: 'text', text: 'x' }, { type: 'image', attachment: frozen }] },
  ];
  const out = downgradeUnsupportedImages(messages, { allowUserImages: true, keepLastMessages: 3 });
  const block = out === null ? null : (out[0].content.find((b) => b?.type === 'image') ?? null);
  return { out, frozen, block };
};

t('非整数 float 尺寸 -> 换成安全整数', () => {
  const { frozen, block } = keepImage({ width: 1920.5, height: 1032.4 });
  assert.ok(block, '图不该被丢掉');
  assert.ok(Number.isSafeInteger(block.attachment.width), 'width 必须是安全整数，实际 ' + block.attachment.width);
  assert.ok(Number.isSafeInteger(block.attachment.height), 'height 必须是安全整数');
  assert.equal(block.attachment.width, 1920);
  assert.equal(block.attachment.height, 1032);
  assert.equal(frozen.width, 1920.5, '不许改动原 ref');
});

t('字符串尺寸 -> 换成数字', () => {
  const { block } = keepImage({ width: '1920', height: '1032' });
  assert.ok(block, '图不该被丢掉');
  assert.equal(block.attachment.width, 1920);
  assert.equal(block.attachment.height, 1032);
  assert.equal(typeof block.attachment.width, 'number');
});

t('已经是安全整数 -> 保持零拷贝（返回 null 原样）', () => {
  const { out } = keepImage({ width: 1920, height: 1032 });
  assert.equal(out, null, '无需修改时应返回 null，避免无谓拷贝');
});

t('换出来的新 attachment 是普通可写对象（不是冻结的）', () => {
  const { block } = keepImage({ width: 1920.5, height: 1032.4 });
  assert.ok(block);
  assert.equal(Object.isFrozen(block.attachment), false, '新对象必须可写');
});

console.log('\n兜底扫描：降级器覆盖不到的位置也要修（第七层根因）');

/**
 * 为什么需要兜底：
 *   downgradeUnsupportedImages 只认它认得的结构。真实会话（messages 2400+）
 *   里存在它认不出的位置，那张图就带着非整数尺寸一路到了宿主 ——
 *   所以「改了错误一字未变」。normalizeDeepImages 对整棵参数树兜底。
 */
t('深层嵌套（降级器不认的结构）里的图也被换成整数', () => {
  const frozen = Object.freeze({ attachmentId: 'd'.repeat(64), mediaType: 'image/png', width: 1920.5, height: 1032.4 });
  const deep = {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'x' }],
        custom: { nested: { blocks: [{ type: 'image', attachment: frozen }] } },
      },
    ],
  };
  assert.equal(downgradeUnsupportedImages(deep.messages, { allowUserImages: true, keepLastMessages: 3 }), null,
    '降级器对这种结构应无改动 —— 这就是漏网场景');

  const stats = {};
  const out = normalizeDeepImages(deep, 0, stats);
  const img = out.messages[0].custom.nested.blocks[0];
  assert.ok(Number.isSafeInteger(img.attachment.width), 'width 应为安全整数');
  assert.ok(Number.isSafeInteger(img.attachment.height), 'height 应为安全整数');
  assert.equal(img.attachment.width, 1920);
  assert.equal(img.attachment.height, 1032);
  assert.equal(frozen.width, 1920.5, '不许改动原冻结 ref');
  assert.equal(stats.imageFixes, 1, '应记录修复计数（探针靠它证明漏网图存在）');
});

t('兜底对已合规的图零拷贝（返回同一对象）', () => {
  const same = { type: 'image', attachment: Object.freeze({ width: 10, height: 20 }) };
  assert.equal(normalizeDeepImages(same, 0, {}), same);
});

t('兜底不会改动非图片结构', () => {
  const plain = { a: 1, b: { c: 'x' }, d: [1, 2, 3] };
  assert.equal(normalizeDeepImages(plain, 0, {}), plain);
});

console.log('\n最终根因：0.1.5 的 policy 必须转成 0.2.0 的 target');

/**
 * 我们 vendored 的代码加载的是 dsh-llm-pi-ai 0.1.5（全局 npm 那份），
 * 它调用 readImageRequest(ref, policy)，policy = {maxPixels, maxBytes}；
 * 而宿主的 dsh-attachment-local 是 0.2.0，签名是 (ref, target)，
 * target 必须是 {width, height, maxBytes} —— 于是 validateTarget 报
 * "Image request width must be a positive integer"。
 * 这是「无法给 WorkBuddy 模型发图片」的真正根因（官方模型走 deepseek 适配器，
 * 签名一致，所以能识图）。
 */
t('policy {maxPixels,maxBytes} -> 带安全整数宽高的 target', () => {
  const t = policyToHostTarget({ width: 217, height: 58 }, { maxPixels: 4194304, maxBytes: 1048576 });
  assert.ok(Number.isSafeInteger(t.width) && t.width > 0, 'width 必须是安全正整数，实际 ' + t.width);
  assert.ok(Number.isSafeInteger(t.height) && t.height > 0, 'height 必须是安全正整数');
  assert.equal(t.width, 217);
  assert.equal(t.height, 58);
  assert.equal(t.maxBytes, 1048576);
});

t('超出像素预算的大图按同几何缩放', () => {
  const t = policyToHostTarget({ width: 4000, height: 3000 }, { maxPixels: 4194304, maxBytes: 1048576 });
  assert.ok(Number.isSafeInteger(t.width) && Number.isSafeInteger(t.height));
  assert.ok(t.width * t.height <= 4194304, '缩放后不应超预算，实际 ' + t.width * t.height);
});

t('已经是合法 target 时原样返回（不重复转换）', () => {
  const already = { width: 217, height: 58, maxBytes: 99 };
  assert.equal(policyToHostTarget({ width: 217, height: 58 }, already), already);
});

t('不像 policy 的参数原样返回（不猜）', () => {
  const weird = { foo: 1 };
  assert.equal(policyToHostTarget({ width: 217, height: 58 }, weird), weird);
});

t('引用上没有尺寸时不硬造 target', () => {
  const weird = { maxPixels: 4194304, maxBytes: 1048576 };
  assert.equal(policyToHostTarget({}, weird), weird, '读不到尺寸应原样放行，交给宿主报自己的错');
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
