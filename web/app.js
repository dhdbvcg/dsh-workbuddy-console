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
      error: (parsed && (parsed.error || parsed.msg)) || t('msg.requestFailed', { status: res.status, url }),
      httpStatus: res.status,
    };
  }
  return res.json().catch(() => ({ ok: false, error: t('msg.notJson', { url }) }));
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
  if (a.disabled) badges += `<span class="badge">${t('pool.badges.disabled')}</span>`;
  if (a.cooling) badges += `<span class="badge warn">${t('pool.badges.cooling')}</span>`;
  if (a.reserved) badges += `<span class="badge warn">${t('pool.badges.reserved')}</span>`;
  if (c) {
    badges += c.todayCheckedIn
      ? `<span class="badge ok">${t('pool.badges.checkedIn')}</span>`
      : `<span class="badge warn">${t('pool.badges.pending')}</span>`;
    if (c.streakDays) {
      badges += `<span class="badge">${t('pool.streak', { days: c.streakDays })}</span>`;
      // 本地核对：上游的连签可能把漏签日也算进去。有我们的独立核对结果时，
      // 不一致就明确标注，避免被误导。
      const sc = state.streakCheck && state.streakCheck[a.id];
      if (sc && sc.suspicious && sc.localStreak !== c.streakDays) {
        badges += `<span class="badge warn">${t('pool.streakMismatch', {
          local: sc.localStreak, missed: (sc.missedDays || []).join(', '),
        })}</span>`;
      }
    } else if (a.checkinError) {
      badges += `<span class="badge bad">${t('pool.badges.checkinError')}</span>`;
    }
  }

  let creditHtml = '';
  if (cr && typeof cr.total === 'number') {
    const pkgs = (cr.packages || [])
      .map((p) => `<span class="badge">${esc(p.packageName || p.code)} ${fmtNum(p.remain)}/${fmtNum(p.size)}</span>`)
      .join('');
    creditHtml = `<div class="credit">${t('pool.remaining', { value: fmtNum(cr.total) })}</div><div class="chips">${pkgs}</div>`;
  } else if (a.creditsError) {
    creditHtml = `<div class="badge bad">${t('pool.badges.creditsError')}</div>`;
  }

  const checked = !!(c && c.todayCheckedIn);
  const can = !!(c && c.active && !checked);
  const expire = a.expiresAt ? fmtWhen(Date.parse(a.expiresAt)) : '—';
  return `
    <div class="row ${a.disabled ? 'is-disabled' : ''}" data-id="${esc(a.id)}">
      <div class="avatar">${esc((a.nickname || a.label || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="meta">
        <div class="name">${esc(a.nickname || a.label)} ${badges}</div>
        <div class="uid">${esc(a.id)}${a.domain ? ' · ' + esc(a.domain) : ''}</div>
        <div class="uid">${t('pool.expires', { date: expire })}${a.creditReserve ? t('pool.reserveLabel', { value: a.creditReserve }) : ''}</div>
        ${creditHtml}
      </div>
      <div class="right">
        <button class="btn btn-sm act-claim" ${can && !state.busy ? '' : 'disabled'} data-id="${esc(a.id)}">
          ${!c ? t('btn.claim') : !c.active ? t('btn.noActivity') : checked ? t('btn.claimed') : t('btn.claim')}
        </button>
        <button class="btn btn-sm act-toggle" data-id="${esc(a.id)}" data-disabled="${a.disabled ? '0' : '1'}">
          ${a.disabled ? t('btn.enable') : t('btn.disable')}
        </button>
        <button class="btn btn-sm act-reserve" data-id="${esc(a.id)}" data-reserve="${a.creditReserve ?? 0}">${t('btn.reserve')}</button>
      </div>
    </div>`;
}

