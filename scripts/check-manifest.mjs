/**
 * 插件清单自检：package.json 的加载协议 + cordis.patch.yml 的合法性。
 *
 * 抓过的两类真实故障：
 *   1. 声明了 dsh.client 却没有 exports["./client"] → DSH 启动直接失败
 *      （"required plugin did not activate"）
 *   2. cordis.patch.yml 里用了 JavaScript 的块注释 "/** * /"（YAML 里那不是注释）
 *      → 插件加载报 YAMLException，界面上显示"异常 / 无法使用插件"
 *
 * 第 2 类当时 210 项测试全绿也没拦住 —— 因为没有任何测试解析过那个文件。
 * 这个脚本现在会真的用 YAML 解析器读一遍。
 *
 * 路径相对本文件定位：在源码目录和测试运行器的临时副本里都能跑。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let bad = 0;
const ok = (m) => console.log('  OK   ' + m);
const fail = (m) => { console.log('  FAIL ' + m); bad++; };

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

console.log('检查 dsh.client 与 exports 的一致性\n');

const declaresClient = !!(pkg.dsh && pkg.dsh.client);
const hasClientExport = !!(pkg.exports && pkg.exports['./client']);

if (!declaresClient) {
  ok('未声明 dsh.client —— 无需 ./client 导出');
} else {
  if (hasClientExport) ok('声明了 dsh.client，且 exports["./client"] 存在');
  else fail('声明了 dsh.client，但 exports["./client"] 缺失（DSH 会启动失败）');

  if (hasClientExport) {
    const v = pkg.exports['./client'];
    let rel = null;
    if (typeof v === 'string') { rel = v; ok('exports["./client"] 是字符串'); }
    else if (v && typeof v.default === 'string') { rel = v.default; ok('exports["./client"] 是带 default 的对象'); }
    else fail('exports["./client"] 必须是字符串或含 string default 的对象');

    if (rel) {
      const abs = path.join(ROOT, rel);
      if (fs.existsSync(abs)) {
        const text = fs.readFileSync(abs, 'utf8');
        ok(`客户端 bundle 存在（${rel}, ${text.length} bytes）`);
        if (text.includes('__ModuleLoader__.load')) ok('bundle 使用 __ModuleLoader__.load 协议');
        else fail('bundle 未使用 __ModuleLoader__.load —— DSH 无法加载');
        if (/id:\s*['"]/.test(text)) ok('bundle 声明了模块 id');
        else fail('bundle 缺少 id');
        // 客户端是 classic script：顶层 import/export 会让宿主加载不了
        if (/^\s*import\s/m.test(text) || /^\s*export\s/m.test(text)) {
          fail('bundle 含顶层 import/export —— 它是 classic script，会被宿主拒绝');
        } else {
          ok('bundle 是 classic script（无顶层 import/export）');
        }
      } else {
        fail(`客户端 bundle 文件不存在: ${abs}`);
      }
    }
  }
}

console.log('\n检查 cordis.patch.yml\n');

const patchPath = path.join(ROOT, 'cordis.patch.yml');
if (!fs.existsSync(patchPath)) {
  fail('cordis.patch.yml 不存在 —— 插件无法注册');
} else {
  const raw = fs.readFileSync(patchPath, 'utf8');

  // 先查最容易犯的错：把 JS 注释写进 YAML。
  // 只看**非注释行** —— 说明文字里提到 "/** */" 不该被判为错误。
  const codeLines = raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  if (/\/\*|\*\//.test(codeLines)) {
    fail('cordis.patch.yml 的非注释行里出现 /* 或 */ —— YAML 的注释是 #，这会导致解析失败');
  }
  if (/\t/.test(raw)) {
    fail('cordis.patch.yml 含 Tab —— YAML 不允许用 Tab 缩进');
  }

  // 真解析一遍。yaml 包通常装在 DSH profile 里而不在插件源码目录，
  // 所以按候选位置逐个找（插件本身零依赖）。
  let parsed = null;
  let usedRealParser = false;
  let yamlMod = null;
  const yamlCandidates = [
    'yaml',
    ...(process.env.DSH_PROFILE_DIR ? [process.env.DSH_PROFILE_DIR] : []),
    path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'desktop'),
    path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web'),
    path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles'),
  ];
  for (const cand of yamlCandidates) {
    try {
      if (cand === 'yaml') {
        yamlMod = await import('yaml');
      } else {
        const { createRequire } = await import('node:module');
        const req = createRequire(path.join(cand, 'noop.js'));
        yamlMod = await import(pathToFileURL(req.resolve('yaml')).href);
      }
      break;
    } catch { /* 试下一个 */ }
  }

  if (yamlMod) {
    try {
      parsed = yamlMod.parse(raw);
      usedRealParser = true;
    } catch (e) {
      fail('cordis.patch.yml 解析失败: ' + String(e.message).split('\n')[0]);
    }
  }

  if (!usedRealParser && !yamlMod) {
    // 无 yaml 包：退回到「不出现非法字符 + 顶层是列表」的粗检
    const meaningful = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    if (meaningful.every((l) => l.startsWith('- ') || /^[a-z0-9_.-]+:/i.test(l))) {
      ok('结构粗检通过（未找到 yaml 包，未做真实解析）');
    } else {
      fail('结构粗检失败：存在既不是注释、也不是列表项/键值对的行');
    }
  }

  if (usedRealParser) {
    if (Array.isArray(parsed)) {
      ok(`YAML 解析成功，顶层是数组（${parsed.length} 个条目）`);
    } else {
      fail('YAML 顶层不是数组 —— DSH 期望一个 patch 条目数组');
    }

    if (Array.isArray(parsed)) {
      const ids = [];
      const names = [];
      for (const [i, entry] of parsed.entries()) {
        if (!entry || typeof entry !== 'object') {
          fail(`第 ${i + 1} 个条目不是对象`);
          continue;
        }
        if (Array.isArray(entry.insert)) {
          for (const ins of entry.insert) {
            if (!ins || !ins.id || !ins.name) fail(`insert 条目缺少 id 或 name: ${JSON.stringify(ins)}`);
            else { ids.push(ins.id); names.push(ins.name); }
          }
        } else if (entry.id) {
          ids.push(entry.id);
          if (entry.name) names.push(entry.name);
        } else {
          fail(`第 ${i + 1} 个条目既不是 insert 也不是 id 覆盖`);
        }
      }
      ok(`条目 id: ${ids.join(', ')}`);

      // 重复 id 会让同一个插件被挂两次
      const dup = ids.filter((x, i2) => ids.indexOf(x) !== i2);
      if (dup.length) fail('存在重复 id: ' + [...new Set(dup)].join(', '));
      else ok('无重复 id');

      // 引用的包必须存在：本地名要等于本包名，或能在 node_modules 解析到
      for (const n of names) {
        if (n === pkg.name) {
          ok(`引用自身包名 ${n}`);
          continue;
        }
        let resolved = null;
        try {
          const { createRequire } = await import('node:module');
          const req = createRequire(path.join(ROOT, 'package.json'));
          resolved = req.resolve(n);
        } catch { /* 解析不到 */ }
        if (resolved) {
          ok(`引用的包可解析: ${n} → ${resolved}`);
        } else {
          fail(`引用的包解析不到: ${n} —— 插件会加载失败（是不是已经卸载或改名？）`);
        }
      }
    }
  }
}

console.log('\n检查发布内容\n');

if (Array.isArray(pkg.files) && pkg.files.includes('lib')) ok('files 包含 lib');
else fail('files 未包含 lib —— 发布后会缺文件');

// vendor 是合并进来的模型池实现，漏了它插件也起不来
if (fs.existsSync(path.join(ROOT, 'vendor', 'xdpool'))) {
  if (Array.isArray(pkg.files) && pkg.files.includes('vendor')) ok('files 包含 vendor（合并的模型池实现）');
  else fail('files 未包含 vendor —— 发布后模型池会缺实现');
}

const mainAbs = path.join(ROOT, pkg.main || '');
if (pkg.main && fs.existsSync(mainAbs)) ok('main 入口存在');
else fail('main 入口不存在: ' + pkg.main);

console.log(bad === 0 ? '\n通过：插件清单与 DSH 加载协议一致' : `\n${bad} 项不通过`);
process.exit(bad === 0 ? 0 : 1);
