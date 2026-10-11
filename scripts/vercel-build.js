'use strict';

const fs = require('fs');
const path = require('path');

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
  'docs/acceptance.html'
];

for (const rel of required) {
  const p = path.join(out, rel);
  if (!fs.existsSync(p)) throw new Error('Vercel static output missing required file: ' + rel);
}

const cockpit = JSON.parse(fs.readFileSync(path.join(out, 'data/decision-cockpit.json'), 'utf8'));
console.log(JSON.stringify({
  ok: true,
  outputDirectory: 'public',
  session: cockpit.session || null,
  generatedAt: cockpit.generatedAt || null,
  staticRoots: ['app/dashboard', 'data', 'docs', 'quant/data']
}, null, 2));