function accountRowStandalone(a) {
  const c = a.checkin;
  let badges = '';
  if (a.expired) badges += `<span class="badge bad">${t('pool.badges.expired')}</span>`;
  if (c) {
    badges += c.todayCheckedIn
      ? `<span class="badge ok">${t('pool.badges.checkedIn')}</span>`
      : `<span class="badge warn">${t('pool.badges.pending')}</span>`;
    if (c.streakDays) badges += `<span class="badge">${t('pool.streak', { days: c.streakDays })}</span>`;
  } else if (a.checkinError) badges += `<span class="badge bad">${t('pool.badges.checkinError')}</span>`;

  let creditHtml = '';
  if (a.credits) creditHtml = `<div class="credit">${t('pool.remaining', { value: fmtNum(a.credits.total) })}</div>`;

  const checked = !!(c && c.todayCheckedIn);
  const can = !!(c && c.active && !checked);
  return `
    <div class="row" data-id="${esc(a.uid)}">
      <div class="avatar">${esc((a.nickname || '?').trim().charAt(0).toUpperCase())}</div>
      <div class="meta">
        <div class="name">${esc(a.nickname)} ${badges}</div>
        <div class="uid">${esc(a.uid)}${a.phone ? ' · ' + esc(a.phone) : ''}</div>
        <div class="uid">${t('standalone.expires', { date: fmtWhen(a.expiresAt) })} · ${esc(a.tokenPreview)}</div>
        ${creditHtml}
      </div>
      <div class="right">
        <button class="btn btn-sm act-claim" ${can && !state.busy ? '' : 'disabled'} data-id="${esc(a.uid)}">${t('btn.claim')}</button>
        <button class="btn btn-sm btn-danger act-del" data-id="${esc(a.uid)}">${t('btn.delete')}</button>
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
    const chips = [`<span class="badge info">${t('pool.mode.plugin')}</span>`];
    chips.push(`<span class="badge">${t('pool.distribution', { value: esc(p.distribution || 'round-robin') })}</span>`);
    if (p.cooling) chips.push(`<span class="badge warn">${t('pool.cooling', { count: p.cooling })}</span>`);
    if (p.region) chips.push(`<span class="badge">${t('pool.region', { value: esc(p.region) })}</span>`);
    $('#pool-chips').innerHTML = chips.join('');
  } else {
    $('#pool-chips').innerHTML = `<span class="badge">${t('pool.mode.standalone')}</span>`;
  }
}

/* —— 自动化 —— */

/** 任务 key → 文案 key（文案随语言切换，所以每次渲染都重新取） */
const JOB_KEYS = ['checkin', 'report', 'tasks', 'streak', 'travel'];

function renderAutomation(auto) {
  if (!auto) {
    $('#jobs').innerHTML = `<p class="hint" style="padding:0 18px 14px">${t('auto.unavailable')}</p>`;
    $('#auto-state').innerHTML = '';
    $('#auto-hint').textContent = '';
    return;
  }
  $('#auto-state').innerHTML = auto.running
    ? `<span class="badge ok">${t('auto.running')}</span>`
    : `<span class="badge">${t('auto.stopped')}</span>`;

  const hoursOf = (j) => {
    const h = auto[j + 'Hours'];
    return Array.isArray(h) && h.length ? t('auto.hours', { hours: h.join('/') }) : '';
  };

  $('#jobs').innerHTML = JOB_KEYS.map((key) => {
    const s = (auto.jobs || {})[key] || {};
    const bits = [];
    if (s.credit) bits.push(t('auto.credit', { value: fmtNum(s.credit) }));
    if (s.energy) bits.push(t('auto.energy', { value: fmtNum(s.energy) }));
    if (s.claimed) bits.push(t('auto.claimed', { count: s.claimed }));
    if (s.failed) bits.push(t('auto.failed', { count: s.failed }));
    return `
        <div class="job">
          <div class="jt"><span>${t('auto.job.' + key)}${hoursOf(key)}</span></div>
          <div class="jv">${bits.length ? bits.join(' · ') : t('auto.noRecord')}</div>
          <button class="btn btn-sm jbtn act-run" data-job="${key}" ${auto.runInProgress ? 'disabled' : ''}>${t('btn.run')}</button>
        </div>`;
  }).join('');

  const earned = auto.earningsToday || {};
  const total = Object.values(earned).reduce((s, e) => s + ((e && e.credit) || 0), 0);
  $('#auto-hint').textContent = total > 0 ? t('auto.total', { credit: fmtNum(total) }) : t('auto.none');
}

/* —— 模型池 —— */

function renderModels(models, selection) {
  if (!Array.isArray(models) || !models.length) {
    $('#models').innerHTML = `<p class="hint">${t('models.empty')}</p>`;
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
  $('#btn-refresh').textContent = t('btn.refreshing');
  try {
    // mode 与 overview 打的是同一个池 status，串行等于把同一个慢请求
    // 等两遍（池 status 实测 1.3s+）。并发发起后墙钟时间只剩一遍。
    const modeP = api('GET', '/api/mode');
    // credits=1 是早期遗留参数：后端 overview 路由从来不读它，
    // 池 status 走的是默认档（不拉每个账号的 credits，2N 次上游往返）。
    // 余额显示改由 /api/overview 返回的 accounts[].credits 提供。
    const ovP = api('GET', '/api/overview');
    const mode = await modeP;
    state.mode = mode.mode;
    state.plugin = mode.plugin;

    if (mode.mode === 'plugin') {
      $('#mode-line').textContent = t('app.mode.plugin', { count: (mode.plugin && mode.plugin.accountCount) || 0 });
    } else {
      $('#mode-line').textContent = t('app.mode.offline', { error: (mode.plugin && mode.plugin.error) || 'unknown' });
    }

    const ov = await ovP;
    state.streakCheck = (ov && ov.streakCheck) || null;
    if (!ov.ok) {
      flash(ov.error || t('msg.loadFailed'));
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
      banner.innerHTML =
        t('banner.today', { credit: fmtNum(todayTotal) }) +
        (pending > 0 ? t('banner.pending', { count: pending }) : t('banner.allDone'));
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
    $('#btn-refresh').textContent = t('btn.refresh');
  }
}

async function claim(ids) {
  if (state.busy) return;
  state.busy = true;
  $('#btn-claim-all').innerHTML = `<span class="spin">◌</span> ${t('btn.claiming')}`;
  renderAccounts(state.mode === 'plugin' ? state.plugin : null);
  try {
    const r = await api('POST', '/api/claim', ids ? { ids, uids: ids } : {});
    if (!r.ok) return flash(r.error || t('msg.claimFailed'));
    const s = r.summary || {};
    $('#summary').classList.remove('hidden');
    $('#s-total').textContent = s.total ?? 0;
    $('#s-claimed').textContent = s.claimed ?? 0;
    $('#s-already').textContent = s.already ?? 0;
    $('#s-failed').textContent = s.failed ?? 0;
    $('#s-credit').textContent = fmtNum(s.totalCredit ?? 0);

    const failed = (r.results || []).filter((x) => !['claimed', 'already'].includes(x.outcome));
    if (failed.length) {
      flash(t('msg.partialFailed', { list: failed.map((f) => `${f.label}: ${f.message}`).join('; ') }));
    } else if (s.claimed > 0) {
      flash(t('msg.claimDone', { credit: fmtNum(s.totalCredit) }), 'ok');
    } else {
      flash(t('msg.allCheckedIn'), 'ok');
    }

    await load();
  } finally {
    state.busy = false;
    $('#btn-claim-all').innerHTML = `<span class="ico">⚡</span> <span>${t('btn.claimAll')}</span>`;
  }
}

/* —— 事件 —— */

$('#btn-claim-all').addEventListener('click', () => claim(null));
$('#btn-refresh').addEventListener('click', load);

$('#btn-rescan').addEventListener('click', async () => {
  $('#btn-rescan').textContent = t('btn.rescanning');
  const r = await api('POST', '/api/accounts/rescan');
  $('#btn-rescan').textContent = t('btn.rescan');
  if (r.ok === false) flash(r.error || t('msg.rescanFailed'));
  else flash(t('msg.rescanDone'), 'ok');
  await load();
});

$('#btn-models-refresh').addEventListener('click', async () => {
  $('#btn-models-refresh').textContent = t('btn.refreshing');
  const r = await api('POST', '/api/models/refresh');
  $('#btn-models-refresh').textContent = t('btn.modelsRefresh');
  if (r.ok === false) flash(r.error || t('msg.modelsFailed'));
  else flash(t('msg.modelsRefreshed'), 'ok');
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
    if (r.ok === false) flash(r.error || t('msg.operationFailed'));
    return void load();
  }

  const reserveBtn = e.target.closest('.act-reserve');
  if (reserveBtn) {
    state.reserveId = reserveBtn.dataset.id;
    $('#f-reserve').value = reserveBtn.dataset.reserve || 0;
    $('#reserve-target').textContent = t('reserve.account', { id: reserveBtn.dataset.id });
    $('#modal').classList.remove('hidden');
    return;
  }

  const delBtn = e.target.closest('.act-del');
  if (delBtn) {
    if (!confirm(t('msg.confirmDelete'))) return;
    await api('POST', '/api/accounts/delete', { uid: delBtn.dataset.id });
    return void load();
  }
});

$('#jobs').addEventListener('click', async (e) => {
  const b = e.target.closest('.act-run');
  if (!b) return;
  b.disabled = true;
  b.textContent = t('btn.running');
  const r = await api('POST', '/api/automation/run', { job: b.dataset.job });
  if (r.ok === false) flash(r.error || t('msg.jobFailed'));
  else flash(t('msg.jobStarted', { job: t('auto.job.' + b.dataset.job) }), 'ok');
  setTimeout(load, 1500);
});

$('#btn-cancel').addEventListener('click', () => $('#modal').classList.add('hidden'));
$('#btn-save').addEventListener('click', async () => {
  const reserve = Number($('#f-reserve').value) || 0;
  const r = await api('POST', '/api/accounts/credit-reserve', { accountId: state.reserveId, reserve });
  $('#modal').classList.add('hidden');
  if (r.ok === false) flash(r.error || t('msg.saveFailed'));
  await load();
});

/* —— 账号体检 —— */

/** 体检状态 → 文案 key */
const STATE_KEY = { valid: 'check.state.valid', invalid: 'check.state.invalid', unknown: 'check.state.unknown' };

function renderCheck(r) {
  const panel = $('#check-panel');
  panel.classList.remove('hidden');
  const locale = WB_I18N.lang() === 'zh' ? 'zh-CN' : 'en-US';
  $('#check-time').textContent = t('check.at', { time: new Date(r.checkedAt).toLocaleString(locale) });
  state.check = r;

  const s = r.summary || {};
  const stats = [
    `<div class="check-stat"><span class="k">${t('check.stat.accounts')}</span><b>${s.total ?? 0}</b></div>`,
    `<div class="check-stat ok"><span class="k">${t('check.stat.valid')}</span><b>${s.valid ?? 0}</b></div>`,
    `<div class="check-stat bad"><span class="k">${t('check.stat.invalid')}</span><b>${s.invalid ?? 0}</b></div>`,
    `<div class="check-stat warn"><span class="k">${t('check.stat.unknown')}</span><b>${s.unknown ?? 0}</b></div>`,
  ];
  if (!s.hasLiveFile) {
    stats.push(`<div class="check-stat warn"><span class="k">${t('check.stat.noLive')}</span><b>${t('check.stat.missing')}</b></div>`);
  }

  const rows = (r.accounts || [])
    .map((a) => {
      const badges = [];
      badges.push(
        `<span class="badge ${a.state === 'valid' ? 'ok' : a.state === 'invalid' ? 'bad' : 'warn'}">${t(STATE_KEY[a.state] || a.state)}</span>`,
      );
      badges.push(
        a.hasLiveFile
          ? `<span class="badge info">${t('check.badge.live')}</span>`
          : `<span class="badge">${t('check.badge.snapshot')}</span>`,
      );
      if (a.checkin) {
        badges.push(
          a.checkin.todayCheckedIn
            ? `<span class="badge ok">${t('check.badge.checkedIn')}</span>`
            : `<span class="badge warn">${t('check.badge.pending')}</span>`,
        );
      }

      const srcs = (a.sources || []).map((x) => `[${x.kind}] ${esc(x.file)}`).join('<br>');

      return `
        <div class="check-row">
          <div class="dot ${a.state}"></div>
          <div class="cmeta">
            <div class="cname">${esc(a.nickname || a.uid)} ${badges.join('')}</div>
            <div class="cdetail">${esc(a.detail || '')}</div>
            <div class="cdetail">${t('check.domain', { domain: esc(a.domain || '—'), date: a.expiresAt ? fmtWhen(a.expiresAt) : '—' })}</div>
            <div class="csrc">${srcs}</div>
          </div>
        </div>`;
    })
    .join('');

  const unreadable = (r.unreadable || []).length
    ? `<div class="check-row"><div class="dot unknown"></div><div class="cmeta"><div class="cname">${t('check.unreadable', { count: r.unreadable.length })}</div><div class="csrc">${r.unreadable.map((u) => esc(u.file) + ' — ' + esc(u.reason)).join('<br>')}</div></div></div>`
    : '';

  $('#check-body').innerHTML = `<div class="check-stats">${stats.join('')}</div>` + rows + unreadable;
}

$('#btn-check').addEventListener('click', async () => {
  $('#btn-check').textContent = t('btn.checking');
  $('#btn-check').disabled = true;
  try {
    const r = await api('GET', '/api/accounts/check');
    if (!r.ok) return flash(r.error || t('msg.loadFailed'));
    renderCheck(r);
    const s = r.summary;
    if (s.needsLogin) flash(t('check.needsLogin'));
    else if (s.invalid > 0) flash(t('check.someInvalid', { count: s.invalid }));
    else flash(t('check.allValid', { count: s.valid }), 'ok');
  } finally {
    $('#btn-check').textContent = t('btn.check');
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
  const label = btn.querySelector('b');
  const orig = label.textContent;
  label.textContent = t('login.processing');
  try {
    const r = await api('POST', kind === 'web' ? '/api/login/open' : '/api/login/desktop');
    $('#login-result').textContent = r.ok ? t('login.done') : r.error || t('msg.operationFailed');
  } finally {
    label.textContent = orig;
  }
}

$('#btn-login-web').addEventListener('click', () => doLogin('web'));
$('#btn-login-desktop').addEventListener('click', () => doLogin('desktop'));

/* —— 未完成任务 —— */

// 注意：参数名不能叫 t —— 会遮蔽全局翻译函数 t()。
function taskRow(task) {
  const claimable = task.state === 'claimable';
  const pct = task.percent;
  const reward = [];
  if (task.credit) reward.push(t('auto.credit', { value: fmtNum(task.credit) }));
  if (task.energy) reward.push(t('auto.energy', { value: fmtNum(task.energy) }));

  return `
    <div class="task ${claimable ? 'is-claimable' : ''}">
      <div class="tline">
        <span class="ttitle">${esc(task.title)}</span>
        <span class="tcode">${esc(task.taskCode)}</span>
        ${reward.length ? `<span class="treward">${reward.join(' · ')}</span>` : `<span class="treward">${t('tasks.noReward')}</span>`}
      </div>
      <div class="tprog">
        <span class="tbar"><i style="width:${pct}%"></i></span>
        <span class="tnum">${fmtNum(task.current)}/${fmtNum(task.target)}${task.target > 0 ? ` (${pct}%)` : ''}</span>
        ${claimable ? `<button class="btn btn-sm tclaim" data-task="${esc(task.taskCode)}" data-uid="${esc(task._uid)}">${t('tasks.claim')}</button>` : ''}
      </div>
    </div>`;
}

function renderTasks(r) {
  const body = $('#tasks-body');
  const totals = r.totals || {};

  $('#tasks-pending-badge').textContent = t('tasks.pendingBadge', { count: totals.pendingTasks ?? 0 });
  $('#tasks-credit-badge').textContent = t('tasks.creditBadge', { credit: fmtNum(totals.pendingCredit ?? 0) });

  if (!r.accounts || r.accounts.length === 0) {
    body.innerHTML = `<p class="hint" style="padding:0 18px 14px">${esc(r.note || t('tasks.noAccounts'))}</p>`;
    return;
  }

  const groups = r.accounts
    .map((a) => {
      if (!a.ok) {
        return `<div class="task-group">
          <div class="task-acct"><span class="aname">${esc(a.nickname)}</span><span class="badge bad">${t('tasks.group.failed')}</span></div>
          <div class="task"><div class="tline"><span class="tcode">${esc(a.error || '')}</span></div></div>
        </div>`;
      }

      const rows = [
        ...a.claimable.map((x) => ({ ...x, _uid: a.uid })),
        ...a.pending.map((x) => ({ ...x, _uid: a.uid })),
      ];

      if (rows.length === 0) {
        return `<div class="task-group">
          <div class="task-acct"><span class="aname">${esc(a.nickname)}</span><span class="badge ok">${t('tasks.group.allDone')}</span>
            <span class="tcode">${t('tasks.group.total', { count: (a.summary && a.summary.total) || 0 })}</span></div>
        </div>`;
      }

      return `<div class="task-group">
        <div class="task-acct">
          <span class="aname">${esc(a.nickname)}</span>
          <span class="badge warn">${t('tasks.group.pending', { count: a.pending.length })}</span>
          ${a.claimable.length ? `<span class="badge ok">${t('tasks.group.claimable', { count: a.claimable.length })}</span>` : ''}
          <span class="tcode">${t('tasks.group.credit', { credit: fmtNum((a.summary && a.summary.pendingCredit) || 0) })}</span>
        </div>
        ${rows.map(taskRow).join('')}
      </div>`;
    })
    .join('');

  body.innerHTML = groups;
}

async function loadTasks() {
  const btn = $('#btn-tasks');
  // 立刻反馈，不要让用户对着没变化的按钮猜是不是没点上
  btn.textContent = t('btn.tasksLoading');
  btn.disabled = true;
  try {
    const r = await api('GET', '/api/tasks');
    if (!r.ok) {
      $('#tasks-body').innerHTML = `<p class="hint" style="padding:0 18px 14px">${esc(r.error || t('msg.loadFailed'))}</p>`;
      return;
    }
    renderTasks(r);
    state.tasks = r;
    // 后端命中 stale 缓存时先给的是旧数据，几秒后后台刷新的会到。
    // 这里主动补一次，让用户最终一定看到最新状态。
    if (r.stale) {
      setTimeout(() => {
        api('GET', '/api/tasks').then((fresh) => {
          if (fresh && fresh.ok && !fresh.stale) {
            renderTasks(fresh);
            state.tasks = fresh;
          }
        }).catch(() => {});
      }, 2500);
    }
  } finally {
    btn.textContent = t('btn.tasks');
    btn.disabled = false;
  }
}

$('#btn-tasks').addEventListener('click', loadTasks);

$('#tasks-body').addEventListener('click', async (e) => {
  const b = e.target.closest('.tclaim');
  if (!b) return;
  b.disabled = true;
  b.textContent = t('tasks.claiming');
  const r = await api('POST', '/api/tasks/claim', { uid: b.dataset.uid, taskCode: b.dataset.task });
  if (r.ok === false) flash(r.error || t('tasks.claimFailed'));
  else flash(t('tasks.claimed', { credit: fmtNum(r.credit || 0) }), 'ok');
  await loadTasks();
});

/* —— 签到历史 —— */

/**
 * 画一张内联 SVG 折线图。
 *
 * 为什么不用 canvas / 图表库：
 *   这是个无打包步骤的单页，引入图表库要额外托管一堆文件；
 *   而趋势图只需要一条折线，SVG 十几行就够，还能跟随主题色。
 */
function sparkline(series) {
  if (!series || series.length < 2) {
    return `<p class="hint" style="padding:0 18px 14px">${t('history.empty')}</p>`;
  }

  const W = 640;
  const H = 120;
  const PAD = 8;
  const values = series.map((d) => d.credit);
  const max = Math.max(...values);
  const min = Math.min(...values);
  // 全平时给一个假的跨度，避免除以 0
  const span = max - min || 1;
  const stepX = (W - PAD * 2) / Math.max(1, series.length - 1);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const pts = series.map((d, i) => [PAD + i * stepX, y(d.credit)]);
  const line = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  // 面积填充：把折线闭合到底部
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H - PAD} L${pts[0][0].toFixed(1)} ${H - PAD} Z`;

  const dots = pts
    .map((p, i) => {
      const d = series[i];
      const delta = d.delta;
      const title =
        `${d.day}: ${fmtNum(d.credit)}` +
        (delta === null ? '' : delta > 0 ? ` (+${fmtNum(delta)})` : delta < 0 ? ` (${fmtNum(delta)})` : ' (=)');
      return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5"><title>${esc(title)}</title></circle>`;
    })
    .join('');

  return `
    <div class="chart-wrap">
      <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="credit trend">
        <path class="chart-area" d="${area}" />
        <path class="chart-line" d="${line}" />
        ${dots}
      </svg>
      <div class="chart-axis">
        <span>${esc(series[0].day)}</span>
        <span>${esc(series[series.length - 1].day)}</span>
      </div>
    </div>`;
}

