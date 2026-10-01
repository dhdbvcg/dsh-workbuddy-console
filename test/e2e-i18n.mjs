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

// 起一个静态服务器；API 请求返回假数据，让页面能渲染出内容
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname.startsWith('/wb-console/api/')) {
    const body = (() => {
      if (url.pathname.endsWith('/mode')) {
        return { ok: true, mode: 'plugin', plugin: { online: true, accountCount: 2, error: null } };
      }
      if (url.pathname.endsWith('/overview')) {
        return {
          ok: true,
          mode: 'plugin',
          plugin: {
            accounts: [
              {
                id: 'a1', label: 'acct-one', nickname: 'Account One', domain: 'www.codebuddy.cn',
                expiresAt: '2026-11-25T08:59:36.371Z', disabled: false, cooling: false,
                credits: { total: 2371, packages: [{ packageName: 'Pkg', remain: 471, size: 500 }] },
                checkin: { active: true, todayCheckedIn: true, streakDays: 1, dailyCredit: 100, todayCredit: 100 },
              },
              {
                id: 'a2', label: 'acct-two', nickname: 'Account Two', domain: 'www.workbuddy.cn',
                expiresAt: '2026-11-25T08:35:58.401Z', disabled: false, cooling: false,
                credits: { total: 2872, packages: [] },
                checkin: { active: true, todayCheckedIn: false, streakDays: 2, dailyCredit: 100, todayCredit: 100 },
              },
            ],
            distribution: 'round-robin', cooling: 0, region: 'cn',
            models: [{ id: 'deepseek-v4.1-flash', multiplier: 0.11 }, { id: 'glm-5.3-flash', multiplier: 0.06 }],
            selection: { enabledModelIds: ['deepseek-v4.1-flash'] },
            automation: {
              enabled: false, running: true, checkinHours: [9], taskHours: [11], reportHours: [10], streakHours: [12], travelHours: [9, 21],
              jobs: { checkin: { ok: 1, credit: 100 }, tasks: { credit: 600, energy: 20, claimed: 4 } },
              earningsToday: { a1: { credit: 700 } }, runInProgress: false,
            },
          },
        };
      }
      if (url.pathname.endsWith('/tasks')) {
        return {
          ok: true,
          totals: { accounts: 2, pendingTasks: 2, claimableTasks: 1, pendingCredit: 200, claimableCredit: 100 },
          accounts: [
            {
              uid: 'a1', nickname: 'Account One', ok: true,
              summary: { total: 18, pendingCredit: 200, claimableCredit: 100 },
              claimable: [{ taskCode: 't_claim', title: 'Ready to claim', state: 'claimable', current: 3, target: 3, percent: 100, credit: 100, energy: 5, _uid: 'a1' }],
              pending: [{ taskCode: 't_pending', title: 'Almost there', state: 'pending', current: 1, target: 3, percent: 33, credit: 100, energy: 5, _uid: 'a1' }],
            },
          ],
        };
      }
      if (url.pathname.endsWith('/history')) {
        // 造 5 天数据，验证折线图与变化量渲染
        return {
          ok: true,
          windowDays: 30,
          totalRecords: 5,
          series: [
            { day: '2026-09-27', credit: 1000, accounts: 2, checkedIn: 2, delta: null },
            { day: '2026-09-28', credit: 1200, accounts: 2, checkedIn: 2, delta: 200 },
            { day: '2026-09-29', credit: 1200, accounts: 2, checkedIn: 1, delta: 0 },
            { day: '2026-09-30', credit: 1500, accounts: 2, checkedIn: 2, delta: 300 },
            { day: '2026-10-01', credit: 1450, accounts: 2, checkedIn: 2, delta: -50 },
          ],
          accounts: [{ uid: 'a1', nickname: 'Account One', firstDay: '2026-09-27', lastDay: '2026-10-01', observedDays: 5, checkedInDays: 5, lastCredit: 1450 }],
        };
      }
      return { ok: true };
    })();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
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
    deltaDown: document.querySelector('.delta.down')?.textContent
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

if (!zhRes.o.deltaUp || !zhRes.o.deltaDown) {
  console.log(`  ✗ 涨跌标注缺失：up=${JSON.stringify(zhRes.o.deltaUp)} down=${JSON.stringify(zhRes.o.deltaDown)}`);
  bad++;
} else console.log('  ✓ 涨跌标注正常');

if (zhRes.o.histTitle === enRes.o.histTitle) {
  console.log('  ✗ 历史面板标题未随语言变化');
  bad++;
} else console.log('  ✓ 历史面板标题随语言变化');

chrome.kill();
server.close();
console.log(bad === 0 ? '\n全部通过' : `\n${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
