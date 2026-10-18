import * as ac from '../lib/account-check.mjs';

const files = ac.scanCredentialFiles();
console.log('共 ' + files.length + ' 个：');
for (const f of files) {
  console.log('\n--- ' + f.kind + '  ' + f.file);
  const safe = {};
  for (const [k, v] of Object.entries(f)) {
    if (/token|secret|key|cookie/i.test(k)) {
      safe[k] = typeof v === 'string' ? '<string:' + v.length + '>' : typeof v;
    } else {
      safe[k] = typeof v === 'object' && v !== null ? JSON.stringify(v).slice(0, 120) : String(v).slice(0, 120);
    }
  }
  console.log('    ' + JSON.stringify(safe, null, 2).split('\n').join('\n    '));
}