function renderHistory(r) {
  const body = $('#history-body');
  const series = r.series || [];

  if (series.length === 0) {
    body.innerHTML = `<p class="hint" style="padding:0 18px 14px">${t('history.empty')}</p>`;
    return;
  }

  const latest = series[series.length - 1];
  const best = series.reduce((a, b) => (b.credit > a.credit ? b : a), series[0]);

  const stats = `
    <div class="check-stats">
      <div class="check-stat"><span class="k">${t('history.totalDays', { count: series.length })}</span><b>${series.length}</b></div>
      <div class="check-stat ok"><span class="k">${t('history.latest')}</span><b>${fmtNum(latest.credit)}</b></div>
      <div class="check-stat warn"><span class="k">${t('history.bestDay')}</span><b>${fmtNum(best.credit)}</b></div>
    </div>`;

  // 最近 14 天列表（倒序）
  const rows = series
    .slice(-14)
    .reverse()
    .map((d) => {
      const delta = d.delta;
      let dtxt;
      if (delta === null) dtxt = `<span class="hint">${t('history.noDelta')}</span>`;
      else if (delta > 0) dtxt = `<span class="delta up">${t('history.deltaUp', { value: fmtNum(delta) })}</span>`;
      else if (delta < 0) dtxt = `<span class="delta down">${t('history.deltaDown', { value: fmtNum(delta) })}</span>`;
      else dtxt = `<span class="hint">${t('history.deltaFlat')}</span>`;

      return `
        <div class="hist-row">
          <span class="hday">${esc(d.day)}</span>
          <span class="hcredit">${fmtNum(d.credit)}</span>
          <span class="hacct">${d.checkedIn}/${d.accounts}</span>
          ${dtxt}
        </div>`;
    })
    .join('');

  const accts = (r.accounts || [])
    .map(
      (a) => `<div class="hist-row">
        <span class="hday">${esc(a.nickname || a.uid)}</span>
        <span class="hcredit">${t('history.lastCredit', { credit: fmtNum(a.lastCredit) })}</span>
        <span class="hacct">${t('history.checkedInDays', { checked: a.checkedInDays, observed: a.observedDays })}</span>
      </div>`,
    )
    .join('');

  body.innerHTML =
    stats +
    sparkline(series) +
    `<div class="hist-head">${t('history.days', { days: r.windowDays })}</div>` +
    rows +
    (accts ? `<div class="hist-head">${t('history.accountsTitle')}</div>` + accts : '');
}

