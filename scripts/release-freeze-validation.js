'use strict';

const fs=require('fs');
const assert=require('assert');

function read(p){return JSON.parse(fs.readFileSync(p,'utf8'))}

const freeze=read('config/release-freeze.json');
const pkg=read('package.json');
const cockpit=read('data/decision-cockpit.json');
const replay=read('data/replay/index.json');
const ledger=read('data/prediction-ledger.json');

assert.strictEqual(freeze.release,'ASTRA V6.11');
assert.strictEqual(freeze.packageVersion,pkg.version);
assert.strictEqual(freeze.codeFreeze,true);
assert.match(freeze.frozenCommit,/^[0-9a-f]{40}$/);
assert.strictEqual(freeze.stableBranch,'release-v6.11-stable');
assert.strictEqual(freeze.freezePolicy.automaticExecution,false);
assert.strictEqual(freeze.freezePolicy.strategyChangesAllowed,false);
assert.strictEqual(freeze.freezePolicy.scoringChangesAllowed,false);
assert.strictEqual(freeze.freezePolicy.executionContractChangesAllowed,false);
assert.strictEqual(freeze.freezePolicy.dataSourceLogicChangesAllowed,false);

const b=freeze.baseline;
const replayItem=(replay.sessions||[]).find(x=>x.session===b.session);
const ledgerItem=(ledger.records||[]).find(x=>x.session===b.session);
assert.ok(replayItem,'frozen baseline replay session missing');
assert.ok(ledgerItem,'frozen baseline prediction record missing');
assert.strictEqual(replayItem.snapshotSha256,b.snapshotSha256,'frozen replay snapshot changed');
assert.strictEqual(ledgerItem.recordHash,b.predictionRecordHash,'frozen ledger record changed');

assert.strictEqual(cockpit.safety?.researchOnly,true);
assert.strictEqual(cockpit.safety?.executionAllowed,false);
assert.strictEqual(cockpit.safety?.automaticOrders,false);

console.log(JSON.stringify({
  ok:true,
  release:freeze.release,
  frozenCommit:freeze.frozenCommit,
  baselineSession:b.session,
  execution:'OFF'
},null,2));
