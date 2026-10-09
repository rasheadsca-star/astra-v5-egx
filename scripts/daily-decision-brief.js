'use strict';

const fs=require('fs'),path=require('path');
const CUR='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const HIST='data/daily-decision-brief-history.json';
const DOC_HIST='docs/data/daily-decision-brief-history.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function r1(x){return Number.isFinite(x)?+x.toFixed(1):null}

const d=read(CUR,null);
if(!d)throw new Error('decision cockpit missing');
const history=read(HIST,{version:'daily-brief-history/v1',records:[]});
const session=d.session||d.marketSectorContextEngine?.marketSession||null;
const basket=d.portfolioSelectionEngine?.basket||[];
const top=(d.topOpportunities||[]).slice().sort((a,b)=>(n(b.finalDecisionScore)||-1)-(n(a.finalDecisionScore)||-1));
const eligible=top.filter(x=>x.decisionGate?.pass===true);
const best=(eligible[0]||top[0]||null);
const top3=(eligible.length?eligible:top).slice(0,3);

const prior=[...(history.records||[])].reverse().find(r=>r.session && r.session!==session)||null;
const currentTickers=basket.map(x=>x.ticker);
const priorTickers=prior?.basketTickers||[];
const entered=currentTickers.filter(x=>!priorTickers.includes(x));
const exited=priorTickers.filter(x=>!currentTickers.includes(x));
const retained=currentTickers.filter(x=>priorTickers.includes(x));

function riskFlags(){
  const out=[];
  if(d.dataHealth?.stale) out.push('STALE_DATA');
  if((n(d.marketSectorContextEngine?.market?.score)||50)<40) out.push('WEAK_MARKET');
  if((n(d.market?.breadthPct)||50)<40) out.push('WEAK_BREADTH');
  if(d.market?.driftGuard) out.push('DRIFT_GUARD_ON');
  if((d.decisionGateEngine?.counts?.eligible||0)===0) out.push('NO_GATE_PASSED_SETUP');
  if((d.probabilityCalibrationEngine?.forwardResolved||0)<10) out.push('PROBABILITY_NOT_CALIBRATED');
  return out;
}

function changeSummary(){
  if(!prior)return {status:'NO_PRIOR_SESSION',entered,exited,retained,scoreMoves:[]};
  const priorScores=new Map((prior.top3||[]).map(x=>[x.ticker,n(x.finalDecisionScore)]));
  const scoreMoves=top3.map(x=>({
    ticker:x.ticker,
    current:n(x.finalDecisionScore),
    prior:priorScores.has(x.ticker)?priorScores.get(x.ticker):null,
    delta:priorScores.has(x.ticker)&&n(x.finalDecisionScore)!=null?r1(n(x.finalDecisionScore)-priorScores.get(x.ticker)):null
  }));
  return {status:'COMPARED',entered,exited,retained,scoreMoves};
}

const brief={
  version:'daily-decision-brief/v1',
  generatedAt:new Date().toISOString(),
  session,
  headline:best?{
    ticker:best.ticker,
    finalDecisionScore:n(best.finalDecisionScore),
    grade:best.finalDecisionGrade||null,
    gateStatus:best.decisionGate?.status||null,
    entryQuality:best.entryQuality||null,
    rrT2:n(best.rrT2),
    entryLow:n(best.entryLow),
    entryHigh:n(best.entryHigh),
    stop:n(best.stop),
    target1:n(best.target1),
    target2:n(best.target2),
    contextScore:n(best.contextScore),
    t1ProbabilityPct:n(best.targetAchievement?.t1ProbabilityPct),
    t2ProbabilityPct:n(best.targetAchievement?.t2ProbabilityPct),
    probabilityStatus:best.targetAchievement?.status||'INSUFFICIENT_DATA'
  }:null,
  top3:top3.map((x,i)=>({
    rank:i+1,
    ticker:x.ticker,
    finalDecisionScore:n(x.finalDecisionScore),
    grade:x.finalDecisionGrade||null,
    gateStatus:x.decisionGate?.status||null,
    entryQuality:x.entryQuality||null,
    rrT2:n(x.rrT2),
    contextScore:n(x.contextScore),
    researchWeightPct:n(x.portfolioResearchWeightPct),
    portfolioSelected:x.portfolioSelected===true
  })),
  basket:basket.map(x=>({
    rank:x.rank,ticker:x.ticker,
    researchWeightPct:n(x.researchWeightPct),
    effectiveExposurePct:n(x.effectiveExposurePct),
    score:n(x.portfolioSelectionScore),
    entryQuality:x.entryQuality,
    rrT2:n(x.rrT2)
  })),
  changes:changeSummary(),
  risks:riskFlags(),
  market:{
    regime:d.market?.regime||null,
    breadthPct:n(d.market?.breadthPct),
    contextScore:n(d.marketSectorContextEngine?.market?.score),
    exposureScale:n(d.market?.exposureScale),
    driftGuard:!!d.market?.driftGuard
  },
  evidence:{
    forwardResolved:d.probabilityCalibrationEngine?.forwardResolved||0,
    probabilityStatus:d.probabilityCalibrationEngine?.status||'INSUFFICIENT_DATA',
    prospectiveResolved:d.performance?.confluenceForward?.resolved??null
  },
  researchOnly:true,
  automaticOrders:false
};

d.dailyDecisionBrief=brief;
write(CUR,d);write(DOC,d);

const rec={
  session,
  generatedAt:brief.generatedAt,
  headline:brief.headline,
  top3:brief.top3,
  basketTickers:currentTickers,
  basket:brief.basket,
  risks:brief.risks,
  market:brief.market
};
const filtered=(history.records||[]).filter(r=>r.session!==session);
filtered.push(rec);
while(filtered.length>90) filtered.shift();
const newHist={version:'daily-brief-history/v1',updatedAt:new Date().toISOString(),records:filtered};
write(HIST,newHist);write(DOC_HIST,newHist);

console.log(JSON.stringify(brief,null,2));