async function loadHistory() {
  $('#btn-history').textContent = t('btn.tasksLoading');
  $('#btn-history').disabled = true;
  try {
    const days = Number($('#history-days').value) || 30;
    const r = await api('GET', '/api/history?days=' + days);
    if (!r.ok) {
      $('#history-body').innerHTML = `<p class="hint" style="padding:0 18px 14px">${esc(r.error || t('msg.loadFailed'))}</p>`;
      return;
    }
    state.history = r;
    renderHistory(r);
  } finally {
    $('#btn-history').textContent = t('btn.history');
    $('#btn-history').disabled = false;
  }
}

$('#btn-history').addEventListener('click', loadHistory);
$('#history-days').addEventListener('change', loadHistory);

$('#btn-history-clear').addEventListener('click', async () => {
  if (!confirm(t('history.clearConfirm'))) return;
  const r = await api('POST', '/api/history/clear');
  if (r.ok === false) flash(r.error || t('msg.operationFailed'));
  else flash(t('history.cleared'), 'ok');
  await loadHistory();
});

/* —— 积分消耗 —— */

function renderSpend(r) {
  const body = $('#spend-body');

  if (!r.samples || r.samples === 0) {
    body.innerHTML = `<p class="hint" style="padding:0 18px 14px">${t('spend.empty')}</p>`;
    return;
  }

  const stats = `
    <div class="check-stats">
      <div class="check-stat bad"><span class="k">${t('spend.spent')}</span><b>${fmtNum(r.spent)}</b></div>
      <div class="check-stat ok"><span class="k">${t('spend.gained')}</span><b>${fmtNum(r.gained)}</b></div>
      <div class="check-stat"><span class="k">${t('spend.net')}</span><b>${r.net >= 0 ? '+' : ''}${fmtNum(r.net)}</b></div>
    </div>`;

  const rows = (r.perAccount || [])
    .map(
      (a) => `<div class="hist-row">
        <span class="hday">${esc(a.nickname || a.uid)}</span>
        <span class="hacct">${t('spend.accountRow', { spent: fmtNum(a.spent), gained: fmtNum(a.gained), credit: fmtNum(a.lastCredit) })}</span>
      </div>`,
    )
    .join('');

  body.innerHTML =
    stats +
    `<div class="hist-head">${t('spend.samples', { count: r.samples, days: r.spanDays || r.days })}</div>` +
    rows +
    `<p class="hint" style="padding:0 18px 14px">${t('spend.note')}</p>`;
}

