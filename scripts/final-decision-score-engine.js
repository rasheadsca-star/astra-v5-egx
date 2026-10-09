'use strict';

const fs=require('fs'),path=require('path');
const {
  n,r,clamp,BASE_WEIGHTS,scoreWithWeights,sensitivity,grade,label
}=require('./lib/final-score-policy');

const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const EVID='data/prospective-evidence.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}

const cockpit=read(IN,null);
if(!cockpit)throw new Error('decision cockpit missing');
const evidence=read(EVID,{records:[],counts:{},metrics:{}});

function riskRewardScore(x){
  const rr=n(x.rrT2);
  if(rr==null)return null;
  if(rr>=3)return 100;
  if(rr>=2.5)return 90;
  if(rr>=2)return 80;
  if(rr>=1.5)return 60;
  if(rr>=1)return 40;
  return 15;
}
function evidenceScore(x){
  const ev=Array.isArray(x.evidence)?x.evidence.length:0;
  const warn=Array.isArray(x.warnings)?x.warnings.length:0;
  // Zero evidence is an observed state, not a missing value.
  return clamp(50+ev*7-warn*8);
}
function riskScore(x){
  const risk=n(x.riskPct);
  if(risk==null)return null;
  if(risk<=3)return 100;
  if(risk<=5)return 85;
  if(risk<=8)return 65;
  if(risk<=12)return 40;
  return 15;
}
function componentsFor(x){
  return {
    technical:n(x.qualityScore)??n(x.conviction),
    entryQuality:n(x.entryQualityScore),
    context:n(x.contextScore),
    riskReward:riskRewardScore(x),
    riskControl:riskScore(x),
    evidence:evidenceScore(x)
  };
}
function completeness(coveragePct,missing){
  if(!missing.length&&coveragePct>=99.9)return 'COMPLETE';
  if(coveragePct>=80)return 'HIGH';
  if(coveragePct>=65)return 'PARTIAL';
  return 'LOW';
}

function scoreRow(x){
  const components=componentsFor(x);
  const scored=scoreWithWeights(components,x,BASE_WEIGHTS);
  const robust=sensitivity(components,x,BASE_WEIGHTS);
  let finalScore=scored.score;

  // Coverage is not backfilled with a neutral 50. Low coverage can only reduce/cap trust.
  if(scored.coveragePct<65&&finalScore!=null)finalScore=Math.min(finalScore,49.9);
  else if(scored.coveragePct<80&&finalScore!=null)finalScore=Math.min(finalScore,61.9);

  const g=grade(finalScore,x);
  const sensitivityGrades=new Set([g]);
  for(const c of robust.cases||[]){
    sensitivityGrades.add(grade(c.score,x));
  }

  return {
    ...x,
    finalDecisionScore:r(finalScore,1),
    finalDecisionGrade:g,
    finalDecisionLabel:label(g),
    finalDecisionComponents:Object.fromEntries(
      Object.entries(components).map(([k,v])=>[k,r(v,1)])
    ),
    finalDecisionCompleteness:{
      coveragePct:scored.coveragePct,
      status:completeness(scored.coveragePct,scored.missing),
      missingComponents:scored.missing,
      scoreCap:scored.cap,
      capReasons:scored.capReasons,
      neutralImputationUsed:false
    },
    finalDecisionPenalties:scored.penalties,
    finalDecisionSensitivity:{
      perturbation:'ONE_COMPONENT_WEIGHT_PLUS_MINUS_20_PERCENT_RENORMALIZED',
      status:robust.status,
      minScore:robust.min,
      maxScore:robust.max,
      maxAbsDelta:robust.maxAbsDelta,
      gradeStable:sensitivityGrades.size===1,
      possibleGrades:[...sensitivityGrades],
      cases:robust.cases
    }
  };
}

