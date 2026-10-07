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
import { readImageSize, downgradeUnsupportedImages } from '../vendor/xdpool/lib/index.js';

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

console.log('\n判定口径与宿主一致');

t('小数取整后能通过宿主的 isSafeInteger 校验', () => {
  const s = readImageSize({ width: 1920.5, height: 1080.4 });
  assert.ok(Number.isSafeInteger(s.width) && s.width > 0);
  assert.ok(Number.isSafeInteger(s.height) && s.height > 0);
});

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
