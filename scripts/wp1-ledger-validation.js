'use strict';
const assert=require('assert');
const {classifyCaptureTiming,captureHash}=require('./lib/persistent-evidence');
const {updateEventLedger,verifyChain}=require('./lib/evidence-event-store');

function rec(session,ticker,capturedAt,status='PENDING'){
  const r={
    id:session+'|'+ticker,evidenceKeyVersion:'session+ticker/v2',session,ticker,stage:'TOP',rank:1,
    conviction:80,qualityScore:78,agreementCount:3,engineFamilies:['A'],entryLow:10,entryHigh:10.2,stop:9.5,target1:10.8,target2:11.5,
    riskPct:5,rrT2:2.6,currentPrice:10.1,entryQuality:'IDEAL',entryQualityScore:85,entryDistancePct:0,chaseDistancePct:0,
    contextScore:70,contextAdjustment:0,adjustedConviction:80,marketContextScore:70,sector:'TEST',sectorStrengthScore:60,sectorSource:'TEST',
    sectorContextScore:60,sectorContextStatus:'OK',liquidityContextScore:80,finalDecisionScore:75,finalDecisionGrade:'A',finalDecisionLabel:'STRONG',
    portfolioSelected:true,portfolioRank:1,portfolioResearchWeightPct:20,riskBudgetPct:1,theoreticalRiskBudgetPct:1,actionableRiskBudgetPct:1,
    theoreticalShares100k:100,actionableShares100k:100,actionableNow:true,riskStateOverrideReason:'IN_ENTRY_ZONE_GATE_PASSED',referenceShares100k:100,
    referencePositionValue100k:1000,referenceMaxLoss100k:50,monitoringState:'IN_ENTRY_ZONE',monitoringSeverity:'INFO',monitoringAction:'WATCH',
    regime:'NEUTRAL',breadthPct:50,exposureScale:1,warnings:[],evidence:[],capturedAt,
    captureTiming:classifyCaptureTiming(session,capturedAt),modelVersion:'TEST',buildCommit:'TEST',
    outcome:{status,resolvedAt:null,fillPrice:null,exitPrice:null,netReturnPct:null,maxFavorablePct:null,maxAdversePct:null}
  };
  r.recordedForwardEligible=r.captureTiming==='ON_SESSION_AFTER_CLOSE';
  r.captureHash=captureHash(r);
  return r;
}

assert.strictEqual(classifyCaptureTiming('2026-10-07','2026-10-07T13:30:00Z'),'ON_SESSION_AFTER_CLOSE');
assert.strictEqual(classifyCaptureTiming('2026-10-07','2026-10-09T08:30:00Z'),'LATE_CAPTURE');

const A=rec('2026-10-05','AAA','2026-10-05T13:30:00Z');
const B=rec('2026-10-06','BBB','2026-10-06T13:30:00Z');
let ledger=updateEventLedger(null,[A],'2026-10-05T14:00:00Z');
const aHash=ledger.records[0].recordHash;
assert.strictEqual(ledger.captureEvents,1);
assert.strictEqual(ledger.records.length,2);

ledger=updateEventLedger(ledger,[A,B],'2026-10-06T14:00:00Z');
assert.strictEqual(ledger.captureEvents,2);
assert.strictEqual(ledger.records.length,4);
assert.strictEqual(ledger.records[0].recordHash,aHash,'session A was rewritten when B appended');

const beforeRerun=JSON.stringify(ledger.records);
ledger=updateEventLedger(ledger,[A,B],'2026-10-06T14:05:00Z');
assert.strictEqual(JSON.stringify(ledger.records),beforeRerun,'rerunning session B appended duplicate events');

B.outcome={status:'RESOLVED',result:'TARGET2',resolvedAt:'2026-10-15',fillPrice:10.2,exitPrice:11.5,netReturnPct:12.15,maxFavorablePct:13,maxAdversePct:-2};
ledger=updateEventLedger(ledger,[A,B],'2026-10-15T14:00:00Z');
assert.strictEqual(ledger.records.length,5,'outcome transition should append exactly one event');
assert.strictEqual(ledger.records[0].recordHash,aHash,'historical capture changed after outcome update');
assert.ok(verifyChain(ledger.records).ok);

const tampered=structuredClone(A);tampered.entryHigh=99;
assert.throws(()=>updateEventLedger(ledger,[tampered,B],'2026-10-15T14:05:00Z'),/CAPTURE_HASH_MISMATCH|IMMUTABLE_CAPTURE_CHANGED/);

console.log(JSON.stringify({ok:true,scenario:'A -> B -> rerun B -> resolve B',records:ledger.records.length,captureEvents:ledger.captureEvents,outcomeEvents:ledger.outcomeEvents,chain:ledger.chain.status},null,2));
