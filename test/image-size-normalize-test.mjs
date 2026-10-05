/**
 * 守卫：附件尺寸缺失/非法时，不能把请求送进上游然后炸掉。
 *
 * 这次的真实故障：
 *   粘贴截图 -> attachment 引用上 width/height 缺失或不是安全正整数
 *   -> vendored 用 Number.isFinite（宽松）判定"可用"，放行
 *   -> 宿主 requestImageTarget() 算出无效 target
 *   -> 宿主 validateTarget() 抛 "Image request width must be a positive integer."
 *   -> 用户看到「本轮运行失败」，图片没发出去
 *
 * 两处校验强度不一致是根因。修法是在判定前**就地规范化** ref 的尺寸：
 *   - 安全正整数：保留
 *   - 有限小数：取整
 *   - 缺失/非法：明确置为 undefined，让降级路径接管（给出"图片未发送"提示）
 *
 * 本测试直接验证这个规范化函数。
 */
import { normalizeImageSize } from '../vendor/xdpool/lib/index.js';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log('  OK   ' + m); pass++; };
const bad = (m) => { console.log('  FAIL ' + m); fail++; };

console.log('\n附件尺寸规范化');

const cases = [
  ['正常整数 1920x1080', { width: 1920, height: 1080 }, 1920, 1080, '保留'],
  ['有限小数 1920.5x1080.4', { width: 1920.5, height: 1080.4 }, 1920, 1080, '取整成安全整数'],
  ['完全缺失', {}, undefined, undefined, '置为 undefined'],
  ['width=0', { width: 0, height: 1080 }, undefined, undefined, '非法 → undefined'],
  ['负数', { width: -5, height: 1080 }, undefined, undefined, '非法 → undefined'],
  ['NaN', { width: NaN, height: 1080 }, undefined, undefined, '非法 → undefined'],
  ['Infinity', { width: Infinity, height: 1080 }, undefined, undefined, '非法 → undefined'],
];

for (const [label, ref, ew, eh, note] of cases) {
  normalizeImageSize(ref);
  const gotW = ref.width;
  const gotH = ref.height;
  const wOk = gotW === ew;
  const hOk = gotH === eh;
  if (wOk && hOk) {
    ok(label.padEnd(22) + ' -> w=' + gotW + ' h=' + gotH + '  （' + note + '）');
  } else {
    bad(label.padEnd(22) + ' -> 期望 w=' + ew + ' h=' + eh + '，实际 w=' + gotW + ' h=' + gotH);
  }
}

console.log('\n关键：规范化后必须满足宿主校验');
for (const [label, ref] of [
  ['小数', { width: 1920.5, height: 1080.4 }],
  ['整数', { width: 800, height: 600 }],
]) {
  normalizeImageSize(ref);
  const hostValid =
    Number.isSafeInteger(ref.width) && ref.width > 0 &&
    Number.isSafeInteger(ref.height) && ref.height > 0;
  if (hostValid) ok(label + ' 规范化后能通过宿主 validateTarget 校验');
  else bad(label + ' 规范化后仍不能通过宿主校验');
}

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
