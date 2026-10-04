'use strict';

// يشغّل Python بأول مفسّر متاح (python3 ثم python ثم py -3 على ويندوز) — لا افتراض لاسم الأمر.
//   node scripts/run-python.js quant/tests/test_engine.py   (يعمل من جذر المشروع؛ الخيار --cwd لتغيير المجلد)
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
let cwd = path.join(__dirname, '..');
const i = args.indexOf('--cwd');
if (i >= 0) { cwd = path.resolve(cwd, args[i + 1]); args.splice(i, 2); }

const candidates = [['python3'], ['python'], ['py', '-3']];
for (const [cmd, ...pre] of candidates) {
  const probe = spawnSync(cmd, [...pre, '-c', 'import sys;print(sys.version_info[:2]>=(3,9))'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0 || !/True/.test(probe.stdout)) continue;
  const run = spawnSync(cmd, [...pre, ...args], { stdio: 'inherit', cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  process.exit(run.status === null ? 1 : run.status);
}
console.error('لم يُعثر على Python 3.9+ (جرّبت python3 وpython وpy -3). ثبّته من https://www.python.org/downloads/ ثم أعد المحاولة.');
process.exit(127);
