/**
 * 安装器自检。
 *
 * 用临时假 profile 验证安装/卸载/幂等，不碰真实 DSH 配置。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INSTALLER = path.join(HERE, '..', 'scripts', 'install.mjs');
const PKG_DIR = path.resolve(HERE, '..');

let pass = 0;
let fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log('  OK   ' + name);
    pass++;
  } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message);
    fail++;
  }
}

/** 建一个干净的假 profile */
function makeProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-installer-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'test', private: true, dependencies: {} }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '# test patch\n[]\n');
  return dir;
}

function run(dir, ...extra) {
  return spawnSync(process.execPath, [INSTALLER, '--profile', dir, ...extra], { encoding: 'utf8' });
}

const readPatch = (d) => fs.readFileSync(path.join(d, 'cordis.patch.yml'), 'utf8');
const readPkg = (d) => JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));

console.log('\n安装');

const p1 = makeProfile();
const r1 = run(p1, '--dry-run');
t('dry-run 不修改任何文件', () => {
  assert.equal(readPatch(p1), '# test patch\n[]\n', 'patch 被改动');
  assert.deepEqual(readPkg(p1).dependencies, {}, 'dependencies 被改动');
  assert.equal(r1.status, 0);
});

const p2 = makeProfile();
const r2 = run(p2);
t('真实安装：注册到 cordis.patch.yml', () => {
  assert.equal(r2.status, 0, r2.stderr);
  const patch = readPatch(p2);
  assert.match(patch, /- insert:/);
  assert.match(patch, /- id: workbuddy-console/);
  assert.match(patch, /name: dsh-workbuddy-console/);
});

t('真实安装：依赖写成 link: 而不是 file:', () => {
  const dep = readPkg(p2).dependencies['dsh-workbuddy-console'];
  assert.ok(dep, '缺少依赖');
  assert.ok(dep.startsWith('link:'), '必须是 link:，实际: ' + dep);
  assert.ok(!dep.startsWith('file:'), 'file: 是拷贝语义，会导致改动不生效');
});

t('安装后 patch 是合法 UTF-8 且保留原有内容', () => {
  const buf = fs.readFileSync(path.join(p2, 'cordis.patch.yml'));
  assert.doesNotThrow(() => new TextDecoder('utf-8', { fatal: true }).decode(buf), '非法 UTF-8');
  assert.match(buf.toString('utf8'), /# test patch/, '原有注释丢失');
});

console.log('\n幂等');

const r3 = run(p2);
t('重复安装不产生重复条目', () => {
  assert.equal(r3.status, 0);
  const count = (readPatch(p2).match(/id: workbuddy-console/g) || []).length;
  assert.equal(count, 1, `install 条目数应为 1，实际 ${count}`);
});

t('重复安装不改动文件内容', () => {
  const before = readPatch(p2);
  run(p2);
  assert.equal(readPatch(p2), before);
});

console.log('\n从 file: 迁移');

const p3 = makeProfile();
fs.writeFileSync(
  path.join(p3, 'package.json'),
  JSON.stringify({ name: 'test', private: true, dependencies: { 'dsh-workbuddy-console': 'file:' + PKG_DIR.replace(/\\/g, '/') } }, null, 2),
);
const r4 = run(p3);
t('自动把 file: 改为 link:', () => {
  assert.equal(r4.status, 0);
  const dep = readPkg(p3).dependencies['dsh-workbuddy-console'];
  assert.ok(dep.startsWith('link:'), '未迁移，实际: ' + dep);
  assert.match(r4.stdout, /file:/, '应提示检测到 file:');
});

console.log('\n保留其它插件');

const p4 = makeProfile();
fs.writeFileSync(path.join(p4, 'cordis.patch.yml'), '# my patch\n- id: other-plugin\n  name: some-other\n  config:\n    foo: 1\n');
run(p4);
t('安装不影响其它插件配置', () => {
  const patch = readPatch(p4);
  assert.match(patch, /- id: other-plugin/);
  assert.match(patch, /foo: 1/);
});

t('卸载后其它插件配置完好', () => {
  run(p4, '--uninstall');
  const patch = readPatch(p4);
  assert.match(patch, /- id: other-plugin/, 'other-plugin 被误删');
  assert.match(patch, /foo: 1/);
  assert.ok(!patch.includes('workbuddy-console'), '本插件未清除干净');
});

console.log('\n卸载');

const p5 = makeProfile();
const original = readPatch(p5);
run(p5);
run(p5, '--uninstall');
t('卸载完全还原 patch（无残留注释）', () => {
  assert.equal(readPatch(p5), original, '有残留');
});

t('卸载清空 dependencies', () => {
  assert.deepEqual(readPkg(p5).dependencies, {});
});

t('重复卸载不报错', () => {
  const r = run(p5, '--uninstall');
  assert.equal(r.status, 0);
});

console.log('\n参数校验');

t('无效 profile 目录 → 退出码非 0', () => {
  const r = spawnSync(process.execPath, [INSTALLER, '--profile', path.join(os.tmpdir(), 'definitely-not-a-profile-xyz')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
});

// 清理
for (const d of [p1, p2, p3, p4, p5]) fs.rmSync(d, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
