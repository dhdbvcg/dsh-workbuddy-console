/**
 * 测各接口的真实耗时，定位「点按钮要等好几秒」卡在哪一段。
 */
const BASE = 'http://127.0.0.1:19387';

async function timeIt(label, path, method = 'GET', body) {
  const t0 = Date.now();
  try {
    const r = await fetch(BASE + path, {
      method,
      signal: AbortSignal.timeout(120000),
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const text = await r.text();
    const ms = Date.now() - t0;
    return { label, ms, status: r.status, len: text.length, sample: text.slice(0, 90).replace(/\s+/g, ' ') };
  } catch (e) {
    return { label, ms: Date.now() - t0, status: 0, len: 0, sample: String(e.message).slice(0, 80) };
  }
}

const CASES = [
  ['池 status（卡片主数据）', '/plugins/dsh-workbuddy-xdpool/status', 'GET'],
  ['我们 diag', '/wb-console/api/diag', 'GET'],
  ['我们 mode', '/wb-console/api/mode', 'GET'],
  ['我们 overview', '/wb-console/api/overview', 'GET'],
  ['我们 tasks', '/wb-console/api/tasks', 'GET'],
  ['我们 credit', '/wb-console/api/credit', 'GET'],
  ['我们 history', '/wb-console/api/history', 'GET'],
  ['技能列表', '/wb-console/api/skills/list', 'GET'],
  ['已装技能', '/wb-console/api/skills/installed', 'GET'],
  ['页面 HTML', '/wb-console', 'GET'],
];

console.log('=== 各接口耗时（第 1 轮，冷启动）===');
const first = [];
for (const [label, path, method] of CASES) {
  const r = await timeIt(label, path, method);
  first.push(r);
  console.log('  ' + String(r.ms).padStart(6) + ' ms  ' + String(r.status).padEnd(4) + label.padEnd(24) + r.sample.slice(0, 60));
}

console.log('\n=== 第 2 轮（已预热）===');
for (const [label, path, method] of CASES) {
  const r = await timeIt(label, path, method);
  console.log('  ' + String(r.ms).padStart(6) + ' ms  ' + String(r.status).padEnd(4) + label.padEnd(24) + r.sample.slice(0, 60));
}

console.log('\n=== 最慢的 ===');
const sorted = [...first].sort((a, b) => b.ms - a.ms);
for (const r of sorted.slice(0, 4)) console.log('  ' + r.ms + ' ms  ' + r.label);
