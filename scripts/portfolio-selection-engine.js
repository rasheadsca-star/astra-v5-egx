'use strict';

const fs=require('fs'),path=require('path');
const {allocateCappedWeights}=require('./lib/portfolio-allocation');
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
const maxSameSector=2;
const maxPairCorrelation=0.85;
const minFinalScore=62;
const lowLiquidityCapPct=15;
const maxSingleWeightPct=30;
const exposureScale=n(d.market?.exposureScale)??1;
const pairMatrix=d.sectorCorrelationEngine?.correlation?.pairMatrix||{};
function pairCorrelation(a,b){
  const v=pairMatrix[a+'|'+b]||pairMatrix[b+'|'+a];
  return n(v?.correlation);
}

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
const sectorCounts=new Map();
const diversificationRejected=[];

for(const x of universe){
  if(selected.length>=maxPositions) break;
  const families=(x.engineFamilies||[]).length?(x.engineFamilies||[]):['UNKNOWN'];
  const blockedFamily=families.find(f=>(familyCounts.get(f)||0)>=maxSameFamily);
  if(blockedFamily){diversificationRejected.push({ticker:x.ticker,reason:'ENGINE_FAMILY_CONCENTRATION',family:blockedFamily});continue;}
  const sector=x.sector||null;
  if(sector && (sectorCounts.get(sector)||0)>=maxSameSector){diversificationRejected.push({ticker:x.ticker,reason:'SECTOR_CONCENTRATION',sector});continue;}
  const correlatedWith=selected.find(s=>{
    const c=pairCorrelation(x.ticker,s.ticker);
    return c!=null && c>=maxPairCorrelation;
  });
  if(correlatedWith){diversificationRejected.push({ticker:x.ticker,reason:'HIGH_CORRELATION',peer:correlatedWith.ticker});continue;}
  selected.push(x);
  for(const f of families)familyCounts.set(f,(familyCounts.get(f)||0)+1);
  if(sector)sectorCounts.set(sector,(sectorCounts.get(sector)||0)+1);
}

const allocation=allocateCappedWeights(selected,{maxSingleWeightPct,lowLiquidityCapPct,lowLiquidityThreshold:40});
const provisional=selected.map((x,i)=>({...x,_weight:allocation.weights[i]||0}));

const basket=provisional.map((x,i)=>{
  const weight=r1(x._weight);
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
    sector:x.sector||null,
    sectorStrengthScore:n(x.sectorStrengthScore),
    maxOpportunityCorrelation:n(x.maxOpportunityCorrelation),
    maxOpportunityCorrelationPeer:x.maxOpportunityCorrelationPeer||null,
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
  .map(x=>{
    const dr=diversificationRejected.find(r=>r.ticker===x.ticker);
    return {
      ticker:x.ticker,
      score:x.portfolioSelectionScore,
      reason:dr?.reason||(selected.length>=maxPositions?'MAX_POSITIONS':'DIVERSIFICATION_LIMIT'),
      peer:dr?.peer||null,
      family:dr?.family||null,
      sector:dr?.sector||x.sector||null
    };
  });

d.portfolioSelectionEngine={
  version:'portfolio-selection/v1',
  generatedAt:new Date().toISOString(),
  researchOnly:true,
  executionAllowed:false,
  automaticOrders:false,
  policy:{
    maxPositions,
    maxSameEngineFamily:maxSameFamily,
    maxSameSector,
    maxPairCorrelation,
    minFinalDecisionScore:minFinalScore,
    maxSingleWeightPct,
    lowLiquidityCapPct,
    marketExposureScale:exposureScale,
    allocatedResearchPct:r1(allocation.allocatedPct),
    unallocatedResearchPct:r1(allocation.unallocatedPct),
    sectorConstraint:'CONTROLLED_MAP_MAX_2_PER_SECTOR',
    correlationConstraint:'MAX_PAIR_CORRELATION_0_85_WHEN_OBSERVED'
  },
  counts:{
    eligibleUniverse:universe.length,
    selected:basket.length
  },
  basket,
  excluded,
  note:'Research basket only. Per-name and low-liquidity caps are never exceeded; any unused allocation remains explicitly unallocated. Engine-family, sector and observed correlation controls reduce duplicate risk. Weights are research weights, not order sizes.'
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