async function loadSpend() {
  $('#btn-spend').textContent = t('btn.tasksLoading');
  $('#btn-spend').disabled = true;
  try {
    // 先采一次样再读汇总，保证「刷新消耗」立刻反映当前余额
    await api('POST', '/api/credit/sample');
    const days = Number($('#spend-days').value) || 7;
    const r = await api('GET', '/api/credit/summary?days=' + days);
    if (!r.ok) {
      $('#spend-body').innerHTML = `<p class="hint" style="padding:0 18px 14px">${esc(r.error || t('msg.loadFailed'))}</p>`;
      return;
    }
    state.spend = r;
    renderSpend(r);
  } finally {
    $('#btn-spend').textContent = t('btn.spend');
    $('#btn-spend').disabled = false;
  }
}

$('#btn-spend').addEventListener('click', loadSpend);
$('#spend-days').addEventListener('change', loadSpend);

/* —— 技能市场 —— */

/** 当前语言下技能该显示的名字 / 描述 */
function skillName(s) {
  return WB_I18N.lang() === 'zh' ? s.displayNameZh || s.name : s.displayNameEn || s.name;
}
function skillDesc(s) {
  return WB_I18N.lang() === 'zh' ? s.descriptionZh || '' : s.descriptionEn || '';
}

function skillRow(s, installedSet) {
  const installed = installedSet.has(s.name);
  const nameOk = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name);
  const desc = skillDesc(s);

  return `
    <div class="skill-row">
      <div class="skill-meta">
        <div class="skill-name">
          ${esc(skillName(s))}
          <span class="tcode">${esc(s.name)}</span>
          ${installed ? `<span class="badge ok">${t('skills.installed')}</span>` : ''}
          ${!nameOk ? `<span class="badge bad">${t('skills.invalidName')}</span>` : ''}
        </div>
        <div class="skill-desc">${esc(desc.slice(0, 220))}${desc.length > 220 ? '…' : ''}</div>
        <div class="skill-foot">
          <span class="tcode">v${esc(s.version || '?')}</span>
          <span class="tcode">${esc((s.categories || []).join(' · '))}</span>
          <span class="tcode">${t('skills.uses', { count: fmtNum(s.useCount) })}</span>
        </div>
      </div>
      <div class="skill-actions">
        ${
          installed
            ? `<button class="btn btn-sm btn-danger act-skill-del" data-name="${esc(s.name)}">${t('skills.uninstall')}</button>
               <button class="btn btn-sm act-skill-add" data-id="${esc(s.skillId)}" data-name="${esc(s.name)}" data-version="${esc(s.version || '')}" data-ow="1">${t('skills.overwrite')}</button>`
            : `<button class="btn btn-sm btn-primary act-skill-add" data-id="${esc(s.skillId)}" data-name="${esc(s.name)}" data-version="${esc(s.version || '')}" ${nameOk ? '' : 'disabled'}>${t('skills.install')}</button>`
        }
      </div>
    </div>`;
}

