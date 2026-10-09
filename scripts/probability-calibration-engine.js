'use strict';

const fs=require('fs'),path=require('path');
const {dedupeEvidenceRecords}=require('./lib/evidence-dedupe');
const {
  MATURITY_THRESHOLDS,n,aggregate,selectHierarchicalPool,scoreCalibration
}=require('./lib/calibration-stats');

const COCKPIT='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const EVID='data/prospective-evidence.json';
const QUANT='data/quant/signals.json';
const WALK_FORWARD='data/walk-forward-validation.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}

const d=read(COCKPIT,null);
if(!d)throw new Error('decision cockpit missing');
const e=read(EVID,{records:[],counts:{},metrics:{}});
const q=read(QUANT,null);
const wf=read(WALK_FORWARD,{governance:{calibrationClaimAllowed:false}});

const cleanEvidence=dedupeEvidenceRecords(
  (e.records||[]).filter(r=>r.excludedFromAnalytics!==true&&r.recordedForwardEligible===true)
).primary;
const resolved=cleanEvidence.filter(r=>r.outcome?.status==='RESOLVED');
const overall=aggregate(resolved,'OVERALL');
const walkForwardClaimAllowed=wf?.governance?.calibrationClaimAllowed===true;

let engineStatus=overall.maturity;
if(overall.maturity==='MATURE_SAMPLE'){
  engineStatus=walkForwardClaimAllowed?'VALIDATED':'MATURE_SAMPLE_WAITING_WALK_FORWARD';
}

// Historical benchmark remains contextual only; it is never treated as a forward probability.
const quantHist=q?.plan?.top||null;
const quantBenchmark=quantHist?{
  sampleSize:n(quantHist.n),
  t1HitPct:n(quantHist.hit1),
  t2HitPct:n(quantHist.hit2),
  source:'historical_quant_backtest',
  calibratedForward:false
}:null;

function probabilityFor(x){
  const estimatePool=selectHierarchicalPool(x,resolved,MATURITY_THRESHOLDS.bucket);
  const estimate=aggregate(estimatePool.records,'EST|'+estimatePool.level+'|'+estimatePool.key);
  const estimateAvailable=estimate.maturity!=='INSUFFICIENT_EVIDENCE';

  const maturePool=selectHierarchicalPool(x,resolved,MATURITY_THRESHOLDS.mature);
  const matureStats=aggregate(maturePool.records,'VAL|'+maturePool.level+'|'+maturePool.key);
  const validated=engineStatus==='VALIDATED'&&matureStats.maturity==='MATURE_SAMPLE';

  let status=estimate.maturity;
  if(validated)status='VALIDATED';
  else if(estimate.maturity==='MATURE_SAMPLE')status='MATURE_SAMPLE_WAITING_WALK_FORWARD';

  return {
    status,
    calibrated:validated,
    distinctSessions:estimate.distinctSessions,
    sampleSize:estimate.n,
    poolLevel:estimatePool.level,
    poolKey:estimatePool.key,
    poolFallback:estimatePool.fallback,
    estimateSource:'hierarchical_recorded_forward_pool',
    t1EstimatePct:estimateAvailable?estimate.t1EstimatePct:null,
    t1EstimateCi90:estimateAvailable?estimate.intervals.t1:[null,null],
    t2EstimatePct:estimateAvailable?estimate.t2EstimatePct:null,
    t2EstimateCi90:estimateAvailable?estimate.intervals.t2:[null,null],
    stopEstimatePct:estimateAvailable?estimate.stopEstimatePct:null,
    stopEstimateCi90:estimateAvailable?estimate.intervals.stop:[null,null],
    expectedValueEstimatePct:estimateAvailable?estimate.avgNetReturnPct:null,
    expectedValueEstimateCi90:estimateAvailable?estimate.intervals.avgNetReturn:[null,null],

    // Probability fields remain null until BOTH mature sample and walk-forward governance allow the claim.
    t1ProbabilityPct:validated?matureStats.t1EstimatePct:null,
    t1Ci90:validated?matureStats.intervals.t1:[null,null],
    t2ProbabilityPct:validated?matureStats.t2EstimatePct:null,
    t2Ci90:validated?matureStats.intervals.t2:[null,null],
    stopProbabilityPct:validated?matureStats.stopEstimatePct:null,
    stopCi90:validated?matureStats.intervals.stop:[null,null],
    expectedValuePct:validated?matureStats.avgNetReturnPct:null,
    probabilitySource:validated?('hierarchical_'+maturePool.level.toLowerCase()):null,
    probabilityPoolLevel:validated?maturePool.level:null,
    probabilityPoolSampleSize:validated?matureStats.n:null,
    probabilityPoolDistinctSessions:validated?matureStats.distinctSessions:null,

    expectedValueMethod:'empirical_fixed_horizon_net_return',
    intervalMethod:'90% session-block bootstrap',
    holdingHorizonSessions:e.policy?.holdingHorizonSessions??10,
    historicalBenchmark:(x.engineFamilies||[]).includes('NEXT_QUANT')?quantBenchmark:null,
    note:validated
      ?'Validated forward probability: mature distinct-session sample, hierarchical pooling, session-block bootstrap, and walk-forward release gate all passed. It is not a guarantee.'
      :estimateAvailable
        ?'Forward empirical estimate only. Probability fields are withheld until >=90 resolved outcomes across >=30 distinct sessions and the walk-forward calibration gate passes.'
        :'Insufficient independent forward evidence. No probability is shown.'
  };
}

