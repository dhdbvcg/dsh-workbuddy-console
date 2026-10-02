/**
 * 独立渲染验证：不依赖 DSH/插件，直接用静态服务器托管 web/ 目录，
 * 用真实 Chrome 检查中英文两种语言下的渲染。
 *
 * 为什么需要：插件的改动要重启 DSH 才生效，但前端文案是纯静态的，
 * 可以独立验证。这样能在重启前就发现模板/字典问题。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '..', 'web');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

// 用共享的 mock-data.json，避免和 screenshot.mjs 各写一份而漏接口
// （之前就因为这个：e2e 里少了 /credit/summary，消耗面板渲染不出来）
const MOCK = JSON.parse(fs.readFileSync(path.join(HERE, 'mock-data.json'), 'utf8'));

// 起一个静态服务器；API 请求返回假数据，让页面能渲染出内容
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname.startsWith('/wb-console/api/')) {
    const key = Object.keys(MOCK).find((k) => url.pathname.endsWith(k));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(key ? MOCK[key] : { ok: true }));
    return;
  }

  let rel = url.pathname.replace(/^\/wb-console\/?/, '/');
  if (rel === '/') rel = '/index.html';
  const file = path.join(WEB, rel);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) {
    res.writeHead(404).end('nf');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
console.log('静态预览服务: http://127.0.0.1:' + PORT + '/wb-console/');

// 启动 Chrome
const CDP = 9333;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu',
  '--remote-debugging-port=' + CDP,
  '--user-data-dir=' + process.env.TEMP + '/cdp-i18n-' + Date.now(),
  'about:blank',
], { stdio: 'ignore' });

function cdp(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: CDP, path: pathname, method }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error(b.slice(0, 80))); } });
    });
    r.on('error', reject);
    r.end();
  });
}

for (let i = 0; i < 40; i++) {
  try { await cdp('/json/version'); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

async function checkLang(lang, label) {
  const tab = await cdp('/json/new?about:blank', 'PUT');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || '?');
  });
  const send = (method, params = {}) => {
    const myId = ++id;
    return new Promise((res) => { pending.set(myId, res); ws.send(JSON.stringify({ id: myId, method, params })); });
  };
  await new Promise((r) => ws.addEventListener('open', r));
  await send('Runtime.enable');
  await send('Page.enable');

  // 先设语言，再导航
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/wb-console/` });
  await new Promise((r) => setTimeout(r, 1200));
  await send('Runtime.evaluate', { expression: `localStorage.setItem('wb-console-lang', ${JSON.stringify(lang)})` });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/wb-console/?x=` + Date.now() });
  await new Promise((r) => setTimeout(r, 3500));

  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.result?.value;
  };

  // 点「刷新历史」，验证折线图渲染
  await ev(`document.querySelector('#btn-history')?.click()`);
  await new Promise((r) => setTimeout(r, 1500));

  // 点「刷新消耗」，验证消耗面板渲染
  await ev(`document.querySelector('#btn-spend')?.click()`);
  await new Promise((r) => setTimeout(r, 1800));

  // 点「加载市场」，验证技能市场渲染
  await ev(`document.querySelector('#btn-skills')?.click()`);
  await new Promise((r) => setTimeout(r, 2500));

  const out = await ev(`JSON.stringify({
    htmlLang: document.documentElement.lang,
    title: document.querySelector('h1')?.textContent,
    claimBtn: document.querySelector('#btn-claim-all')?.textContent.trim(),
    checkBtn: document.querySelector('#btn-check')?.textContent,
    tasksTitle: document.querySelector('#tasks-panel h2')?.textContent,
    poolTitle: document.querySelector('.panel h2')?.textContent,
    autoTitle: document.querySelector('#automation-panel h2')?.textContent,
    rows: document.querySelectorAll('.row').length,
    badge: document.querySelector('.row .badge')?.textContent,
    jobs: document.querySelectorAll('.job').length,
    histTitle: document.querySelector('#history-panel h2')?.textContent,
    histRows: document.querySelectorAll('.hist-row').length,
    chartPath: (document.querySelector('.chart-line')?.getAttribute('d') || '').slice(0, 30),
    deltaUp: document.querySelector('.delta.up')?.textContent,
    deltaDown: document.querySelector('.delta.down')?.textContent,
    spendTitle: document.querySelector('#spend-panel h2')?.textContent,
    spendSpent: document.querySelector('#spend-body .check-stat.bad b')?.textContent,
    spendGained: document.querySelector('#spend-body .check-stat.ok b')?.textContent,
    skillsTitle: document.querySelector('#skills-panel h2')?.textContent,
    skillsRows: document.querySelectorAll('.skill-row').length,
    skillsInstallBtn: document.querySelector('.act-skill-add')?.textContent,
    skillsUninstallBtn: document.querySelector('.act-skill-del')?.textContent
  })`);

  console.log(`\n=== ${label} (${lang}) ===`);
  const o = JSON.parse(out);
  for (const [k, v] of Object.entries(o)) console.log(`  ${k.padEnd(13)}: ${JSON.stringify(v)}`);
  console.log('  JS 异常      :', errors.length ? errors.map((e) => e.split('\n')[0]) : '无');

  ws.close();
  return { o, errors };
}

const zhRes = await checkLang('zh', '中文');
const enRes = await checkLang('en', 'English');

// 断言：两种语言的静态文案必须不同（否则 i18n 没生效）
console.log('\n=== 断言 ===');
let bad = 0;
if (zhRes.o.title === enRes.o.title) { console.log('  ✗ 标题未随语言变化'); bad++; }
else console.log('  ✓ 标题随语言变化');

if (zhRes.o.claimBtn === enRes.o.claimBtn) { console.log('  ✗ 按钮未随语言变化'); bad++; }
else console.log('  ✓ 按钮随语言变化');

if (zhRes.errors.length || enRes.errors.length) { console.log('  ✗ 存在 JS 异常'); bad++; }
else console.log('  ✓ 无 JS 异常');

if (zhRes.o.rows !== 2) { console.log('  ✗ 账号行数应为 2，实际 ' + zhRes.o.rows); bad++; }
else console.log('  ✓ 账号正常渲染');

// html lang 也要跟着切（影响屏幕阅读器与浏览器翻译提示）
if (zhRes.o.htmlLang !== 'zh-CN' || enRes.o.htmlLang !== 'en') {
  console.log(`  ✗ html lang 未正确切换：zh=${zhRes.o.htmlLang} en=${enRes.o.htmlLang}`);
  bad++;
} else console.log('  ✓ html lang 随语言切换');

// 历史面板：折线图必须真的画出路径，且有涨跌标注
if (!zhRes.o.chartPath.startsWith('M')) {
  console.log('  ✗ 折线图未渲染（chartPath=' + JSON.stringify(zhRes.o.chartPath) + '）');
  bad++;
} else console.log('  ✓ 折线图已渲染');

// 涨跌标注：按共享 mock 的数据判断该出现什么
// （mock 的历史目前单调上升，所以只有 up；若 mock 加了下降日，down 也必须出现）
const histSeries = (MOCK['/history'] && MOCK['/history'].series) || [];
const mockHasDrop = histSeries.some((d) => typeof d.delta === 'number' && d.delta < 0);
if (!zhRes.o.deltaUp) {
  console.log('  ✗ 上涨标注缺失（up=' + JSON.stringify(zhRes.o.deltaUp) + '）');
  bad++;
} else if (mockHasDrop && !zhRes.o.deltaDown) {
  console.log('  ✗ mock 含下降日，但下降标注缺失');
  bad++;
} else {
  console.log('  ✓ 涨跌标注正常' + (mockHasDrop ? '' : '（mock 无下降日，符合预期）'));
}

if (zhRes.o.histTitle === enRes.o.histTitle) {
  console.log('  ✗ 历史面板标题未随语言变化');
  bad++;
} else console.log('  ✓ 历史面板标题随语言变化');

// 消耗面板：必须渲染出数字，且随语言切换
if (!zhRes.o.spendSpent) {
  console.log('  ✗ 消耗面板未渲染（spendSpent=' + JSON.stringify(zhRes.o.spendSpent) + '）');
  bad++;
} else console.log('  ✓ 消耗面板已渲染（消耗 ' + zhRes.o.spendSpent + ' / 入账 ' + zhRes.o.spendGained + '）');

if (zhRes.o.spendTitle === enRes.o.spendTitle) {
  console.log('  ✗ 消耗面板标题未随语言变化');
  bad++;
} else console.log('  ✓ 消耗面板标题随语言变化');

// 技能市场：必须渲染出技能行与按钮
if (!zhRes.o.skillsRows) {
  console.log('  ✗ 技能市场未渲染任何技能行');
  bad++;
} else console.log(`  ✓ 技能市场已渲染（${zhRes.o.skillsRows} 个技能）`);

if (!zhRes.o.skillsInstallBtn) {
  console.log('  ✗ 技能市场缺少安装按钮');
  bad++;
} else console.log('  ✓ 技能市场有安装按钮：' + zhRes.o.skillsInstallBtn);

if (zhRes.o.skillsTitle === enRes.o.skillsTitle) {
  console.log('  ✗ 技能市场标题未随语言变化');
  bad++;
} else console.log('  ✓ 技能市场标题随语言变化');

chrome.kill();
server.close();
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
