'use strict';
const assert=require('assert');
const fs=require('fs');
const {evaluateOperations}=require('./lib/operations-health');

function base(){
  return {
    packageVersion:'TEST',
    cockpit:{
      session:'2026-10-08',
      safety:{researchOnly:true,executionAllowed:false,automaticOrders:false},
      dataHealth:{stale:false,staleLagSessions:0},
      probabilityCalibrationEngine:{status:'INSUFFICIENT_EVIDENCE',forwardResolved:0,forwardDistinctSessions:0}
    },
    market:{source:{atomicHandoff:true,expectedSession:'2026-10-08',sourceSessionDataHash:'abc'}},
    history:{source:{atomicHandoff:true,expectedSession:'2026-10-08',sourceSessionDataHash:'abc'}},
    sourceHealth:{coverage:{activeCoveragePct:100,staleActiveSymbols:0,sourceFailedSymbols:0},crossStoreConsistency:{canonicalCurrentButQuantStale:[]},independentVerification:{quorumMet:false}},
    prediction:{chain:{status:'VERIFIED'},records:[{session:'2026-10-08'}]},
    eventLedger:{chain:{status:'VERIFIED'},records:[]},
    replay:{sessions:[{session:'2026-10-08'}]},
    walkForward:{status:'WAITING_FOR_MINIMUM_SESSIONS',coverage:{validFolds:0}},
    governance:{releaseGate:{canEnableAutomaticExecution:false},reliability:{score:50}},
    quantStatus:{finalStatus:'READY',coveragePct:100}
  };
}

const healthy=evaluateOperations(base());
assert.strictEqual(healthy.overall,'HEALTHY');
assert.strictEqual(healthy.automaticExecution,false);
assert.strictEqual(healthy.summary.fail,0);
assert.strictEqual(healthy.issueCandidates.filter(x=>x.active).length,0);

const mismatch=base();
mismatch.sourceHealth.crossStoreConsistency.canonicalCurrentButQuantStale=['AAA'];
const degraded=evaluateOperations(mismatch);
assert.strictEqual(degraded.overall,'DEGRADED');
assert.ok(degraded.issueCandidates.find(x=>x.key==='CROSS_STORE_FRESHNESS')?.active);

const broken=base();
broken.prediction.chain.status='BROKEN';
const critical=evaluateOperations(broken);
assert.strictEqual(critical.overall,'CRITICAL');
assert.ok(critical.issueCandidates.find(x=>x.key==='LEDGER_INTEGRITY')?.active);

const safety=base();
safety.cockpit.safety.automaticOrders=true;
const unsafe=evaluateOperations(safety);
assert.strictEqual(unsafe.overall,'CRITICAL');
assert.ok(unsafe.issueCandidates.find(x=>x.key==='EXECUTION_SAFETY')?.active);

const currentInputs={
  packageVersion:JSON.parse(fs.readFileSync('package.json','utf8')).version,
  cockpit:JSON.parse(fs.readFileSync('data/decision-cockpit.json','utf8')),
  market:JSON.parse(fs.readFileSync('data/canonical-market.json','utf8')),
  history:JSON.parse(fs.readFileSync('data/history-index.json','utf8')),
  sourceHealth:JSON.parse(fs.readFileSync('data/source-health.json','utf8')),
  prediction:JSON.parse(fs.readFileSync('data/prediction-ledger.json','utf8')),
  eventLedger:JSON.parse(fs.readFileSync('data/evidence-event-ledger.json','utf8')),
  replay:JSON.parse(fs.readFileSync('data/replay/index.json','utf8')),
  walkForward:JSON.parse(fs.readFileSync('data/walk-forward-validation.json','utf8')),
  governance:JSON.parse(fs.readFileSync('data/model-governance.json','utf8')),
  quantStatus:JSON.parse(fs.readFileSync('quant/data/daily-data-update-status.json','utf8'))
};
const current=evaluateOperations(currentInputs);
assert.strictEqual(current.automaticExecution,false);
assert.ok(['HEALTHY','DEGRADED','CRITICAL'].includes(current.overall));
console.log(JSON.stringify({ok:true,synthetic:{healthy:healthy.overall,degraded:degraded.overall,critical:critical.overall},current:{overall:current.overall,summary:current.summary,activeIssues:current.issueCandidates.filter(x=>x.active).map(x=>x.key)}},null,2));
