/**
 * 技能市场自检。
 *
 * 重点：解压路径安全（目录穿越）与 frontmatter 解析。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-skill-'));
process.env.WB_CONSOLE_DATA_DIR = TMP;
process.env.DSH_HOME = path.join(TMP, 'dshhome');

const sm = await import('../lib/skill-market.mjs');
const { isSafeRelPath, parseFrontmatter } = sm._internal;

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

console.log('\n路径安全（防目录穿越）');

t('正常路径放行', () => {
  for (const p of ['SKILL.md', 'scripts/query.py', 'a/b/c.md', './SKILL.md', 'reference.md']) {
    assert.equal(isSafeRelPath(p), true, '应放行: ' + p);
  }
});

t('拒绝 .. 穿越', () => {
  for (const p of ['../evil', 'a/../../evil', 'a/b/../../../x', '..\\evil', 'a\\..\\..\\x']) {
    assert.equal(isSafeRelPath(p), false, '应拒绝: ' + p);
  }
});

t('拒绝绝对路径', () => {
  for (const p of ['/etc/passwd', '\\windows\\system32\\x', 'C:/Windows/x', 'C:\\Windows\\x']) {
    assert.equal(isSafeRelPath(p), false, '应拒绝: ' + p);
  }
});

t('拒绝空路径', () => {
  assert.equal(isSafeRelPath(''), false);
  assert.equal(isSafeRelPath(null), false);
});

console.log('\nfrontmatter 解析');

t('解析标量键', () => {
  const md = '---\nname: my-skill\ndescription: A test skill\nversion: 1.0.0\n---\n\n# body\n';
  const m = parseFrontmatter(md);
  assert.equal(m.name, 'my-skill');
  assert.equal(m.description, 'A test skill');
  assert.equal(m.version, '1.0.0');
});

t('解析带引号的值', () => {
  const m = parseFrontmatter('---\nname: "quoted"\ndescription: \'single\'\n---\n');
  assert.equal(m.name, 'quoted');
  assert.equal(m.description, 'single');
});

t('解析多行值（>- 折叠）', () => {
  const md = '---\nname: multi\ndescription: >-\n  First line\n  second line\n---\n';
  const m = parseFrontmatter(md);
  assert.equal(m.name, 'multi');
  assert.match(m.description, /First line/);
  assert.match(m.description, /second line/);
});

t('无 frontmatter 时返回空对象', () => {
  assert.deepEqual(parseFrontmatter('# just a heading\n'), {});
  assert.deepEqual(parseFrontmatter(''), {});
});

t('非法输入不抛异常', () => {
  assert.doesNotThrow(() => parseFrontmatter('---\n:::bad yaml:::\n---\n'));
  assert.doesNotThrow(() => parseFrontmatter('---\n'));
});

console.log('\n本地已装技能');

t('skills 目录不存在时返回空 Map', () => {
  const m = sm.listInstalled();
  assert.equal(m.size, 0);
});

t('能识别 <name>/SKILL.md 形式', () => {
  const dir = path.join(sm.skillsDir(), 'demo-skill');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: demo-skill\ndescription: Demo\n---\n\nbody\n', 'utf8');
  const m = sm.listInstalled();
  assert.ok(m.has('demo-skill'), '应发现 demo-skill');
  assert.equal(m.get('demo-skill').description, 'Demo');
});

t('忽略没有 SKILL.md 的目录', () => {
  fs.mkdirSync(path.join(sm.skillsDir(), 'not-a-skill'), { recursive: true });
  const m = sm.listInstalled();
  assert.ok(!m.has('not-a-skill'), '不应发现 not-a-skill');
});

console.log('\n卸载');

t('卸载存在的技能', () => {
  const r = sm.uninstallSkill('demo-skill');
  assert.equal(r.ok, true);
  assert.ok(!fs.existsSync(path.join(sm.skillsDir(), 'demo-skill')));
});

t('卸载不存在的技能返回错误而不是崩溃', () => {
  const r = sm.uninstallSkill('no-such-skill');
  assert.equal(r.ok, false);
  assert.match(r.error, /不存在/);
});

t('拒绝非法名字（防路径穿越）', () => {
  for (const bad of ['../evil', 'a/b', '..', 'A-B', 'has space', '']) {
    const r = sm.uninstallSkill(bad);
    assert.equal(r.ok, false, '应拒绝: ' + JSON.stringify(bad));
  }
});

t('拒绝删除 skills 目录本身', () => {
  const r = sm.uninstallSkill('.');
  assert.equal(r.ok, false);
});

console.log('\n安装参数校验');

await (async () => {
  // 用假 auth 走本地校验分支（不会真的联网）
  const fakeAuth = { accessToken: 'x', uid: 'u', endpoint: 'http://127.0.0.1:9' };

  try {
    await t('缺少 skillId 直接拒绝', async () => {
      const r = await sm.installSkill(fakeAuth, {});
      assert.equal(r.ok, false);
      assert.match(r.error, /skillId/);
    });
  } catch (e) {
    console.log('  FAIL 缺少 skillId 直接拒绝\n       ' + e.message);
    fail++;
  }

  try {
    await t('非法技能名被拒绝（不会写出危险目录）', async () => {
      for (const bad of ['../evil', 'BadName', 'has space', '']) {
        const r = await sm.installSkill(fakeAuth, { skillId: 'skill_1', name: bad });
        assert.equal(r.ok, false, '应拒绝: ' + JSON.stringify(bad));
        assert.match(r.error, /kebab-case|缺少/);
      }
    });
  } catch (e) {
    console.log('  FAIL 非法技能名被拒绝\n       ' + e.message);
    fail++;
  }

  try {
    await t('上游不可达时返回可读错误（不是崩溃）', async () => {
      const r = await sm.installSkill(fakeAuth, { skillId: 'skill_1', name: 'valid-name' });
      assert.equal(r.ok, false);
      assert.ok(r.error, '应有错误信息');
    });
  } catch (e) {
    console.log('  FAIL 上游不可达时返回可读错误\n       ' + e.message);
    fail++;
  }
})();

console.log('\n上游调用（用假 fetch）');

await (async () => {
  const fakeAuth = { accessToken: 'k', uid: 'u', endpoint: 'https://fake.example' };

  globalThis.fetch = async () => ({
    status: 200,
    text: async () => JSON.stringify({ code: 0, data: { total_count: 1, skills: [{ skill_id: 's1', name: 'demo', display_name_zh: '演示', display_name_en: 'Demo', use_stat: { use_count: 5, install_count: 2 } }] } }),
  });

  try {
    await t('列表归一化：中英名与用量都取到', async () => {
      const r = await sm.listSkills(fakeAuth, { pageSize: 10 });
      assert.equal(r.ok, true);
      assert.equal(r.total, 1);
      assert.equal(r.skills[0].displayNameZh, '演示');
      assert.equal(r.skills[0].displayNameEn, 'Demo');
      assert.equal(r.skills[0].useCount, 5);
    });
  } catch (e) {
    console.log('  FAIL 列表归一化\n       ' + e.message);
    fail++;
  }

  globalThis.fetch = async () => ({ status: 401, text: async () => 'no' });
  try {
    await t('401 归一化为 UNAUTHORIZED', async () => {
      const r = await sm.listSkills(fakeAuth, {});
      assert.equal(r.ok, false);
      assert.equal(r.code, 'UNAUTHORIZED');
    });
  } catch (e) {
    console.log('  FAIL 401 归一化\n       ' + e.message);
    fail++;
  }

  globalThis.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ code: 17101, msg: 'invalid request body' }) });
  try {
    await t('业务错误码被透出', async () => {
      const r = await sm.listSkills(fakeAuth, {});
      assert.equal(r.ok, false);
      assert.equal(r.code, 17101);
      assert.match(r.error, /invalid request/);
    });
  } catch (e) {
    console.log('  FAIL 业务错误码\n       ' + e.message);
    fail++;
  }
})();

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
