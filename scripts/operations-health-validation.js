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

function read(p,fallback={}){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
const currentCockpit=read('data/decision-cockpit.json',{});
const currentInputs={
  packageVersion:read('package.json',{version:'unknown'}).version,
  cockpit:currentCockpit,
  market:read('data/canonical-market.json',{}),
  history:read('data/history-index.json',{}),
  sourceHealth:read('data/source-health.json',currentCockpit.sourceHealthEngine||{}),
  prediction:read('data/prediction-ledger.json',{}),
  eventLedger:read('data/evidence-event-ledger.json',{}),
  replay:read('data/replay/index.json',{}),
  walkForward:read('data/walk-forward-validation.json',currentCockpit.walkForwardValidationEngine||{}),
  governance:read('data/model-governance.json',currentCockpit.modelGovernanceEngine||{}),
  quantStatus:read('quant/data/daily-data-update-status.json',{})
};
const current=evaluateOperations(currentInputs);
assert.strictEqual(current.automaticExecution,false);
assert.ok(['HEALTHY','DEGRADED','CRITICAL'].includes(current.overall));
console.log(JSON.stringify({ok:true,synthetic:{healthy:healthy.overall,degraded:degraded.overall,critical:critical.overall},current:{overall:current.overall,summary:current.summary,activeIssues:current.issueCandidates.filter(x=>x.active).map(x=>x.key)}},null,2));
