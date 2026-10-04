/**
 * 读三次采样的结果，判断「只读」是不是测早了造成的。
 */
const BASE = 'http://127.0.0.1:19387';

const r = await fetch(BASE + '/wb-console/api/diag', { signal: AbortSignal.timeout(10000) });
const j = await r.json();
const boots = j.clientBoots || [];

console.log('=== clientBoots：' + boots.length + ' 条 ===');
if (!boots.length) { console.log('  空'); process.exit(0); }

// 按时间倒序显示，标注 sample 标签
const shown = boots.slice(-6);
for (const b of shown) {
  const s = b.settingsScope || {};
  console.log('\n--- ' + b.at + '  sample=' + (b.sample || '(无)') + ' ---');
  for (const [k, v] of Object.entries(s)) {
    console.log('    ' + k + ': ' + JSON.stringify(v));
  }
}

const withSample = boots.filter((b) => b.sample);
console.log('\n=== 判读 ===');
if (!withSample.length) {
  console.log('  还没有带 sample 标签的样本 → 运行的是 2.0.12 或更早（客户端未热重载）');
  console.log('  需要重启 DSH 才能拿到新探针的数据。');
} else {
  for (const tag of ['t+0', 't+3s', 't+12s']) {
    const b = withSample.filter((x) => x.sample === tag).pop();
    if (!b) { console.log('  ' + tag + ': (缺)'); continue; }
    const s = b.settingsScope || {};
    console.log('  ' + tag + ': docWritable=' + s.docWritable + '  hasDocument=' + s.hasDocument +
      '  ns=' + JSON.stringify(s.namespaces) + '  form=' + s.formFound + '  formWritable=' + s.formWritable);
  }
  const last = withSample[withSample.length - 1].settingsScope || {};
  console.log('');
  if (last.formWritable === true) {
    console.log('  → 表单最终是可写的：保存应当能成功（之前读到 false 是时序问题）');
  } else if (last.hasDocument === false) {
    console.log('  → settings 文档还没就绪（hasDocument=false）：宿主侧没有可写的配置文档');
  } else if (last.namespaces && last.namespaces.length === 0) {
    console.log('  → 文档已就绪但命名空间列表为空：本条目没有被登记进 settings 文档');
  } else {
    console.log('  → 命名空间存在但表单只读，需要看 docWritable / formWritable 组合');
  }
}
