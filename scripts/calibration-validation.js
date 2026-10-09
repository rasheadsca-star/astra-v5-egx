'use strict';

const assert=require('assert');
const {
  maturity,distinctSessions,selectHierarchicalPool,blockBootstrap,aggregate,scoreCalibration
}=require('./lib/calibration-stats');
const {captureHash}=require('./lib/persistent-evidence');

function rec(i,sessions=30,opts={}){
  const s='2026-09-'+String(1+(i%sessions)).padStart(2,'0');
  const hit=i%3!==0;
  return {
    session:s,ticker:'T'+i,
    finalDecisionGrade:opts.grade||'B',
    entryQuality:opts.entry||'IDEAL',
    rrT2:opts.rr??2.4,
    contextScore:opts.ctx??60,
    outcome:{
      status:'RESOLVED',
      result:i%7===0?'STOP':i%4===0?'TARGET2':'TIME_EXIT',
      t1HitAt:hit?s:null,
      t2HitAt:i%4===0?s:null,
      netReturnPct:(i%7===0?-3:hit?2:0)
    },
    probabilityStatusAtCapture:opts.probStatus||null,
    exAnteT1ProbabilityPct:opts.p1??null,
    exAnteT2ProbabilityPct:opts.p2??null,
    exAnteStopProbabilityPct:opts.ps??null
  };
}

assert.strictEqual(maturity(Array.from({length:89},(_,i)=>rec(i,30))),'CALIBRATING');
assert.strictEqual(maturity(Array.from({length:90},(_,i)=>rec(i,29))),'CALIBRATING');
assert.strictEqual(maturity(Array.from({length:90},(_,i)=>rec(i,30))),'MATURE_SAMPLE');
assert.strictEqual(distinctSessions(Array.from({length:90},(_,i)=>rec(i,30))),30);

const rows=[];
for(let i=0;i<120;i++)rows.push(rec(i,30,{grade:i<10?'A':'B'}));
const pool=selectHierarchicalPool({finalDecisionGrade:'A',entryQuality:'IDEAL',rrT2:2.4,contextScore:60},rows);
assert.notStrictEqual(pool.level,'L4_EXACT','Sparse exact bucket should back off rather than claim local calibration.');
assert.ok(pool.records.length>=30);

const boot=blockBootstrap(rows,x=>x.reduce((s,r)=>s+r.outcome.netReturnPct,0)/x.length,{reps:200,seed:'fixed'});
const boot2=blockBootstrap(rows,x=>x.reduce((s,r)=>s+r.outcome.netReturnPct,0)/x.length,{reps:200,seed:'fixed'});
assert.deepStrictEqual(boot,boot2,'session bootstrap must be deterministic for audit reproducibility');
assert.ok(boot.ci90.every(Number.isFinite));

const agg=aggregate(rows,'TEST');
assert.strictEqual(agg.n,120);
assert.strictEqual(agg.distinctSessions,30);
assert.strictEqual(agg.maturity,'MATURE_SAMPLE');
assert.ok(Array.isArray(agg.intervals.t1)&&agg.intervals.t1.length===2);

const scored=Array.from({length:100},(_,i)=>rec(i,30,{probStatus:'VALIDATED',p1:70,p2:35,ps:20}));
const cs=scoreCalibration(scored,'exAnteT1ProbabilityPct','t1');
assert.strictEqual(cs.status,'AVAILABLE');
assert.ok(cs.brier>=0&&cs.brier<=1);
assert.ok(cs.ece>=0&&cs.ece<=1);
assert.strictEqual(cs.bins.length,5);

const tooSmall=scoreCalibration(scored.slice(0,20),'exAnteT1ProbabilityPct','t1');
assert.strictEqual(tooSmall.status,'INSUFFICIENT_SCORED_PREDICTIONS');


const oldV2={id:'2026-10-01|AAA',evidenceKeyVersion:'session+ticker/v2',session:'2026-10-01',ticker:'AAA',stage:'TOP',rank:1,capturedAt:'2026-10-01T13:30:00Z',captureTiming:'ON_SESSION_AFTER_CLOSE',recordedForwardEligible:true,modelVersion:'OLD',buildCommit:'OLD'};
const oldV2Changed={...oldV2,exAnteT1ProbabilityPct:99,probabilityStatusAtCapture:'VALIDATED'};
assert.strictEqual(captureHash(oldV2),captureHash(oldV2Changed),'v2 hash compatibility must ignore fields that did not exist in v2');
const newV3={...oldV2,evidenceKeyVersion:'session+ticker/v3',exAnteT1ProbabilityPct:60,probabilityStatusAtCapture:'VALIDATED'};
const newV3Changed={...newV3,exAnteT1ProbabilityPct:70};
assert.notStrictEqual(captureHash(newV3),captureHash(newV3Changed),'v3 must freeze ex-ante calibration fields');

console.log(JSON.stringify({ok:true,maturity:agg.maturity,poolLevel:pool.level,bootstrap:boot,calibrationScore:{brier:cs.brier,ece:cs.ece}},null,2));
