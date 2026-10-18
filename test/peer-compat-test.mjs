/**
 * 宿主版本兼容性：插件声明的 peerDependencies 必须涵盖当前 DSH 运行时版本。
 *
 * 为什么需要这个测试：
 *   DSH 的 `unmetRequirements()` 会拿插件 package.json 里
 *   `peerDependencies['@deepseek-ai/dsh-*']` 的**范围**去和 **DSH 运行时版本**
 *   做 semver 比较（不是和实际安装的宿主包版本比）：
 *
 *     if (name !== "@deepseek-ai/dsh" && !name.startsWith("@deepseek-ai/dsh-")) continue;
 *     if (!satisfies(runtimeVersion, range)) unmet[name] = range;
 *
 *   DSH 从 0.2.0-rc.2 升到 0.2.1-rc.2 后，原先的 `>=0.1.1-rc.1 <0.2.0`
 *   不满足新版本，插件卡片直接标「不兼容」并拒绝激活。这类漂移只靠人工
 *   发现太晚，所以在这里钉死：覆盖范围必须包含当前运行时，并明确边界。
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');

let total = 0;
let failed = 0;
const rows = [];
async function t(name, fn) {
  total++;
  try {
    await fn();
    rows.push(['OK  ', name, '']);
  } catch (e) {
    failed++;
    rows.push(['FAIL', name, e && e.message ? e.message : String(e)]);
  }
}

// ---- 极简 semver：只覆盖本测试需要的比较 ----
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v).trim());
  if (!m) throw new Error('无法解析版本: ' + v);
  const pre = m[4] ? m[4].split('.') : [];
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}
function cmp(a, b) {
  const A = parse(a);
  const B = parse(b);
  for (let i = 0; i < 3; i++) {
    if (A.core[i] !== B.core[i]) return A.core[i] < B.core[i] ? -1 : 1;
  }
  // 无 prerelease 的版本更大（1.0.0 > 1.0.0-rc.1）
  if (!A.pre.length && !B.pre.length) return 0;
  if (!A.pre.length) return 1;
  if (!B.pre.length) return -1;
  const n = Math.max(A.pre.length, B.pre.length);
  for (let i = 0; i < n; i++) {
    const x = A.pre[i];
    const y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1; // 数字标识符小于字母标识符
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
function satisfies(version, range) {
  const parts = String(range).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return true;
  return parts.every((p) => {
    const m = /^(>=|<=|>|<|=)?(.+)$/.exec(p);
    const op = m[1] || '=';
    const c = cmp(version, m[2]);
    if (op === '>=') return c >= 0;
    if (op === '<=') return c <= 0;
    if (op === '>') return c > 0;
    if (op === '<') return c < 0;
    return c === 0;
  });
}

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RANGE = manifest.peerDependencies && manifest.peerDependencies['@deepseek-ai/dsh-host-webserver'];

/** 从宿主 asar 读 DSH 运行时版本；读不到返回 null（CI/无安装环境） */
function runtimeVersion() {
  const candidates = [
    'C:/Users/dell/AppData/Local/Programs/DeepSeek Harness/resources/app.asar',
    process.env.DSH_ASAR,
  ].filter(Boolean);
  for (const asar of candidates) {
    let fd;
    try {
      if (!fs.existsSync(asar)) continue;
      fd = fs.openSync(asar, 'r');
      const head = Buffer.alloc(16);
      fs.readSync(fd, head, 0, 16, 0);
      const headerSize = head.readUInt32LE(4);
      const jsonSize = head.readUInt32LE(12);
      const jb = Buffer.alloc(jsonSize);
      fs.readSync(fd, jb, 0, jsonSize, 16);
      const tree = JSON.parse(jb.toString('utf8'));
      let node = tree;
      for (const seg of ['dsh', 'package.json']) {
        if (!node.files || !node.files[seg]) { node = null; break; }
        node = node.files[seg];
      }
      if (!node || node.files) continue;
      const b = Buffer.alloc(node.size);
      fs.readSync(fd, b, 0, node.size, 8 + headerSize + Number(node.offset));
      return JSON.parse(b.toString('utf8')).version;
    } catch {
      continue;
    } finally {
      if (fd !== undefined) try { fs.closeSync(fd); } catch { /* */ }
    }
  }
  return null;
}

await t('声明了 @deepseek-ai/dsh-host-webserver 的 peer 范围', () => {
  assert.equal(typeof RANGE, 'string', 'peerDependencies 里缺少 @deepseek-ai/dsh-host-webserver');
  assert.ok(RANGE.trim().length > 0, 'peer 范围不能为空');
});

await t('peer 范围涵盖 DSH 0.2.x（0.2.0-rc.2 与 0.2.1-rc.2 都必须通过）', () => {
  assert.equal(satisfies('0.2.0-rc.2', RANGE), true, '0.2.0-rc.2 不满足 ' + RANGE);
  assert.equal(satisfies('0.2.1-rc.2', RANGE), true, '0.2.1-rc.2 不满足 ' + RANGE);
  assert.equal(satisfies('0.2.9', RANGE), true, '0.2.9 不满足 ' + RANGE);
});

await t('peer 范围仍涵盖原先支持的 0.1.x', () => {
  assert.equal(satisfies('0.1.1-rc.1', RANGE), true, '0.1.1-rc.1 不满足 ' + RANGE);
});

await t('peer 范围保留上界（不无限放宽）', () => {
  assert.equal(satisfies('0.3.0', RANGE), false, '0.3.0 不应被声明支持 —— 未验证的版本应让宿主报警');
});

await t('peer 范围满足当前安装的 DSH 运行时版本', () => {
  const v = runtimeVersion();
  if (v === null) {
    // 没有本地安装（CI / 他人机器）时跳过，避免误报
    return;
  }
  assert.equal(
    satisfies(v, RANGE),
    true,
    '当前 DSH 运行时是 ' + v + '，但 peer 范围 ' + RANGE + ' 不涵盖它 —— 宿主会判定「不兼容」并拒绝激活',
  );
});

// ---- 输出 ----
for (const [tag, name, err] of rows) {
  console.log('  ' + tag + ' ' + name + (err ? '\n         ' + err : ''));
}
console.log('\n结果：' + (total - failed) + ' 通过，' + failed + ' 失败');
process.exit(failed === 0 ? 0 : 1);
