/**
 * WorkBuddy 技能市场。
 *
 * 实测确认（不是推测）：
 *   POST /v2/operation-platform/market/skill/list          列出（10000 个）
 *   POST /v2/operation-platform/market/skill/get-by-ids    按 id 取详情
 *   POST /v2/operation-platform/market/skill/download-url  取 zip 下载地址
 *
 * 技能包是标准结构（与 DSH 完全兼容）：
 *   SKILL.md          —— YAML frontmatter + 正文
 *   reference.md      —— 可选参考资料
 *   scripts/*         —— 可选脚本
 *   workbuddy.json    —— WorkBuddy 自己的元数据
 *
 * 装到哪里：<dshHome>/skills/<name>/SKILL.md
 *   dsh-skill-filesystem 会扫描该目录并 **watch**，
 *   所以装完 DSH 下次读目录就能看到，不需要重启。
 *
 * 两个方向的转换：
 *   category    —— WorkBuddy 用 kebab 分类（如 productivity-tools）
 *   frontmatter —— 上游的 allowed-tools/visibility 等字段 DSH 不认识，
 *                  安装时保留原样（DSH 只读它认识的键，多余的会被忽略）。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 默认 CDN 前缀（技能包从这里下载，不需要鉴权，签名在 URL 里） */
const DEFAULT_ENDPOINT = 'https://copilot.tencent.com';

/** 单页最大条数（实测上游是按 pageSize 给的，给太大可能被截断） */
const MAX_PAGE_SIZE = 50;

/** 技能包解压后的体积上限，防 zip 炸弹 */
const MAX_EXTRACT_BYTES = 50 * 1024 * 1024;

/** 单个技能包允许的最大下载体积 */
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;

//#region 路径

/** DSH 根目录 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** DSH 的用户技能目录（dsh-skill-filesystem 的 user-dsh 源） */
export function skillsDir() {
  return path.join(dshHome(), 'skills');
}

/** 我们的暂存目录（放下载的 zip） */
export function stagingDir() {
  const base = process.env.WB_CONSOLE_DATA_DIR || path.join(dshHome(), 'plugin-data', 'dsh-workbuddy-console');
  return path.join(base, 'skill-downloads');
}

//#endregion

//#region 上游 API

/** 组装鉴权头（与体检模块同一套） */
function headers(auth) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: 'Bearer ' + (auth && auth.accessToken ? auth.accessToken : ''),
    'X-User-Id': (auth && auth.uid) || '',
    'User-Agent': 'WorkBuddy/5.4.7',
    'X-IDE-Type': 'WorkBuddy',
    'X-Product': 'WorkBuddy',
  };
}

async function post(auth, p, body, opts = {}) {
  const endpoint = ((auth && auth.endpoint) || DEFAULT_ENDPOINT).replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25000);
  try {
    const r = await fetch(endpoint + p, {
      method: 'POST',
      headers: headers(auth),
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
    const text = await r.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* 非 JSON */
    }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, code: 'UNAUTHORIZED', error: '登录态已失效（HTTP ' + r.status + '）' };
    }
    if (!parsed) {
      return { ok: false, code: 'BAD_RESPONSE', error: '上游返回非 JSON（HTTP ' + r.status + '）' };
    }
    if (parsed.code !== 0) {
      return { ok: false, code: parsed.code, error: parsed.msg || '上游返回 code=' + parsed.code };
    }
    return { ok: true, data: parsed.data };
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    return { ok: false, code: 'NETWORK', error: aborted ? '请求超时' : '网络错误：' + (e && e.message ? e.message : String(e)) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把上游的 skill 行归一化成界面用的形状。
 * 保留中英两个名字与描述，界面按当前语言选。
 */
function shapeSkill(s) {
  return {
    skillId: s.skill_id,
    name: s.name,
    version: s.version || '',
    displayNameZh: s.display_name_zh || s.name,
    displayNameEn: s.display_name_en || s.name,
    descriptionZh: s.description_zh || s.description || '',
    descriptionEn: s.description_en || s.description || '',
    icon: s.icon || '',
    categories: Array.isArray(s.categories) ? s.categories : [],
    source: s.source || '',
    featured: Number(s.featured) || 0,
    preinstalled: s.preinstalled === true,
    lifecycleStatus: s.lifecycle_status || '',
    useCount: (s.use_stat && Number(s.use_stat.use_count)) || 0,
    installCount: (s.use_stat && Number(s.use_stat.install_count)) || 0,
    updatedAt: s.updated_at || '',
  };
}

/**
 * 列出技能市场的技能。
 *
 * @param {object} auth 凭证
 * @param {object} opts { page, pageSize, keyword }
 */
export async function listSkills(auth, opts = {}) {
  const page = Math.max(1, Number(opts.page) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(opts.pageSize) || 20));

  const body = { page, page_size: pageSize };
  // 上游接受 pageSize 的蛇形与驼峰两种写法，都带上以求稳
  body.pageSize = pageSize;
  if (opts.keyword) {
    body.keyword = String(opts.keyword);
    body.search_keyword = String(opts.keyword);
  }

  const r = await post(auth, '/v2/operation-platform/market/skill/list', body, { timeoutMs: 30000 });
  if (!r.ok) return r;

  const d = r.data || {};
  const skills = Array.isArray(d.skills) ? d.skills : [];
  return {
    ok: true,
    page,
    pageSize,
    total: Number(d.total_count) || 0,
    skills: skills.map(shapeSkill),
  };
}

