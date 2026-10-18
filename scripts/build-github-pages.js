'use strict';

// Publish the committed, validated research snapshot without a runtime server.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const cockpit = read('data/decision-cockpit.json');
const market = read('data/canonical-market.json');
const history = read('data/history-index.json');
for (const store of [market, history]) {
  if (store.schemaVersion !== '5.0.0' || store.source?.atomicHandoff !== true ||
      store.source.expectedSession !== cockpit.session) throw Error('Invalid atomic session');
}
if (!market.source.sourceSessionDataHash || market.source.sourceSessionDataHash !== history.source.sourceSessionDataHash ||
    market.rows.length < 80 || !(history.coverage.coveragePct >= 80)) throw Error('Invalid fingerprint or coverage');
execFileSync(process.execPath, ['scripts/vercel-build.js'], {stdio: 'inherit'});
if (read('public/data/technical/index.json').session !== cockpit.session) throw Error('Technical session mismatch');

const base = '/astra-v5-egx';
const out = 'public';
let html = fs.readFileSync('app/dashboard/command-center.html', 'utf8');
html = html.replace('async function api(path){', `async function api(path){
  if(path === '/api/quant') path = '/data/pages-quant.json';
  if(path.startsWith('/api/')) throw new Error('Static research snapshot: runtime endpoint unavailable');
  path = ${JSON.stringify(base)} + path;`);
html = html.replace('Research only · Automatic execution OFF', 'GitHub Pages · Published research snapshot · Automatic execution OFF');
html = html.replace('deploymentCommit:null,', 'deploymentCommit:' + JSON.stringify(execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim()) + ',');
html = html.replace('RUNTIME_API_UNAVAILABLE_CANONICAL_FALLBACK', 'STATIC_RESEARCH_SNAPSHOT');
html = html.replace(/href="\/health"/g, `href="${base}/docs/health.html"`)
  .replace(/href="\/acceptance"/g, `href="${base}/docs/acceptance.html"`);
fs.writeFileSync(path.join(out, 'app/dashboard/command-center.html'), html);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, '.nojekyll'), '');
const metadata = {session:cockpit.session, generatedAt:cockpit.generatedAt,
  commit:execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  sourceSessionDataHash:market.source.sourceSessionDataHash, executionAllowed:false};
fs.writeFileSync(path.join(out, 'data/pages-deployment.json'), JSON.stringify(metadata));
// The legacy docs status was frozen at an old session. Never ship it as a live
// status report: materialize the canonical snapshot's actual session instead.
const sourceHealth = read('data/source-health.json');
const operations = read('data/operations-health.json');
const coveragePct = market.source.coveragePct ?? null;
const liveStatus = {
  schemaVersion: 'astra-pages-published-session/v1',
  expectedSession: cockpit.session,
  actualAcceptedSession: market.source.expectedSession,
  generatedAt: cockpit.generatedAt,
  deploymentCommit: metadata.commit,
  sourceSessionDataHash: metadata.sourceSessionDataHash,
  coveragePct,
  universeCount: Array.isArray(market.rows) ? market.rows.length : 0,
  realFetch: market.source.currentSessionRows > 0,
  currentSessionRows: market.source.currentSessionRows ?? 0,
  overall: operations.overall || 'UNKNOWN',
  researchOnly: true,
  executionAllowed: false,
  publicationEligible: true,
  notes: ['Published validated canonical research snapshot; see operations-health.json for warnings.']
};
for (const rel of ['data/daily-data-update-status.json', 'docs/data/daily-data-update-status.json']) {
  const dest = path.join(out, rel);
  fs.mkdirSync(path.dirname(dest), {recursive:true});
  fs.writeFileSync(dest, JSON.stringify(liveStatus, null, 2));
}

// The quant board already reads the committed local artifacts; no market fetch.
const {loadQuantBoard} = require('../engine/ucp/quant-adapter');
fs.writeFileSync(path.join(out, 'data/pages-quant.json'), JSON.stringify({...loadQuantBoard(), executionAllowed:false, deploymentCommit:metadata.commit}));
for (const name of ['health', 'acceptance']) {
  const p = path.join(out, 'docs', name+'.html');
  let page = fs.readFileSync(p, 'utf8');
  page = page.replace(/href="\/"/g, `href="${base}/"`)
    .replace(/href="\/recommendations"/g, `href="${base}/"`)
    .replace(/href="\/health"/g, `href="${base}/docs/health.html"`)
    .replace(/fetch\('\/(docs\/)?data\//g, `fetch('${base}/data/`);
  fs.writeFileSync(p, page);
}
console.log(JSON.stringify(metadata));
