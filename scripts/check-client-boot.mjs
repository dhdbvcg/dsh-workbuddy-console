/**
 * 查探针：浏览器端 bundle 到底有没有被加载。
 *
 * 用法: node check-client-boot.mjs
 *
 * 判读：
 *   clientBoots 非空 → 浏览器端 bundle 已加载并执行过 apply()。
 *                      那问题就在「注册到哪个插槽」这一侧。
 *   clientBoots 为空 → 浏览器端 bundle 根本没跑。
 *                      问题在宿主加载（客户端图 / 载具），不在插件逻辑。
 */
const BASE = 'http://127.0.0.1:19387';

const r = await fetch(BASE + '/wb-console/api/diag', { signal: AbortSignal.timeout(10000) });
if (r.status !== 200) {
  console.log('  /wb-console/api/diag 返回 HTTP ' + r.status + ' —— 服务端插件可能没在跑');
  process.exit(1);
}
const j = await r.json();
const boots = j.clientBoots || [];

console.log('=== 服务端 ===');
console.log('  ok        : ' + j.ok);
console.log('  node      : ' + j.node);
console.log('  静态资源  : ' + (j.assets || []).filter((a) => a.ok).length + '/' + (j.assets || []).length + ' 可读');

console.log('\n=== 浏览器端上线记录（clientBoots）===');
if (boots.length === 0) {
  console.log('  空 —— 浏览器端 bundle 从未执行过 apply()');
  console.log('');
  console.log('  结论：问题在宿主加载这一侧（客户端图 / 载具），');
  console.log('        不是本插件的注册逻辑。');
} else {
  console.log('  共 ' + boots.length + ' 条，最近 3 条：');
  for (const b of boots.slice(-3)) {
    console.log('    ' + b.at + '  ref=' + (b.referer || '(无)').slice(0, 80));
  }
  console.log('');
  console.log('  结论：浏览器端 bundle 已加载并跑过 apply()。');
  console.log('        那问题就在「注册到哪个插槽」—— 需要看浏览器控制台');
  console.log('        里我们打印的 [workbuddy-console] ... 报错。');
}
