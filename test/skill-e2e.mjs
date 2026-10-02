/**
 * 端到端：从技能市场真实安装一个技能到 ~/.dsh/skills。
 *
 * 这是唯一能证明「装完 DSH 真的能用」的验证。
 * 装一个体积小、无副作用的技能，验证完自动卸载。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const AUTH = path.join(os.homedir(), 'AppData', 'Local', 'CodeBuddyExtension', 'Data', 'Public', 'auth');
const files = fs.readdirSync(AUTH).filter((f) => f.endsWith('.info'));
const j = JSON.parse(fs.readFileSync(path.join(AUTH, files[0]), 'utf8'));

// lib 相对本文件定位，脚本从哪跑都行
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sm = await import('file:///' + path.join(HERE, '..', 'lib', 'skill-market.mjs').replace(/\\/g, '/'));

const auth = {
  accessToken: j.auth.accessToken,
  uid: j.account.uid,
  endpoint: 'https://copilot.tencent.com',
};

console.log('用户技能目录:', sm.skillsDir());
console.log('');

// 1. 列表
const list = await sm.listSkills(auth, { page: 1, pageSize: 5 });
if (!list.ok) {
  console.log('列表失败:', list.error);
  process.exit(1);
}
console.log(`技能总数: ${list.total}`);
console.log('前 5 个:');
for (const s of list.skills) {
  console.log(`  ${s.name.padEnd(34)} ${s.displayNameZh}  (用 ${s.useCount} 次)`);
}
console.log('');

// 2. 挑一个小的装（优先无脚本的，避免装出一堆文件）
const pick = list.skills.find((s) => !s.preinstalled) || list.skills[0];
console.log('选中安装:', pick.name, '|', pick.displayNameZh);

const before = sm.listInstalled();
console.log('安装前已装技能数:', before.size);

const r = await sm.installSkill(auth, { skillId: pick.skillId, name: pick.name, version: pick.version }, { overwrite: true });
console.log('');
if (!r.ok) {
  console.log('安装失败:', r.error);
  process.exit(1);
}
console.log('安装结果:');
console.log('  路径   :', r.installedPath);
console.log('  文件数 :', r.files);
console.log('  体积   :', r.bytes, 'bytes');

// 3. 验证落盘结构
const target = path.join(sm.skillsDir(), pick.name);
const md = path.join(target, 'SKILL.md');
console.log('');
console.log('落盘校验:');
console.log('  目录存在     :', fs.existsSync(target));
console.log('  SKILL.md 存在:', fs.existsSync(md));

if (fs.existsSync(md)) {
  const text = fs.readFileSync(md, 'utf8');
  const fm = sm._internal.parseFrontmatter(text);
  console.log('  frontmatter name        :', fm.name);
  console.log('  frontmatter description :', String(fm.description || '').slice(0, 60) + '...');
  console.log('  正文长度                :', text.length, '字符');

  // DSH 要求：name 与 description 必须有
  const valid = fm.name && fm.description;
  console.log('  DSH 可用性              :', valid ? '✓ 具备必需字段' : '✗ 缺必需字段');
}

console.log('');
console.log('目录内容:');
function walk(d, prefix = '') {
  for (const n of fs.readdirSync(d)) {
    const full = path.join(d, n);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      console.log('  ' + prefix + n + '/');
      walk(full, prefix + n + '/');
    } else {
      console.log('  ' + prefix + n + '  (' + st.size + ' bytes)');
    }
  }
}
if (fs.existsSync(target)) walk(target);

// 4. listInstalled 应能识别
const after = sm.listInstalled();
console.log('');
console.log('重新扫描已装技能:', after.size, '个');
console.log('  能识别新技能:', after.has(pick.name) ? '✓' : '✗');

// 5. 卸载（保持环境干净）
console.log('');
const un = sm.uninstallSkill(pick.name);
console.log('清理卸载:', un.ok ? '✓ 已移除' : '✗ ' + un.error);
console.log('  剩余技能数:', sm.listInstalled().size);