for(const group of ['topOpportunities','watchlist','rejected']){
  d[group]=(d[group]||[]).map(x=>({...x,targetAchievement:probabilityFor(x)}));
}

const all=[...(d.topOpportunities||[]),...(d.watchlist||[]),...(d.rejected||[])];
const withEstimate=all.filter(x=>n(x.targetAchievement?.t1EstimatePct)!=null);
const bestEstimate=withEstimate.slice().sort((a,b)=>
  (n(b.targetAchievement?.t1EstimatePct)||-1)-(n(a.targetAchievement?.t1EstimatePct)||-1) ||
  (n(b.finalDecisionScore)||-1)-(n(a.finalDecisionScore)||-1)
)[0]||null;
const withValidated=all.filter(x=>n(x.targetAchievement?.t1ProbabilityPct)!=null);
const bestValidated=withValidated.slice().sort((a,b)=>
  (n(b.targetAchievement?.t1ProbabilityPct)||-1)-(n(a.targetAchievement?.t1ProbabilityPct)||-1) ||
  (n(b.finalDecisionScore)||-1)-(n(a.finalDecisionScore)||-1)
)[0]||null;

const calibrationScoring={
  t1:scoreCalibration(resolved,'exAnteT1ProbabilityPct','t1'),
  t2:scoreCalibration(resolved,'exAnteT2ProbabilityPct','t2'),
  stop:scoreCalibration(resolved,'exAnteStopProbabilityPct','stop')
};

d.probabilityCalibrationEngine={
  version:'probability-calibration/v3-session-aware',
  generatedAt:new Date().toISOString(),
  forwardResolved:resolved.length,
  forwardDistinctSessions:overall.distinctSessions,
  sampleMaturity:overall.maturity,
  status:engineStatus,
  walkForwardCalibrationGate:walkForwardClaimAllowed,
  holdingHorizonSessions:e.policy?.holdingHorizonSessions??10,
  thresholds:{
    preliminary:MATURITY_THRESHOLDS.preliminary,
    calibrating:MATURITY_THRESHOLDS.calibrating,
    mature:MATURITY_THRESHOLDS.mature,
    hierarchicalBucket:MATURITY_THRESHOLDS.bucket,
    scoring:MATURITY_THRESHOLDS.scoring
  },
  methodology:'Recorded-forward resolved evidence only. Maturity requires both resolved outcomes and distinct sessions. Estimates use hierarchical pooling from grade+entry+R:R+context toward broader pools. Confidence intervals use deterministic 90% session-block bootstrap. Probability fields remain null until >=90 resolved outcomes across >=30 distinct sessions AND the walk-forward calibration gate passes. Brier/ECE are computed only from ex-ante VALIDATED probabilities frozen at capture.',
  overall,
  calibrationScoring,
  quantHistoricalBenchmark:quantBenchmark,
  bestByEstimatedT1:bestEstimate?{
    ticker:bestEstimate.ticker,
    t1EstimatePct:bestEstimate.targetAchievement.t1EstimatePct,
    t2EstimatePct:bestEstimate.targetAchievement.t2EstimatePct,
    stopEstimatePct:bestEstimate.targetAchievement.stopEstimatePct,
    expectedValueEstimatePct:bestEstimate.targetAchievement.expectedValueEstimatePct,
    sampleSize:bestEstimate.targetAchievement.sampleSize,
    distinctSessions:bestEstimate.targetAchievement.distinctSessions,
    status:bestEstimate.targetAchievement.status,
    poolLevel:bestEstimate.targetAchievement.poolLevel
  }:null,
  bestByValidatedT1:bestValidated?{
    ticker:bestValidated.ticker,
    t1ProbabilityPct:bestValidated.targetAchievement.t1ProbabilityPct,
    t2ProbabilityPct:bestValidated.targetAchievement.t2ProbabilityPct,
    stopProbabilityPct:bestValidated.targetAchievement.stopProbabilityPct,
    expectedValuePct:bestValidated.targetAchievement.expectedValuePct,
    sampleSize:bestValidated.targetAchievement.probabilityPoolSampleSize,
    distinctSessions:bestValidated.targetAchievement.probabilityPoolDistinctSessions,
    status:bestValidated.targetAchievement.status,
    poolLevel:bestValidated.targetAchievement.probabilityPoolLevel
  }:null,
  researchOnly:true,
  automaticExecution:false
};

write(COCKPIT,d);write(DOC,d);
console.log(JSON.stringify(d.probabilityCalibrationEngine,null,2));