function renderSkills(r) {
  const body = $('#skills-body');
  const installedSet = new Set(r.installed || []);
  const skills = r.skills || [];

  if (skills.length === 0) {
    body.innerHTML = `<p class="hint" style="padding:0 18px 14px">${t('skills.empty')}</p>`;
    return;
  }

  body.innerHTML =
    `<div class="hist-head">${t('skills.total', { total: fmtNum(r.total || 0), installed: installedSet.size })}</div>` +
    skills.map((s) => skillRow(s, installedSet)).join('') +
    `<p class="hint" style="padding:0 18px 14px">${t('skills.dir', { dir: esc(r.skillsDir || '') })}<br>${t('skills.restartHint')}</p>`;
}

async function loadSkills() {
  $('#btn-skills').textContent = t('skills.loading');
  $('#btn-skills').disabled = true;
  try {
    const kw = $('#skills-search').value.trim();
    const q = new URLSearchParams({ page: '1', pageSize: '30' });
    if (kw) q.set('keyword', kw);
    const r = await api('GET', '/api/skills/list?' + q.toString());
    if (!r.ok) {
      $('#skills-body').innerHTML = `<p class="hint" style="padding:0 18px 14px">${esc(r.error || t('msg.loadFailed'))}</p>`;
      return;
    }
    state.skills = r;
    renderSkills(r);
  } finally {
    $('#btn-skills').textContent = t('btn.skills');
    $('#btn-skills').disabled = false;
  }
}

