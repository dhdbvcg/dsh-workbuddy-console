/* WorkBuddy 账号管理器 — 前端（插件模式 + 独立模式双兼容） */

const $ = (s) => document.querySelector(s);
const state = { mode: null, plugin: null, accounts: [], busy: false, reserveId: null };

/** 页面挂在 DSH 自己的端口下，所有接口都带这个前缀 */
const BASE_PATH = '/wb-console';
const API = BASE_PATH + '/api';

/**
 * 拼接口 URL。
 *
 * 调用方写 '/api/mode' 或 '/mode' 都行 —— 早期版本两种写法混用过，
 * 直接 API + path 会拼出 /wb-console/api/api/mode（404）。
 * 这里统一归一化，避免再踩。
 */
function apiUrl(path) {
  const p = String(path || '');
  // 已经是完整路径就直接用
  if (p.startsWith(BASE_PATH + '/')) return p;
  // '/api/xxx' -> '/xxx'
  const rel = p.startsWith('/api/') ? p.slice(4) : p.startsWith('/') ? p : '/' + p;
  return API + rel;
}

async function api(method, path, body) {
  const url = apiUrl(path);
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    // 尽力读后端给的可读错误；读不出就报 HTTP 状态
    const text = await res.text().catch(() => '');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    return {
      ok: false,
      error: (parsed && (parsed.error || parsed.msg)) || `请求失败（HTTP ${res.status}）${url}`,
      httpStatus: res.status,
    };
  }
  return res.json().catch(() => ({ ok: false, error: `响应不是 JSON（${url}）` }));
}

