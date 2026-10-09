'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const HISTORY='data/history-index.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(x,a,b){return Math.max(a,Math.min(b,x))}
function r(x,d=2){return Number.isFinite(x)?+x.toFixed(d):null}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function std(a){const x=a.filter(Number.isFinite);if(x.length<2)return null;const m=mean(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)*(v-m),0)/(x.length-1))}

const d=read(IN,null), h=read(HISTORY,null);
if(!d||!h)throw new Error('V5.13 inputs missing');

const basket=d.portfolioSelectionEngine?.basket||[];
const exposureScale=clamp(n(d.market?.exposureScale)??1,0.25,1);
const referenceCapital=100000;
const baseRiskPct=1.0;
const maxRiskPerPositionPct=1.0;
const minRiskPerPositionPct=0.20;
const maxPortfolioRiskPct=r(3.0*exposureScale,2);

function volatilityDailyPct(ticker){
  const sessions=h.symbols?.[ticker]?.sessions||[];
  const rows=sessions.slice(-21);
  const rets=[];
  for(let i=1;i<rows.length;i++){
    const p=n(rows[i-1]?.close), c=n(rows[i]?.close);
    if(p&&c)rets.push((c/p-1)*100);
  }
  return std(rets);
}
function scoreFactor(score){
  score=n(score)??62;
  return clamp(0.70+(score-62)/38*0.35,0.70,1.05);
}
function volFactor(v){
  if(v==null)return 0.85;
  if(v<=1.5)return 1.00;
  if(v<=2.5)return 0.90;
  if(v<=4.0)return 0.75;
  return 0.60;
}
function liquidityFactor(v){
  v=n(v);
  if(v==null)return 0.85;
  if(v>=70)return 1.00;
  if(v>=50)return 0.90;
  if(v>=40)return 0.75;
  return 0.60;
}
function correlationFactor(v){
  v=n(v);
  if(v==null)return 0.90;
  if(v>=0.80)return 0.70;
  if(v>=0.65)return 0.85;
  return 1.00;
}
function sectorFactor(v){
  v=n(v);
  if(v==null)return 0.90;
  if(v>=65)return 1.05;
  if(v>=45)return 1.00;
  if(v>=35)return 0.85;
  return 0.75;
}
function probabilityFactor(status,p){
  p=n(p);
  if(p==null)return 1.0;
  if(status==='VALIDATED')return clamp(0.85+(p/100)*0.30,0.90,1.15);
  if(status==='CALIBRATING')return clamp(0.90+(p/100)*0.18,0.95,1.08);
  if(status==='PRELIMINARY')return clamp(0.95+(p/100)*0.08,0.97,1.04);
  return 1.0;
}

let plans=basket.map(x=>{
  const entryLow=n(x.entryLow), entryHigh=n(x.entryHigh), stop=n(x.stop);
  const entry=entryHigh??entryLow;
  const stopDistance=entry!=null&&stop!=null?entry-stop:null;
  const stopPct=entry&&stopDistance>0?100*stopDistance/entry:null;
  const vol=volatilityDailyPct(x.ticker);
  const factors={
    market:r(exposureScale,3),
    score:r(scoreFactor(x.finalDecisionScore),3),
    volatility:r(volFactor(vol),3),
    liquidity:r(liquidityFactor(x.liquidityScore),3),
    correlation:r(correlationFactor(x.maxOpportunityCorrelation),3),
    sector:r(sectorFactor(x.sectorStrengthScore),3),
    probability:r(probabilityFactor(x.probabilityStatus,x.t1ProbabilityPct),3)
  };
  const raw=baseRiskPct*Object.values(factors).reduce((a,b)=>a*b,1);
  const riskPct=entry&&stopDistance>0?clamp(raw,minRiskPerPositionPct,maxRiskPerPositionPct):0;
  const maxPositionPct=clamp(n(x.effectiveExposurePct)??0,0,30);
  const riskAmountRef=referenceCapital*riskPct/100;
  const sharesByRisk=stopDistance>0?Math.floor(riskAmountRef/stopDistance):0;
  const sharesByExposure=entry>0?Math.floor(referenceCapital*maxPositionPct/100/entry):0;
  const sharesRef=Math.max(0,Math.min(sharesByRisk,sharesByExposure||sharesByRisk));
  const positionValueRef=sharesRef*entry;
  const actualRiskRef=sharesRef*Math.max(0,stopDistance||0);
  return {
    ticker:x.ticker,
    rank:x.rank,
    sector:x.sector||null,
    entryReference:r(entry,4),
    entryLow:r(entryLow,4),
    entryHigh:r(entryHigh,4),
    stop:r(stop,4),
    stopDistance:r(stopDistance,4),
    stopDistancePct:r(stopPct,2),
    dailyVolatilityPct:r(vol,2),
    finalDecisionScore:n(x.finalDecisionScore),
    rrT2:n(x.rrT2),
    researchWeightPct:n(x.researchWeightPct),
    effectiveExposurePct:n(x.effectiveExposurePct),
    maxPositionPct:r(maxPositionPct,2),
    riskBudgetPct:r(riskPct,3),
    referenceCapital,
    referenceShares:sharesRef,
    referencePositionValue:r(positionValueRef,2),
    referenceMaxLossAtStop:r(actualRiskRef,2),
    factors,
    status:entry&&stopDistance>0?'SIZED':'INVALID_ENTRY_STOP'
  };
});

