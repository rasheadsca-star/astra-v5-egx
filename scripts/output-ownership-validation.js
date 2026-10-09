'use strict';
const fs=require('fs');
const assert=require('assert');

const ownership=JSON.parse(fs.readFileSync('config/output-ownership.json','utf8'));
const daily=fs.readFileSync('.github/workflows/daily-egx-data-refresh.yml','utf8');
const quant=fs.readFileSync('.github/workflows/quant-daily.yml','utf8');
const ucp=fs.readFileSync('.github/workflows/ucp-forward-ledger.yml','utf8');

assert.strictEqual(ownership.authoritativeProducerWorkflow,'.github/workflows/daily-egx-data-refresh.yml');
assert.match(daily,/permissions:\s*[\s\S]*contents:\s*write/);
assert.match(daily,/concurrency:\s*[\s\S]*group:\s*astra-state-writer/);
assert.match(daily,/Bridge ASTRA atomic store -> session pack/);
assert.match(daily,/Publish astra-quant\/v1 payload/);
assert.match(daily,/Build Confluence Pullback V2/);
assert.match(daily,/npm run cockpit:build/);
assert.match(daily,/git add -A/);
assert.match(daily,/data\/source-health\.json/);
assert.match(daily,/data\/operations-health\.json/);
assert.match(daily,/docs\/data\/source-health\.json/);
assert.match(daily,/docs\/data\/operations-health\.json/);
assert.match(daily,/rebuild_needed=true/);
assert.match(daily,/git rebase origin\/main/);
assert.match(daily,/git push origin HEAD:main/);

assert.doesNotMatch(quant,/contents:\s*write/);
assert.doesNotMatch(quant,/git push/);
assert.doesNotMatch(quant,/git commit/);
assert.doesNotMatch(quant,/schedule:/);
assert.doesNotMatch(quant,/workflow_run:/);

const forbidden=[
  'data/decision-cockpit.json','data/prospective-evidence.json','data/evidence-event-ledger.json',
  'data/prediction-ledger.json','data/replay','data/walk-forward-validation.json','data/model-governance.json'
];
for(const p of forbidden)assert.ok(!ucp.includes('git add '+p),'UCP writer must not own '+p);

assert.strictEqual(ownership.safety.automaticExecution,false);
console.log(JSON.stringify({ok:true,producer:ownership.authoritativeProducerWorkflow,canonicalPaths:ownership.canonicalPaths.length},null,2));