function flash(msg, kind = 'bad') {
  const el = $('#alert');
  if (!msg) return el.classList.add('hidden');
  el.textContent = msg;
  el.className = 'alert' + (kind === 'ok' ? ' ok' : '');
  el.classList.remove('hidden');
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

function fmtWhen(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* —— 账号池 —— */

function accountRowPlugin(a) {
  const c = a.checkin;
  const cr = a.credits;
  let badges = '';
  if (a.disabled) badges += '<span class="badge">已禁用</span>';
  if (a.cooling) badges += '<span class="badge warn">冷却中</span>';
  if (a.reserved) badges += '<span class="badge warn">已触保底</span>';
  if (c) {
    badges += c.todayCheckedIn ? '<span class="badge ok">今日已签</span>' : '<span class="badge warn">待签到</span>';
    if (c.streakDays) badges += `<span class="badge">连签 ${c.streakDays} 天</span>`;
  } else if (a.checkinError) {
    badges += `<span class="badge bad">签到查询失败</span>`;
  }

  let creditHtml = '';
  if (cr && typeof cr.total === 'number') {
    const pkgs = (cr.packages || [])
      .map((p) => `<span class="badge">${esc(p.packageName || p.code)} ${fmtNum(p.remain)}/${fmtNum(p.size)}</span>`)
      .join('');
    creditHtml = `<div class="credit">剩余 <b>${fmtNum(cr.total)}</b></div><div class="chips">${pkgs}</div>`;
  } else if (a.creditsError) {
    creditHtml = `<div class="badge bad">积分查询失败</div>`;
  }

  const checked = !!(c && c.todayCheckedIn);
  const can = !!(c && c.active && !checked);
  return `
    <div class="row ${a.disabled ? 'is-disabled' : ''}" data-id="${esc(a.id)}">
      <div class="avatar">${esc((a.nickname || a.label || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="meta">
        <div class="name">${esc(a.nickname || a.label)} ${badges}</div>
        <div class="uid">${esc(a.id)}${a.domain ? ' · ' + esc(a.domain) : ''}</div>
        <div class="uid">登录态到期：${a.expiresAt ? fmtWhen(Date.parse(a.expiresAt)) : '—'}${a.creditReserve ? ' · 保底 ' + a.creditReserve : ''}</div>
        ${creditHtml}
      </div>
      <div class="right">
        <button class="btn btn-sm act-claim" ${can && !state.busy ? '' : 'disabled'} data-id="${esc(a.id)}">
          ${!c ? '签到' : !c.active ? '无活动' : checked ? '已签到' : '签到'}
        </button>
        <button class="btn btn-sm act-toggle" data-id="${esc(a.id)}" data-disabled="${a.disabled ? '0' : '1'}">
          ${a.disabled ? '启用' : '禁用'}
        </button>
        <button class="btn btn-sm act-reserve" data-id="${esc(a.id)}" data-reserve="${a.creditReserve ?? 0}">保底</button>
      </div>
    </div>`;
}

function accountRowStandalone(a) {
  const c = a.checkin;
  let badges = '';
  if (a.expired) badges += '<span class="badge bad">登录态已过期</span>';
  if (c) {
    badges += c.todayCheckedIn ? '<span class="badge ok">今日已签</span>' : '<span class="badge warn">待签到</span>';
    if (c.streakDays) badges += `<span class="badge">连签 ${c.streakDays} 天</span>`;
  } else if (a.checkinError) badges += '<span class="badge bad">签到查询失败</span>';

  let creditHtml = '';
  if (a.credits) creditHtml = `<div class="credit">剩余 <b>${fmtNum(a.credits.total)}</b></div>`;

  const checked = !!(c && c.todayCheckedIn);
  const can = !!(c && c.active && !checked);
  return `
    <div class="row" data-id="${esc(a.uid)}">
      <div class="avatar">${esc((a.nickname || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="meta">
        <div class="name">${esc(a.nickname)} ${badges}</div>
        <div class="uid">${esc(a.uid)}${a.phone ? ' · ' + esc(a.phone) : ''}</div>
        <div class="uid">到期：${fmtWhen(a.expiresAt)} · ${esc(a.tokenPreview)}</div>
        ${creditHtml}
      </div>
      <div class="right">
        <button class="btn btn-sm act-claim" ${can && !state.busy ? '' : 'disabled'} data-id="${esc(a.uid)}">签到</button>
        <button class="btn btn-sm btn-danger act-del" data-id="${esc(a.uid)}">删除</button>
      </div>
    </div>`;
}

function renderAccounts(pluginData) {
  const list = $('#list');
  const empty = $('#empty');
  const accounts = state.mode === 'plugin' ? ((pluginData && pluginData.accounts) || []) : state.accounts;

  if (!accounts.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    $('#btn-claim-all').disabled = true;
    $('#pool-chips').innerHTML = '';
    return;
  }
  empty.classList.add('hidden');
  $('#btn-claim-all').disabled = state.busy;
  list.innerHTML = accounts.map((a) => (state.mode === 'plugin' ? accountRowPlugin(a) : accountRowStandalone(a))).join('');

  if (state.mode === 'plugin' && pluginData) {
    const p = pluginData;
    const chips = ['<span class="badge info">模式：插件</span>'];
    chips.push(`<span class="badge">轮询：${esc(p.distribution || 'round-robin')}</span>`);
    if (p.cooling) chips.push(`<span class="badge warn">冷却 ${p.cooling}</span>`);
    if (p.region) chips.push(`<span class="badge">区域：${esc(p.region)}</span>`);
    $('#pool-chips').innerHTML = chips.join('');
  } else {
    $('#pool-chips').innerHTML = '<span class="badge">模式：独立</span>';
  }
}

/* —— 自动化 —— */

const JOB_LABEL = { checkin: '每日签到', report: '活跃上报', tasks: '任务奖励', streak: '连登奖励', travel: '猫猫旅行' };

function renderAutomation(auto) {
  if (!auto) {
    $('#jobs').innerHTML = '<p class="hint" style="padding:0 18px 14px">插件未提供自动化信息。</p>';
    $('#auto-state').innerHTML = '';
    $('#auto-hint').textContent = '';
    return;
  }
  $('#auto-state').innerHTML = auto.running
    ? '<span class="badge ok">运行中</span>'
    : '<span class="badge">未运行</span>';

  const hoursOf = (j) => {
    const h = auto[j + 'Hours'];
    return Array.isArray(h) && h.length ? ` · ${h.join('/')} 时` : '';
  };

  $('#jobs').innerHTML = Object.entries(JOB_LABEL)
    .map(([key, label]) => {
      const s = (auto.jobs || {})[key] || {};
      const bits = [];
      if (s.credit) bits.push(`+${fmtNum(s.credit)} 积分`);
      if (s.energy) bits.push(`+${fmtNum(s.energy)} 能量`);
      if (s.claimed) bits.push(`${s.claimed} 项`);
      if (s.failed) bits.push(`失败 ${s.failed}`);
      return `
        <div class="job">
          <div class="jt"><span>${label}${hoursOf(key)}</span></div>
          <div class="jv">${bits.length ? bits.join(' · ') : '今日无记录'}</div>
          <button class="btn btn-sm jbtn act-run" data-job="${key}" ${auto.runInProgress ? 'disabled' : ''}>立即运行</button>
        </div>`;
    })
    .join('');

  const earned = auto.earningsToday || {};
  const total = Object.values(earned).reduce((s, e) => s + ((e && e.credit) || 0), 0);
  $('#auto-hint').textContent = total > 0
    ? `今日自动化累计收益：${fmtNum(total)} 积分（自动化总开关与时间表在 DSH 设置卡片里配置）`
    : '今日暂无自动化收益记录。自动化总开关与时间表在 DSH 设置卡片里配置。';
}

/* —— 模型池 —— */

function renderModels(models, selection) {
  if (!Array.isArray(models) || !models.length) {
    $('#models').innerHTML = '<p class="hint">没有模型目录。</p>';
    return;
  }
  const enabled = new Set((selection && selection.enabledModelIds) || []);
  $('#models').innerHTML = models
    .map((m) => {
      const id = m.id || m.modelId || '';
      const cls = ['model'];
      if (enabled.size === 0 || enabled.has(id)) cls.push('on');
      if (m.free || m.tier === 'free') cls.push('free');
      const mult = m.multiplier !== undefined ? ` ×${m.multiplier}` : '';
      return `<span class="${cls.join(' ')}" title="${esc(m.displayName || id)}">${esc(id)}${mult}</span>`;
    })
    .join('');
}

/* —— 加载 —— */

async function load() {
  flash('');
  $('#btn-refresh').textContent = '刷新中…';
  try {
    const mode = await api('GET', '/api/mode');
    state.mode = mode.mode;
    state.plugin = mode.plugin;

    if (mode.mode === 'plugin') {
      $('#mode-line').textContent = `DSH 内置页面 · 账号数据来自 dsh-workbuddy-xdpool（${(mode.plugin && mode.plugin.accountCount) || 0} 个账号）`;
    } else {
      $('#mode-line').textContent = `XD Pool 插件未响应（${(mode.plugin && mode.plugin.error) || '未知原因'}）`;
    }

    const ov = await api('GET', '/api/overview?credits=1');
    if (!ov.ok) {
      flash(ov.error || '加载失败');
      renderAccounts(null);
      return;
    }

    if (ov.mode === 'plugin') {
      const p = ov.plugin || {};
      state.accounts = p.accounts || [];
      renderAccounts(p);
      renderAutomation(p.automation);
      renderModels(p.models, p.selection);
      $('#automation-panel').classList.remove('hidden');
      $('#models-panel').classList.remove('hidden');

      const banner = $('#banner');
      const todayTotal = state.accounts.reduce((s, a) => s + ((a.checkin && a.checkin.todayCredit) || 0), 0);
      const pending = state.accounts.filter((a) => a.checkin && a.checkin.active && !a.checkin.todayCheckedIn).length;
      banner.innerHTML = `今日已入账 <b>${fmtNum(todayTotal)}</b> 积分 · ${pending > 0 ? `<b>${pending}</b> 个账号待签到` : '全部账号均已签到'}`;
      banner.classList.remove('hidden');
    } else {
      state.accounts = ov.accounts || [];
      renderAccounts(null);
      renderAutomation(null);
      $('#automation-panel').classList.add('hidden');
      $('#models-panel').classList.add('hidden');
      $('#banner').classList.add('hidden');
    }
  } finally {
    $('#btn-refresh').textContent = '刷新';
  }
}

async function claim(ids) {
  if (state.busy) return;
  state.busy = true;
  $('#btn-claim-all').innerHTML = '<span class="spin">◌</span> 签到中…';
  renderAccounts(state.mode === 'plugin' ? state.plugin : null);
  try {
    const r = await api('POST', '/api/claim', ids ? { ids, uids: ids } : {});
    if (!r.ok) return flash(r.error || '签到失败');
    const s = r.summary || {};
    $('#summary').classList.remove('hidden');
    $('#s-total').textContent = s.total ?? 0;
    $('#s-claimed').textContent = s.claimed ?? 0;
    $('#s-already').textContent = s.already ?? 0;
    $('#s-failed').textContent = s.failed ?? 0;
    $('#s-credit').textContent = fmtNum(s.totalCredit ?? 0);

    const failed = (r.results || []).filter((x) => !['claimed', 'already'].includes(x.outcome));
    if (failed.length) flash('部分账号失败：' + failed.map((f) => `${f.label}: ${f.message}`).join('；'));
    else if (s.claimed > 0) flash(`签到完成，共获得 ${fmtNum(s.totalCredit)} 积分`, 'ok');
    else flash('所有账号今日均已签到', 'ok');

    await load();
  } finally {
    state.busy = false;
    $('#btn-claim-all').innerHTML = '<span class="ico">⚡</span> 一键全部签到';
  }
}

/* —— 事件 —— */

$('#btn-claim-all').addEventListener('click', () => claim(null));
$('#btn-refresh').addEventListener('click', load);

$('#btn-rescan').addEventListener('click', async () => {
  $('#btn-rescan').textContent = '重扫中…';
  const r = await api('POST', '/api/accounts/rescan');
  $('#btn-rescan').textContent = '重扫账号';
  if (r.ok === false) flash(r.error || '重扫失败');
  else flash('重扫完成', 'ok');
  await load();
});

$('#btn-models-refresh').addEventListener('click', async () => {
  $('#btn-models-refresh').textContent = '刷新中…';
  const r = await api('POST', '/api/models/refresh');
  $('#btn-models-refresh').textContent = '刷新目录';
  if (r.ok === false) flash(r.error || '刷新失败');
  await load();
});

$('#list').addEventListener('click', async (e) => {
  const claimBtn = e.target.closest('.act-claim');
  if (claimBtn && !claimBtn.disabled) return void claim([claimBtn.dataset.id]);

  const toggleBtn = e.target.closest('.act-toggle');
  if (toggleBtn) {
    const r = await api('POST', '/api/accounts/disabled', {
      accountId: toggleBtn.dataset.id,
      disabled: toggleBtn.dataset.disabled === '1',
    });
    if (r.ok === false) flash(r.error || '操作失败');
    return void load();
  }

  const reserveBtn = e.target.closest('.act-reserve');
  if (reserveBtn) {
    state.reserveId = reserveBtn.dataset.id;
    $('#f-reserve').value = reserveBtn.dataset.reserve || 0;
    $('#reserve-target').textContent = '账号：' + reserveBtn.dataset.id;
    $('#modal').classList.remove('hidden');
    return;
  }

  const delBtn = e.target.closest('.act-del');
  if (delBtn) {
    if (!confirm('确定删除该账号？')) return;
    await api('POST', '/api/accounts/delete', { uid: delBtn.dataset.id });
    return void load();
  }
});

$('#jobs').addEventListener('click', async (e) => {
  const b = e.target.closest('.act-run');
  if (!b) return;
  b.disabled = true;
  b.textContent = '运行中…';
  const r = await api('POST', '/api/automation/run', { job: b.dataset.job });
  if (r.ok === false) flash(r.error || '任务触发失败');
  else flash(`已触发「${JOB_LABEL[b.dataset.job] || b.dataset.job}」`, 'ok');
  setTimeout(load, 1500);
});

$('#btn-cancel').addEventListener('click', () => $('#modal').classList.add('hidden'));
$('#btn-save').addEventListener('click', async () => {
  const reserve = Number($('#f-reserve').value) || 0;
  const r = await api('POST', '/api/accounts/credit-reserve', { accountId: state.reserveId, reserve });
  $('#modal').classList.add('hidden');
  if (r.ok === false) flash(r.error || '保存失败');
  await load();
});

/* —— 账号体检 —— */

const STATE_LABEL = { valid: '有效', invalid: '已失效', unknown: '无法确认' };

function renderCheck(r) {
  const panel = $('#check-panel');
  panel.classList.remove('hidden');
  $('#check-time').textContent = '检查于 ' + new Date(r.checkedAt).toLocaleString('zh-CN');
  state.check = r;

  const s = r.summary || {};
  const stats = [
    `<div class="check-stat"><span class="k">账号数</span><b>${s.total ?? 0}</b></div>`,
    `<div class="check-stat ok"><span class="k">有效</span><b>${s.valid ?? 0}</b></div>`,
    `<div class="check-stat bad"><span class="k">已失效</span><b>${s.invalid ?? 0}</b></div>`,
    `<div class="check-stat warn"><span class="k">无法确认</span><b>${s.unknown ?? 0}</b></div>`,
  ];
  if (!s.hasLiveFile) {
    stats.push('<div class="check-stat warn"><span class="k">桌面端登录文件</span><b>缺失</b></div>');
  }

  const rows = (r.accounts || [])
    .map((a) => {
      const badges = [];
      badges.push(`<span class="badge ${a.state === 'valid' ? 'ok' : a.state === 'invalid' ? 'bad' : 'warn'}">${STATE_LABEL[a.state] || a.state}</span>`);
      if (a.hasLiveFile) badges.push('<span class="badge info">桌面端当前登录</span>');
      else badges.push('<span class="badge">历史快照</span>');
      if (a.checkin) badges.push(a.checkin.todayCheckedIn ? '<span class="badge ok">今日已签</span>' : '<span class="badge warn">待签到</span>');

      const srcs = (a.sources || [])
        .map((x) => `[${x.kind}] ${esc(x.file)}`)
        .join('<br>');

      return `
        <div class="check-row">
          <div class="dot ${a.state}"></div>
          <div class="cmeta">
            <div class="cname">${esc(a.nickname || a.uid)} ${badges.join('')}</div>
            <div class="cdetail">${esc(a.detail || '')}</div>
            <div class="cdetail">域：${esc(a.domain || '—')} · 过期：${a.expiresAt ? fmtWhen(a.expiresAt) : '未知'}</div>
            <div class="csrc">${srcs}</div>
          </div>
        </div>`;
    })
    .join('');

  const unreadable = (r.unreadable || []).length
    ? `<div class="check-row"><div class="dot unknown"></div><div class="cmeta"><div class="cname">${r.unreadable.length} 个文件无法解析</div><div class="csrc">${r.unreadable.map((u) => esc(u.file) + ' — ' + esc(u.reason)).join('<br>')}</div></div></div>`
    : '';

  $('#check-body').innerHTML =
    `<div class="check-stats">${stats.join('')}</div>` + rows + unreadable;
}

$('#btn-check').addEventListener('click', async () => {
  $('#btn-check').textContent = '检查中…';
  $('#btn-check').disabled = true;
  try {
    const r = await api('GET', '/api/accounts/check');
    if (!r.ok) return flash(r.error || '检查失败');
    renderCheck(r);
    const s = r.summary;
    if (s.needsLogin) flash('所有账号均已失效，需要重新登录', '');
    else if (s.invalid > 0) flash(`有 ${s.invalid} 个账号登录态已失效，建议重新登录后重扫`);
    else flash(`${s.valid} 个账号登录态有效`, 'ok');
  } finally {
    $('#btn-check').textContent = '检查账号';
    $('#btn-check').disabled = false;
  }
});

/* —— 登录 —— */

$('#btn-login').addEventListener('click', () => {
  $('#login-result').textContent = '';
  $('#login-modal').classList.remove('hidden');
});
$('#btn-login-cancel').addEventListener('click', () => $('#login-modal').classList.add('hidden'));

async function doLogin(kind) {
  const btn = kind === 'web' ? $('#btn-login-web') : $('#btn-login-desktop');
  const orig = btn.querySelector('b').textContent;
  btn.querySelector('b').textContent = '处理中…';
  try {
    const r = await api('POST', kind === 'web' ? '/api/login/open' : '/api/login/desktop');
    $('#login-result').textContent = r.ok ? (r.hint || '已打开') : (r.error || '失败');
  } finally {
    btn.querySelector('b').textContent = orig;
  }
}

$('#btn-login-web').addEventListener('click', () => doLogin('web'));
$('#btn-login-desktop').addEventListener('click', () => doLogin('desktop'));

/* —— 未完成任务 —— */

function taskRow(t) {
  const claimable = t.state === 'claimable';
  const pct = t.percent;
  const reward = [];
  if (t.credit) reward.push(`+${fmtNum(t.credit)} 积分`);
  if (t.energy) reward.push(`+${fmtNum(t.energy)} 能量`);

  return `
    <div class="task ${claimable ? 'is-claimable' : ''}">
      <div class="tline">
        <span class="ttitle">${esc(t.title)}</span>
        <span class="tcode">${esc(t.taskCode)}</span>
        ${reward.length ? `<span class="treward">${reward.join(' · ')}</span>` : '<span class="treward">无奖励</span>'}
      </div>
      <div class="tprog">
        <span class="tbar"><i style="width:${pct}%"></i></span>
        <span class="tnum">${fmtNum(t.current)}/${fmtNum(t.target)}${t.target > 0 ? ` (${pct}%)` : ''}</span>
        ${claimable ? `<button class="btn btn-sm tclaim" data-task="${esc(t.taskCode)}" data-uid="${esc(t._uid)}">领取</button>` : ''}
      </div>
    </div>`;
}

function renderTasks(r) {
  const body = $('#tasks-body');
  const t = r.totals || {};

  $('#tasks-pending-badge').textContent = `未完成 ${t.pendingTasks ?? 0}`;
  $('#tasks-credit-badge').textContent = `可拿 ${fmtNum(t.pendingCredit ?? 0)} 积分`;

  if (!r.accounts || r.accounts.length === 0) {
    body.innerHTML = `<p class="hint" style="padding:0 18px 14px">${esc(r.note || '没有可检查的账号。')}</p>`;
    return;
  }

  const groups = r.accounts
    .map((a) => {
      if (!a.ok) {
        return `<div class="task-group">
          <div class="task-acct"><span class="aname">${esc(a.nickname)}</span><span class="badge bad">读取失败</span></div>
          <div class="task"><div class="tline"><span class="tcode">${esc(a.error || '')}</span></div></div>
        </div>`;
      }

      const rows = [
        ...a.claimable.map((x) => ({ ...x, _uid: a.uid })),
        ...a.pending.map((x) => ({ ...x, _uid: a.uid })),
      ];

      if (rows.length === 0) {
        return `<div class="task-group">
          <div class="task-acct"><span class="aname">${esc(a.nickname)}</span><span class="badge ok">任务全部完成</span>
            <span class="tcode">共 ${a.summary?.total ?? 0} 个</span></div>
        </div>`;
      }

      return `<div class="task-group">
        <div class="task-acct">
          <span class="aname">${esc(a.nickname)}</span>
          <span class="badge warn">未完成 ${a.pending.length}</span>
          ${a.claimable.length ? `<span class="badge ok">可领取 ${a.claimable.length}</span>` : ''}
          <span class="tcode">可拿 ${fmtNum(a.summary?.pendingCredit || 0)} 积分</span>
        </div>
        ${rows.map(taskRow).join('')}
      </div>`;
    })
    .join('');

  body.innerHTML = groups;
}

async function loadTasks() {
  $('#btn-tasks').textContent = '读取中…';
  $('#btn-tasks').disabled = true;
  try {
    const r = await api('GET', '/api/tasks');
    if (!r.ok) {
      $('#tasks-body').innerHTML = `<p class="hint" style="padding:0 18px 14px">${esc(r.error || '读取失败')}</p>`;
      return;
    }
    renderTasks(r);
    state.tasks = r;
  } finally {
    $('#btn-tasks').textContent = '刷新任务';
    $('#btn-tasks').disabled = false;
  }
}

$('#btn-tasks').addEventListener('click', loadTasks);

$('#tasks-body').addEventListener('click', async (e) => {
  const b = e.target.closest('.tclaim');
  if (!b) return;
  b.disabled = true;
  b.textContent = '领取中…';
  const r = await api('POST', '/api/tasks/claim', { uid: b.dataset.uid, taskCode: b.dataset.task });
  if (r.ok === false) flash(r.error || '领取失败');
  else flash(`已领取 ${fmtNum(r.credit || 0)} 积分`, 'ok');
  await loadTasks();
});

load();
