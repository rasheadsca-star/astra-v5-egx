'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const EVID='data/prospective-evidence.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function r1(x){return Number.isFinite(x)?+x.toFixed(1):null}

const cockpit=read(IN,null);
if(!cockpit) throw new Error('decision cockpit missing');
const evidence=read(EVID,{metrics:{},counts:{}});

const forwardMetrics=evidence.metrics||{};
const forwardResolved=n(evidence.counts?.resolved)||0;
const forwardHit=n(forwardMetrics.hitRatePct);
const forwardAvg=n(forwardMetrics.avgNetReturnPct);
const forwardPf=n(forwardMetrics.profitFactor);

function riskRewardScore(x){
  const rr=n(x.rrT2);
  if(rr==null) return 40;
  if(rr>=3) return 100;
  if(rr>=2.5) return 90;
  if(rr>=2) return 80;
  if(rr>=1.5) return 60;
  if(rr>=1) return 40;
  return 15;
}
function evidenceScore(x){
  const ev=(x.evidence||[]).length;
  const warn=(x.warnings||[]).length;
  return clamp(50 + ev*7 - warn*8);
}
function forwardScore(){
  if(forwardResolved<10) return 50;
  let s=50;
  if(forwardHit!=null) s+=(forwardHit-50)*0.35;
  if(forwardAvg!=null) s+=forwardAvg*6;
  if(forwardPf!=null) s+=(forwardPf-1)*18;
  return clamp(s);
}
function riskScore(x){
  const risk=n(x.riskPct);
  if(risk==null) return 50;
  if(risk<=3) return 100;
  if(risk<=5) return 85;
  if(risk<=8) return 65;
  if(risk<=12) return 40;
  return 15;
}
function grade(score,x){
  if(x.entryQuality==='INVALIDATED'||x.stage==='REJECTED_RISK') return 'REJECT';
  if(score>=85) return 'A+';
  if(score>=75) return 'A';
  if(score>=62) return 'B';
  if(score>=50) return 'C';
  return 'REJECT';
}
function decisionLabel(g){
  if(g==='A+') return 'TOP RESEARCH SETUP';
  if(g==='A') return 'STRONG RESEARCH SETUP';
  if(g==='B') return 'WATCH / CONDITIONAL';
  if(g==='C') return 'LOW PRIORITY';
  return 'REJECT / NO ACTION';
}

const fwdScore=forwardScore();
const weights={
  technical:0.25,
  entryQuality:0.20,
  context:0.15,
  riskReward:0.15,
  riskControl:0.10,
  evidence:0.10,
  forwardEvidence:0.05
};

function scoreRow(x){
  const technical=n(x.qualityScore)??n(x.conviction)??50;
  const entry=n(x.entryQualityScore)??50;
  const context=n(x.contextScore)??50;
  const rr=riskRewardScore(x);
  const risk=riskScore(x);
  const evid=evidenceScore(x);
  let score=
    technical*weights.technical+
    entry*weights.entryQuality+
    context*weights.context+
    rr*weights.riskReward+
    risk*weights.riskControl+
    evid*weights.evidence+
    fwdScore*weights.forwardEvidence;

  if(x.entryQuality==='CHASE_RISK') score-=8;
  if(x.entryQuality==='EXTENDED') score-=3;
  if((x.warnings||[]).includes('WEAK_MARKET_CONTEXT')) score-=4;
  if((x.warnings||[]).includes('LOW_LIQUIDITY_CONTEXT')) score-=5;
  score=clamp(score);

  const g=grade(score,x);
  return {
    ...x,
    finalDecisionScore:r1(score),
    finalDecisionGrade:g,
    finalDecisionLabel:decisionLabel(g),
    finalDecisionComponents:{
      technical:r1(technical),
      entryQuality:r1(entry),
      context:r1(context),
      riskReward:r1(rr),
      riskControl:r1(risk),
      evidence:r1(evid),
      forwardEvidence:r1(fwdScore)
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
for(const x of all) gradeCounts[x.finalDecisionGrade]=(gradeCounts[x.finalDecisionGrade]||0)+1;

cockpit.finalDecisionEngine={
  version:'final-decision-score/v1',
  generatedAt:new Date().toISOString(),
  weights,
  penalties:{
    chaseRisk:-8,
    extended:-3,
    weakMarket:-4,
    lowLiquidity:-5
  },
  forwardEvidence:{
    resolved:forwardResolved,
    hitRatePct:forwardHit,
    avgNetReturnPct:forwardAvg,
    profitFactor:forwardPf,
    score:r1(fwdScore),
    maturity:forwardResolved>=10?'ACTIVE':'NEUTRAL_UNTIL_10_RESOLVED'
  },
  gradeCounts,
  note:'Final Decision Score is a transparent research ranking, not a probability of profit and not an execution instruction.',
  automaticExecution:false
};

write(IN,cockpit);write(DOC,cockpit);
console.log(JSON.stringify({
  version:cockpit.finalDecisionEngine.version,
  gradeCounts,
  top:(cockpit.topOpportunities||[]).slice(0,10).map(x=>({ticker:x.ticker,score:x.finalDecisionScore,grade:x.finalDecisionGrade,quality:x.entryQuality,context:x.contextScore,rr:x.rrT2}))
},null,2));