/** 按 id 取技能详情 */
export async function getSkillsByIds(auth, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: true, skills: [] };
  const r = await post(auth, '/v2/operation-platform/market/skill/get-by-ids', { skill_ids: ids });
  if (!r.ok) return r;
  const d = r.data || {};
  return { ok: true, skills: (Array.isArray(d.skills) ? d.skills : []).map(shapeSkill) };
}

/** 取下载地址 */
export async function downloadUrl(auth, skillId, version) {
  const r = await post(auth, '/v2/operation-platform/market/skill/download-url', {
    skill_id: skillId,
    version: version || undefined,
  });
  if (!r.ok) return r;
  const d = r.data || {};
  if (!d.download_url) return { ok: false, code: 'NO_URL', error: '上游没有返回下载地址' };
  return { ok: true, url: d.download_url, filename: d.filename || '', expiresAt: d.expires_at || 0 };
}

//#endregion

//#region 已装检测

/**
 * 读本地已安装的技能（目录名 → 元信息）。
 *
 * 只认 `<dir>/SKILL.md` 形式 —— 那正是 dsh-skill-filesystem 的发现规则。
 */
export function listInstalled() {
  const root = skillsDir();
  const out = new Map();
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const md = path.join(root, e.name, 'SKILL.md');
    if (!fs.existsSync(md)) continue;

    let meta = { name: e.name, description: '', displayName: '', version: '' };
    try {
      const text = fs.readFileSync(md, 'utf8');
      meta = { ...meta, ...parseFrontmatter(text.slice(0, 4000)) };
    } catch {
      /* 读不了就当只有名字 */
    }
    out.set(e.name, {
      dir: e.name,
      path: path.join(root, e.name),
      name: meta.name || e.name,
      description: meta.description || '',
      displayName: meta.display_name || '',
      version: meta.version || '',
    });
  }
  return out;
}