$('#btn-skills').addEventListener('click', loadSkills);
$('#skills-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadSkills();
});

$('#skills-body').addEventListener('click', async (e) => {
  const addBtn = e.target.closest('.act-skill-add');
  if (addBtn) {
    const name = addBtn.dataset.name;
    const orig = addBtn.textContent;
    addBtn.disabled = true;
    addBtn.textContent = t('skills.installing');
    try {
      const r = await api('POST', '/api/skills/install', {
        skillId: addBtn.dataset.id,
        name,
        version: addBtn.dataset.version,
        overwrite: addBtn.dataset.ow === '1',
      });
      if (r.ok === false) flash(r.error || t('msg.operationFailed'));
      else flash(t('skills.installedAt', { name, files: r.files, size: (r.bytes / 1024).toFixed(1) + ' KB' }), 'ok');
    } finally {
      addBtn.disabled = false;
      addBtn.textContent = orig;
      await loadSkills();
    }
    return;
  }

  const delBtn = e.target.closest('.act-skill-del');
  if (delBtn) {
    const name = delBtn.dataset.name;
    if (!confirm(t('msg.confirmDelete') + '\n' + name)) return;
    delBtn.disabled = true;
    delBtn.textContent = t('skills.uninstalling');
    const r = await api('POST', '/api/skills/uninstall', { name });
    if (r.ok === false) flash(r.error || t('msg.operationFailed'));
    else flash(t('skills.uninstalledAt', { name }), 'ok');
    await loadSkills();
  }
});

