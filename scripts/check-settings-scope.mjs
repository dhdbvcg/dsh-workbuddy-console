/**
 * 读浏览器端上报的 settings 作用域诊断，判断保存为什么失败。
 */
const BASE = 'http://127.0.0.1:19387';

const r = await fetch(BASE + '/wb-console/api/diag', { signal: AbortSignal.timeout(10000) });
const j = await r.json();
const boots = j.clientBoots || [];

console.log('=== clientBoots：' + boots.length + ' 条 ===');
if (!boots.length) {
  console.log('  空 —— 浏览器端还没上报过');
  process.exit(0);
}

const last = boots[boots.length - 1];
console.log('  最近一条: ' + last.at);

const s = last.settingsScope;
console.log('\n=== 浏览器端看到的 settings 作用域 ===');
if (!s) {
  console.log('  没有 settingsScope 字段 —— 可能运行的是 2.0.11 或更早，未重启到 2.0.12');
  process.exit(0);
}
for (const [k, v] of Object.entries(s)) {
  console.log('  ' + k + ': ' + JSON.stringify(v));
}

console.log('\n=== 判读 ===');
if (s.hasConfigForms === false && s.hasSettingsScope === false) {
  console.log('  两个服务都没有 —— 客户端 ctx 里既没有 configForms 也没有 settingsScope');
} else if (s.formFound === false && s.boundWritable === undefined) {
  console.log('  有 configForms 但取不到本插件的表单，且没有 settingsScope 兜底');
  console.log('  → 宿主没有为这个条目生成配置表单（Config schema 没被识别）');
} else if (s.formFound === true) {
  console.log('  表单找到了：entryId=' + s.entryIdUsed + '  writable=' + s.formWritable);
  if (s.formWritable !== true) console.log('  → 表单**只读**：宿主不允许写这个条目的配置');
} else if (s.boundWritable !== undefined) {
  console.log('  走的是 settingsScope 兜底路径，writable=' + s.boundWritable);
}
