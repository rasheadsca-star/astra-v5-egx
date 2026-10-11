'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = process.cwd();
const out = path.join(root, 'public');

function copyDir(rel) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) return;
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

function copyFile(rel) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) return;
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

// Generate per-symbol technical analysis artifacts from the current committed session
// before materializing the static Vercel output. These files are intentionally
// gitignored because they are derived artifacts, but they must exist in deployment.
execFileSync(process.execPath, ['scripts/build-technical-analysis.js'], {
  cwd: root,
  stdio: 'inherit'
});

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

[
  'app/dashboard',
  'data',
  'docs',
  'quant/data'
].forEach(copyDir);

[
  'index.html',
  'recommendations-icon.svg',
  'recommendations-manifest.webmanifest',
  'recommendations-sw.js'
].forEach(copyFile);

const required = [
  'app/dashboard/command-center.html',
  'app/dashboard/recommendations.html',
  'data/decision-cockpit.json',
  'data/live-acceptance.json',
  'docs/health.html',
  'docs/acceptance.html',
  'data/technical/index.json',
  'docs/data/technical/index.json'
];

for (const rel of required) {
  const p = path.join(out, rel);
  if (!fs.existsSync(p)) throw new Error('Vercel static output missing required file: ' + rel);
}

const cockpit = JSON.parse(fs.readFileSync(path.join(out, 'data/decision-cockpit.json'), 'utf8'));
const technicalIndex = JSON.parse(fs.readFileSync(path.join(out, 'data/technical/index.json'), 'utf8'));
if (!Array.isArray(technicalIndex.symbols) || technicalIndex.symbols.length === 0) {
  throw new Error('Vercel static output contains no technical-analysis symbols');
}
console.log(JSON.stringify({
  ok: true,
  outputDirectory: 'public',
  session: cockpit.session || null,
  generatedAt: cockpit.generatedAt || null,
  technicalSymbols: technicalIndex.symbols.length,
  technicalSession: technicalIndex.session || null,
  staticRoots: ['app/dashboard', 'data', 'docs', 'quant/data']
}, null, 2));
