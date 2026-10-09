'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function r1(x){return Number.isFinite(x)?+x.toFixed(1):null}
function familyKey(x){return (x.engineFamilies||[]).slice().sort().join('+')||'UNKNOWN'}

const d=read(IN,null);
if(!d) throw new Error('decision cockpit missing');

const maxPositions=5;
const maxSameFamily=3;
const minFinalScore=62;
const lowLiquidityCapPct=15;
const maxSingleWeightPct=30;
const minSingleWeightPct=8;
const exposureScale=n(d.market?.exposureScale)??1;

function probabilityBonus(x){
  const p=n(x.targetAchievement?.t1ProbabilityPct);
  const status=x.targetAchievement?.status;
  if(p==null) return 0;
  if(status==='VALIDATED') return (p-50)*0.20;
  if(status==='CALIBRATING') return (p-50)*0.10;
  if(status==='PRELIMINARY') return (p-50)*0.05;
  return 0;
}
function basketScore(x){
  let s=n(x.finalDecisionScore)??0;
  s+=probabilityBonus(x);
  if(x.entryQuality==='IDEAL') s+=6;
  else if(x.entryQuality==='EARLY') s+=2;
  else if(x.entryQuality==='EXTENDED') s-=4;
  else if(x.entryQuality==='CHASE_RISK') s-=10;
  const liq=n(x.liquidityContextScore);
  if(liq!=null) s+=(liq-50)*0.08;
  const rr=n(x.rrT2);
  if(rr!=null) s+=Math.min(5,Math.max(-5,(rr-2)*2));
  return clamp(s);
}

const universe=[
  ...(d.topOpportunities||[]),
  ...(d.watchlist||[])
].filter(x=>
  x.decisionGate?.pass===true &&
  (n(x.finalDecisionScore)??0)>=minFinalScore &&
  x.entryQuality!=='INVALIDATED' &&
  x.entryQuality!=='CHASE_RISK'
).map(x=>({...x,portfolioSelectionScore:r1(basketScore(x))}))
 .sort((a,b)=>(b.portfolioSelectionScore??-1)-(a.portfolioSelectionScore??-1));

const selected=[];
const familyCounts=new Map();

for(const x of universe){
  if(selected.length>=maxPositions) break;
  const fk=familyKey(x);
  const count=familyCounts.get(fk)||0;
  if(count>=maxSameFamily) continue;
  selected.push(x);
  familyCounts.set(fk,count+1);
}

let rawSum=selected.reduce((s,x)=>s+Math.max(1,n(x.portfolioSelectionScore)||1),0);
let provisional=selected.map(x=>{
  let w=rawSum?100*(n(x.portfolioSelectionScore)||1)/rawSum:0;
  const low=(n(x.liquidityContextScore)??50)<40;
  if(low) w=Math.min(w,lowLiquidityCapPct);
  w=Math.min(w,maxSingleWeightPct);
  return {...x,_weight:w};
});

// Redistribute remaining weight among uncapped names, but keep total research allocation at 100% of the basket.
let sum=provisional.reduce((s,x)=>s+x._weight,0);
let loops=0;
while(sum<99.9 && loops<10 && provisional.length){
  const roomers=provisional.filter(x=>{
    const low=(n(x.liquidityContextScore)??50)<40;
    const cap=low?lowLiquidityCapPct:maxSingleWeightPct;
    return x._weight<cap-0.01;
  });
  if(!roomers.length) break;
  const add=(100-sum)/roomers.length;
  provisional=provisional.map(x=>{
    const low=(n(x.liquidityContextScore)??50)<40;
    const cap=low?lowLiquidityCapPct:maxSingleWeightPct;
    return roomers.includes(x)?{...x,_weight:Math.min(cap,x._weight+add)}:x;
  });
  sum=provisional.reduce((s,x)=>s+x._weight,0);
  loops++;
}

const basket=provisional.map((x,i)=>{
  const weight=selected.length===1?100:r1(x._weight);
  return {
    rank:i+1,
    ticker:x.ticker,
    grade:x.finalDecisionGrade,
    finalDecisionScore:n(x.finalDecisionScore),
    portfolioSelectionScore:n(x.portfolioSelectionScore),
    entryQuality:x.entryQuality,
    rrT2:n(x.rrT2),
    contextScore:n(x.contextScore),
    liquidityScore:n(x.liquidityContextScore),
    t1ProbabilityPct:n(x.targetAchievement?.t1ProbabilityPct),
    t2ProbabilityPct:n(x.targetAchievement?.t2ProbabilityPct),
    probabilityStatus:x.targetAchievement?.status||'INSUFFICIENT_DATA',
    researchWeightPct:weight,
    effectiveExposurePct:r1(weight*exposureScale),
    engineFamilies:x.engineFamilies||[],
    entryLow:n(x.entryLow),
    entryHigh:n(x.entryHigh),
    stop:n(x.stop),
    target1:n(x.target1),
    target2:n(x.target2)
  };
});

const excluded=universe
  .filter(x=>!basket.some(b=>b.ticker===x.ticker))
  .slice(0,20)
  .map(x=>({
    ticker:x.ticker,
    score:x.portfolioSelectionScore,
    reason:selected.length>=maxPositions?'MAX_POSITIONS_OR_DIVERSIFICATION_LIMIT':'DIVERSIFICATION_LIMIT'
  }));

d.portfolioSelectionEngine={
  version:'portfolio-selection/v1',
  generatedAt:new Date().toISOString(),
  researchOnly:true,
  executionAllowed:false,
  automaticOrders:false,
  policy:{
    maxPositions,
    maxSameEngineFamilySignature:maxSameFamily,
    minFinalDecisionScore:minFinalScore,
    maxSingleWeightPct,
    lowLiquidityCapPct,
    minSingleWeightPct,
    marketExposureScale:exposureScale,
    sectorConstraint:'DISABLED_UNTIL_VERIFIED_SECTOR_TAXONOMY'
  },
  counts:{
    eligibleUniverse:universe.length,
    selected:basket.length
  },
  basket,
  excluded,
  note:'Research basket only. Weights are relative research weights, not order sizes. Sector diversification is intentionally disabled until verified sector metadata exists.'
};

const basketTickers=new Set(basket.map(x=>x.ticker));
for(const group of ['topOpportunities','watchlist','rejected']){
  d[group]=(d[group]||[]).map(x=>({
    ...x,
    portfolioSelected:basketTickers.has(x.ticker),
    portfolioRank:basket.find(b=>b.ticker===x.ticker)?.rank??null,
    portfolioResearchWeightPct:basket.find(b=>b.ticker===x.ticker)?.researchWeightPct??null
  }));
}

write(IN,d);write(DOC,d);
console.log(JSON.stringify(d.portfolioSelectionEngine,null,2));