for(const group of ['topOpportunities','watchlist','rejected']){
  cockpit[group]=(cockpit[group]||[]).map(scoreRow);
  cockpit[group].sort((a,b)=>(b.finalDecisionScore??-1)-(a.finalDecisionScore??-1)||(a.rank??999)-(b.rank??999));
  cockpit[group]=cockpit[group].map((x,i)=>({...x,finalDecisionRank:i+1}));
}

const all=[...(cockpit.topOpportunities||[]),...(cockpit.watchlist||[]),...(cockpit.rejected||[])];
const gradeCounts={};
for(const x of all)gradeCounts[x.finalDecisionGrade]=(gradeCounts[x.finalDecisionGrade]||0)+1;
const coverageValues=all.map(x=>n(x.finalDecisionCompleteness?.coveragePct)).filter(Number.isFinite);
const robustCounts={};
for(const x of all){
  const k=x.finalDecisionSensitivity?.status||'UNKNOWN';
  robustCounts[k]=(robustCounts[k]||0)+1;
}
const gradeUnstable=all.filter(x=>x.finalDecisionSensitivity?.gradeStable===false).map(x=>x.ticker);

const resolvedForward=(evidence.records||[]).filter(x=>
  x.excludedFromAnalytics!==true&&x.recordedForwardEligible===true&&x.outcome?.status==='RESOLVED'
);

cockpit.finalDecisionEngine={
  version:'final-decision-score/v2-missing-aware',
  generatedAt:new Date().toISOString(),
  weights:BASE_WEIGHTS,
  missingValuePolicy:{
    rule:'MISSING_COMPONENTS_ARE_NOT_IMPUTED_TO_50',
    method:'Renormalize only across available components, then apply explicit caps for missing critical/context inputs and low score coverage.',
    criticalComponents:['technical','entryQuality','riskReward','riskControl'],
    neutralImputationUsed:false
  },
  engineAgreementPolicy:{
    source:'config/engine-family-registry.json',
    rule:'Distinct declared engine families only; family breadth is not a statistical independence claim.',
    familyBreadthBonusSource:'build-decision-cockpit.js'
  },
  forwardEvidencePolicy:{
    includedInFinalScore:false,
    reason:'A single global forward score is non-discriminative and would add the same pseudo-evidence to every ticker. Forward evidence remains visible in calibration/outcome analytics and can only become ticker-specific probability after WP5 governance.',
    currentlyResolvedRecordedForward:resolvedForward.length
  },
  sensitivityPolicy:{
    perturbation:'Each available component weight is changed by -20% and +20% one at a time, then available weights are renormalized.',
    robustCounts,
    gradeUnstableTickers:gradeUnstable
  },
  completeness:{
    averageCoveragePct:coverageValues.length?r(coverageValues.reduce((a,b)=>a+b,0)/coverageValues.length,1):null,
    below80:all.filter(x=>(n(x.finalDecisionCompleteness?.coveragePct)??0)<80).length,
    below65:all.filter(x=>(n(x.finalDecisionCompleteness?.coveragePct)??0)<65).length
  },
  gradeCounts,
  note:'Final Decision Score is a missing-aware research ranking, not a probability of profit and not an execution instruction.',
  researchOnly:true,
  automaticExecution:false
};

write(IN,cockpit);write(DOC,cockpit);
console.log(JSON.stringify({
  version:cockpit.finalDecisionEngine.version,
  gradeCounts,
  completeness:cockpit.finalDecisionEngine.completeness,
  sensitivity:cockpit.finalDecisionEngine.sensitivityPolicy,
  top:(cockpit.topOpportunities||[]).slice(0,10).map(x=>({
    ticker:x.ticker,score:x.finalDecisionScore,grade:x.finalDecisionGrade,
    coverage:x.finalDecisionCompleteness?.coveragePct,
    missing:x.finalDecisionCompleteness?.missingComponents,
    sensitivity:x.finalDecisionSensitivity?.status
  }))
},null,2));