/* —— 语言切换 —— */

$('#btn-lang').addEventListener('click', () => {
  const next = WB_I18N.lang() === 'zh' ? 'en' : 'zh';
  WB_I18N.setLang(next);
});

/** 切换语言后重绘所有动态内容（静态 DOM 由 applyI18n 处理） */
window.onLangChanged = function () {
  renderAccounts(state.mode === 'plugin' ? state.plugin : null);
  if (state.plugin) {
    renderAutomation(state.plugin.automation);
    renderModels(state.plugin.models, state.plugin.selection);
  }
  if (state.check) renderCheck(state.check);
  if (state.tasks) renderTasks(state.tasks);
  if (state.history) renderHistory(state.history);
  if (state.spend) renderSpend(state.spend);
  if (state.skills) renderSkills(state.skills);
  load();
};

// 首次进入：先把静态文案按语言填好，再拉数据。
// documentElement.lang 也要跟着设置 —— 否则英文界面下 html lang 仍是 zh-CN，
// 会影响屏幕阅读器与浏览器翻译提示。
document.documentElement.lang = WB_I18N.lang() === 'zh' ? 'zh-CN' : 'en';
WB_I18N.applyI18n(document);
load();
// 消耗面板独立加载：它需要先采样再汇总，比概览慢，不该拖住首屏
loadSpend();