const totalRaw=plans.reduce((s,x)=>s+n(x.riskBudgetPct)||s,0);
const totalRisk=plans.reduce((s,x)=>s+(n(x.riskBudgetPct)||0),0);
if(totalRisk>maxPortfolioRiskPct && totalRisk>0){
  const scale=maxPortfolioRiskPct/totalRisk;
  plans=plans.map(x=>{
    const rp=(n(x.riskBudgetPct)||0)*scale;
    const entry=n(x.entryReference), sd=n(x.stopDistance), cap=n(x.maxPositionPct)||0;
    const riskAmount=referenceCapital*rp/100;
    const byRisk=sd>0?Math.floor(riskAmount/sd):0;
    const byExposure=entry>0?Math.floor(referenceCapital*cap/100/entry):0;
    const shares=Math.max(0,Math.min(byRisk,byExposure||byRisk));
    return {...x,
      riskBudgetPct:r(rp,3),
      referenceShares:shares,
      referencePositionValue:r(shares*entry,2),
      referenceMaxLossAtStop:r(shares*sd,2),
      portfolioRiskScaled:true
    };
  });
}

const totalBudgetPct=r(plans.reduce((s,x)=>s+(n(x.riskBudgetPct)||0),0),3);
const totalRefLoss=r(plans.reduce((s,x)=>s+(n(x.referenceMaxLossAtStop)||0),0),2);
const totalRefValue=r(plans.reduce((s,x)=>s+(n(x.referencePositionValue)||0),0),2);

d.riskBudgetEngine={
  version:'risk-budget/v1',
  generatedAt:new Date().toISOString(),
  referenceCapital,
  currency:'EGP',
  policy:{
    baseRiskPerTradePct:baseRiskPct,
    maxRiskPerPositionPct,
    minRiskPerPositionPct,
    maxPortfolioRiskPct,
    marketExposureScale:exposureScale,
    sizingEntry:'ENTRY_HIGH_OR_ENTRY_LOW',
    shareRounding:'FLOOR',
    automaticExecution:false
  },
  totals:{
    positions:plans.filter(x=>x.status==='SIZED').length,
    riskBudgetPct:totalBudgetPct,
    referencePortfolioValue:totalRefValue,
    referenceMaxLossAtStops:totalRefLoss
  },
  positions:plans,
  note:'Research-only risk sizing. Position size is the lower of stop-risk sizing and portfolio exposure cap. It scales linearly with user capital; no orders are created.'
};

const pmap=new Map(plans.map(x=>[x.ticker,x]));
for(const group of ['topOpportunities','watchlist','rejected']){
  d[group]=(d[group]||[]).map(x=>{
    const p=pmap.get(x.ticker);
    return {...x,
      riskBudgetPct:p?.riskBudgetPct??null,
      riskSizingStatus:p?.status??null,
      referenceShares100k:p?.referenceShares??null,
      referencePositionValue100k:p?.referencePositionValue??null,
      referenceMaxLoss100k:p?.referenceMaxLossAtStop??null
    };
  });
}

write(IN,d);write(DOC,d);
console.log(JSON.stringify(d.riskBudgetEngine,null,2));