/**
 * 极简 YAML frontmatter 解析。
 *
 * 为什么不用 yaml 库：本插件零依赖（除了可选的 xdpool），
 * 而这里只需要几个标量键，写个够用的解析器比引依赖划算。
 * 处理不了复杂结构时返回原字符串，不会崩。
 */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  const lines = m[1].split(/\r?\n/);
  let key = null;
  let buf = [];
  const flush = () => {
    if (key) {
      const v = buf.join('\n').trim();
      out[key] = v.replace(/^["']|["']$/g, '');
    }
    key = null;
    buf = [];
  };
  for (const line of lines) {
    const km = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (km) {
      flush();
      const [, k, rest] = km;
      if (rest === '' || rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
        key = k; // 多行值，后续缩进行归它
      } else {
        out[k] = rest.replace(/^["']|["']$/g, '');
      }
      continue;
    }
    if (key && /^\s+\S/.test(line)) buf.push(line.trim());
  }
  flush();
  return out;
}

//#endregion

//#region 安装

/**
 * 安全校验：解压出来的路径必须落在目标目录内。
 *
 * zip 里的路径可能带 ../ 或绝对路径（目录穿越），
 * 一旦解压到目标目录外就是任意文件写入。
 */
function isSafeRelPath(rel) {
  if (!rel) return false;
  // 去掉 zip 常见的 "./" 前缀
  const clean = rel.replace(/^\.\//, '');
  if (clean.startsWith('/') || clean.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(clean)) return false; // Windows 绝对路径
  const parts = clean.split(/[\\/]/);
  if (parts.some((p) => p === '..')) return false;
  return true;
}

/**
 * 用系统 tar 解压。Windows 10+ / macOS / Linux 都自带 bsdtar，支持 zip。
 *
 * 为什么不用第三方库：本插件保持零依赖。tar 是系统自带的，够用。
 */
async function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  try {
    await execFileAsync('tar', ['-xf', zipPath, '-C', destDir], { timeout: 60000, windowsHide: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: '解压失败：' + (e && e.message ? e.message : String(e)) };
  }
}

/** 递归统计目录大小与文件数 */
function measureDir(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        bytes += fs.statSync(full).size;
        files++;
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { bytes, files };
}

/** 递归删除（用于安装失败回滚） */
function rmrf(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 尽力而为 */
  }
}

/**
 * 安装一个技能。
 *
 * 流程：取下载地址 → 下载 zip → 解压到临时目录 → 校验结构 →
 *       原子移动到 skills/<name> → 清理
 *
 * 任何一步失败都会清理临时目录，不留下半个技能。
 *
 * @param {object} auth
 * @param {object} skill { skillId, name, version }
 * @param {object} opts { overwrite }
 */
export async function installSkill(auth, skill, opts = {}) {
  if (!skill || !skill.skillId) return { ok: false, error: '缺少 skillId' };

  // 技能名必须符合 DSH 的 kebab-case 规则，否则装进去也不被发现
  const rawName = String(skill.name || '').trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rawName)) {
    return { ok: false, error: `技能名「${rawName}」不符合 DSH 的 kebab-case 规则，无法安装` };
  }

  const target = path.join(skillsDir(), rawName);
  if (fs.existsSync(target) && !opts.overwrite) {
    return { ok: false, code: 'EXISTS', error: '该技能已安装（勾选覆盖可重装）', installedPath: target };
  }

  // 1. 取下载地址
  const du = await downloadUrl(auth, skill.skillId, skill.version);
  if (!du.ok) return du;

  // 2. 下载（不用 fetch 的流写盘：部分 Node 版本要手动处理，用 curl 更稳）
  fs.mkdirSync(stagingDir(), { recursive: true });
  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const zipPath = path.join(stagingDir(), `${rawName}-${stamp}.zip`);
  const tmpDir = path.join(stagingDir(), `${rawName}-${stamp}`);

  try {
    await downloadFile(du.url, zipPath);
    const size = fs.statSync(zipPath).size;
    if (size === 0) return { ok: false, error: '下载到的文件为空' };
    if (size > MAX_DOWNLOAD_BYTES) {
      return { ok: false, error: `技能包过大（${Math.round(size / 1024 / 1024)}MB，上限 ${MAX_DOWNLOAD_BYTES / 1024 / 1024}MB）` };
    }

    // 3. 解压到临时目录
    const ex = await extractZip(zipPath, tmpDir);
    if (!ex.ok) return ex;

    // 4. 校验：必须有 SKILL.md，且路径安全
    const found = findSkillRoot(tmpDir);
    if (!found) {
      return { ok: false, error: '技能包里没有 SKILL.md（可能不是标准技能包）' };
    }
    for (const rel of found.entries) {
      if (!isSafeRelPath(rel)) {
        return { ok: false, error: `技能包包含不安全的路径：${rel}` };
      }
    }

    const m = measureDir(tmpDir);
    if (m.bytes > MAX_EXTRACT_BYTES) {
      return { ok: false, error: `解压后过大（${Math.round(m.bytes / 1024 / 1024)}MB）` };
    }

    // 5. 原子落位：先移到临时名，再改名，避免中途失败留下半个技能
    fs.mkdirSync(skillsDir(), { recursive: true });
    const staging = target + '.installing-' + stamp;
    rmrf(staging);
    fs.renameSync(found.root, staging);
    rmrf(target);
    fs.renameSync(staging, target);

    // 6. 写一个来源标记，方便日后识别是市场装的（DSH 会忽略这个文件）
    try {
      fs.writeFileSync(
        path.join(target, '.workbuddy-market.json'),
        JSON.stringify({ skillId: skill.skillId, version: skill.version, installedAt: Date.now() }, null, 2),
        'utf8',
      );
    } catch {
      /* 标记写失败不影响技能本身 */
    }

    return {
      ok: true,
      name: rawName,
      installedPath: target,
      files: m.files,
      bytes: m.bytes,
      version: skill.version || '',
    };
  } catch (e) {
    return { ok: false, error: '安装失败：' + (e && e.message ? e.message : String(e)) };
  } finally {
    // 清理暂存（zip 与解压临时目录）
    try {
      fs.rmSync(zipPath, { force: true });
      rmrf(tmpDir);
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 下载文件到本地。
 * 用 curl 而不是 fetch：Node 的 fetch 写流在不同版本上行为不一致，
 * 而 curl 是系统自带、行为稳定。若 curl 不可用则退回 fetch。
 */
async function downloadFile(url, dest) {
  try {
    await execFileAsync('curl.exe', ['-s', '-L', '--max-time', '120', '-o', dest, url], { timeout: 130000, windowsHide: true });
    return;
  } catch {
    /* 试下非 Windows 的 curl */
  }
  try {
    await execFileAsync('curl', ['-s', '-L', '--max-time', '120', '-o', dest, url], { timeout: 130000 });
    return;
  } catch {
    /* 退回 fetch */
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error('下载失败（HTTP ' + r.status + '）');
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

/**
 * 在解压目录里找技能根。
 *
 * zip 可能把 SKILL.md 放在根，也可能套一层目录（`<name>/SKILL.md`）。
 * 返回技能根目录，以及相对根的文件清单（用于路径安全校验）。
 */
function findSkillRoot(dir) {
  // 情况 A：根目录直接有 SKILL.md
  if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
    return { root: dir, entries: relFiles(dir) };
  }
  // 情况 B：唯一子目录里有 SKILL.md
  const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (subs.length === 1) {
    const inner = path.join(dir, subs[0].name);
    if (fs.existsSync(path.join(inner, 'SKILL.md'))) {
      return { root: inner, entries: relFiles(inner) };
    }
  }
  // 情况 C：任意深度的第一个 SKILL.md（兜底）
  const found = findDeep(dir, 'SKILL.md');
  if (found) {
    const root = path.dirname(found);
    return { root, entries: relFiles(root) };
  }
  return null;
}

function findDeep(dir, filename, depth = 0) {
  if (depth > 6) return null;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      const f = findDeep(full, filename, depth + 1);
      if (f) return f;
    } else if (e.name === filename) {
      return full;
    }
  }
  return null;
}

function relFiles(dir, prefix = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...relFiles(path.join(dir, e.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * 卸载一个技能（只允许删 skills 目录下的直接子目录）。
 */
export function uninstallSkill(name) {
  const safe = String(name || '').trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(safe)) {
    return { ok: false, error: '技能名不合法' };
  }
  const target = path.join(skillsDir(), safe);
  const resolved = path.resolve(target);
  const rootResolved = path.resolve(skillsDir());
  // 双保险：解析后的路径必须是 skills 目录的直接子目录
  if (path.dirname(resolved) !== rootResolved) {
    return { ok: false, error: '路径越界，拒绝删除' };
  }
  if (!fs.existsSync(resolved)) return { ok: false, error: '技能不存在' };
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
    return { ok: true, name: safe };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

//#endregion

export const _internal = { isSafeRelPath, findSkillRoot, parseFrontmatter };
