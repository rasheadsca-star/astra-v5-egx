'use strict';

const fs=require('fs'), path=require('path');
const OUT='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';

function read(p){return JSON.parse(fs.readFileSync(p,'utf8'))}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function uniq(a){return [...new Set(a)]}
function mid(a,b){return Number.isFinite(Number(a))&&Number.isFinite(Number(b))?(Number(a)+Number(b))/2:null}
function rr(entry,stop,target){
  entry=Number(entry);stop=Number(stop);target=Number(target);
  const risk=entry-stop;
  return risk>0&&target>entry?+((target-entry)/risk).toFixed(2):null
}
function normState(s=''){return String(s).toUpperCase()}
function add(map,ticker,patch){
  if(!ticker)return;
  const cur=map.get(ticker)||{
    ticker,
    engines:{},
    families:[],
    evidence:[],
    warnings:[],
    entryLow:null,entryHigh:null,stop:null,target1:null,target2:null,
    rawScores:[],states:[],close:null,liquidity:null
  };
  Object.assign(cur,patch);
  map.set(ticker,cur);
}
function setLevels(x,row,priority=0){
  x._levelPriority=x._levelPriority||-1;
  if(priority<x._levelPriority)return;
  const lo=Number(row.entryLow), hi=Number(row.entryHigh), st=Number(row.stop), t1=Number(row.target1), t2=Number(row.target2);
  if(Number.isFinite(lo))x.entryLow=lo;
  if(Number.isFinite(hi))x.entryHigh=hi;
  if(Number.isFinite(st))x.stop=st;
  if(Number.isFinite(t1))x.target1=t1;
  if(Number.isFinite(t2))x.target2=t2;
  x._levelPriority=priority;
}
function regimeAdjustment(regime){
  if(regime==='صاعد')return 5;
  if(regime==='متذبذب')return -2;
  if(regime==='هابط')return -8;
  return 0;
}
function stageFor(x){
  if(x.engines.confluenceV2?.state==='ENTRY_READY')return 'ENTRY_READY';
  if(x.engines.confluenceV2?.state==='ENTRY_READY_SECONDARY')return 'ENTRY_READY_SECONDARY';
  const c2=normState(x.engines.confluenceV2?.state);
  if(c2.includes('WAITING_FOR_TRIGGER'))return 'WAITING_FOR_TRIGGER';
  if(c2.includes('RISK_REJECTED'))return 'REJECTED_RISK';
  if(c2.includes('FUNDAMENTALS_PENDING'))return 'NEAR_ENTRY';
  if(c2.includes('WAITING_FOR_HOURLY'))return 'NEAR_ENTRY';
  if(x.engines.v4)return 'WAITING_FOR_ENTRY';
  if(x.engines.quant||x.engines.claude||x.engines.confluenceV1)return 'WATCHLIST';
  return 'REJECTED';
}

const cmp=read('docs/data/engine-comparison.json');
const sig=read('docs/data/signals.json');
const cf1=read('docs/data/confluence-signals.json');
const cf2=read('docs/data/confluence-v2-signals.json');
const ledger=fs.existsSync('data/confluence-v2/forward-ledger.json')?read('data/confluence-v2/forward-ledger.json'):{records:[],metrics:{}};

const recMap=new Map((sig.recommendations||[]).map(x=>[x.ticker,x]));
const map=new Map();

for(const row of cmp.engines?.v2?.rows||[]){
  const x=map.get(row.ticker)||{ticker:row.ticker,engines:{},families:[],evidence:[],warnings:[],rawScores:[],states:[],close:null,liquidity:null};
  x.engines.quant={source:'V2.1/V5_FAMILY',v2:true,v5:false,score:row.score,state:row.state,rank:row.rank};
  x.families.push('NEXT_QUANT');
  x.rawScores.push(Number(row.score)||0);
  x.states.push(row.state);
  setLevels(x,row,1);
  map.set(row.ticker,x);
}
for(const row of cmp.engines?.v5?.rows||[]){
  const x=map.get(row.ticker)||{ticker:row.ticker,engines:{},families:[],evidence:[],warnings:[],rawScores:[],states:[],close:null,liquidity:null};
  x.engines.quant=x.engines.quant||{source:'V2.1/V5_FAMILY',v2:false,v5:false,score:null,state:row.state,rank:row.rank};
  x.engines.quant.v5=true;
  x.families.push('NEXT_QUANT');
  if(Number.isFinite(Number(row.score)))x.rawScores.push(Number(row.score));
  setLevels(x,row,1);
  map.set(row.ticker,x);
}
const seenV4=new Set();
for(const row of cmp.engines?.v4?.rows||[]){
  if(seenV4.has(row.ticker))continue; seenV4.add(row.ticker);
  const x=map.get(row.ticker)||{ticker:row.ticker,engines:{},families:[],evidence:[],warnings:[],rawScores:[],states:[],close:null,liquidity:null};
  x.engines.v4={rank:row.rank,state:row.state};
  x.families.push('V4');
  x.rawScores.push(55);
  x.states.push(row.state);
  setLevels(x,row,2);
  map.set(row.ticker,x);
}
for(const row of cmp.engines?.claude?.rows||[]){
  const x=map.get(row.ticker)||{ticker:row.ticker,engines:{},families:[],evidence:[],warnings:[],rawScores:[],states:[],close:null,liquidity:null};
  x.engines.claude={rank:row.rank,state:row.state,score:row.score};
  x.families.push('CLAUDE');
  x.rawScores.push(Number(row.score)||60);
  x.states.push(row.state);
  setLevels(x,row,2);
  map.set(row.ticker,x);
}
for(const row of cf1.opportunityBrief||[]){
  const x=map.get(row.ticker)||{ticker:row.ticker,engines:{},families:[],evidence:[],warnings:[],rawScores:[],states:[],close:null,liquidity:null};
  x.engines.confluenceV1={rank:row.rank,state:row.state,score:row.score,missingConditions:row.missingConditions||[]};
  x.families.push('CONFLUENCE');
  x.rawScores.push(Number(row.score)||0);
  x.states.push(row.state);
  x.evidence.push(...(row.factors||[]));
  x.warnings.push(...(row.missingConditions||[]));
  setLevels(x,{entryLow:row.watchEntryLow,entryHigh:row.watchEntryHigh,stop:row.structuralStop,target1:row.targets?.t1,target2:row.targets?.t2},3);
  map.set(row.ticker,x);
}
for(const row of cf2.all||[]){
  const x=map.get(row.ticker)||{ticker:row.ticker,engines:{},families:[],evidence:[],warnings:[],rawScores:[],states:[],close:null,liquidity:null};
  x.engines.confluenceV2={
    state:row.state,score:row.score,dailyScore:row.dailyScore,
    evidenceTier:row.fundamentalEvidence?.tier||null,
    riskPct:row.risk?.riskPct??null,rrT2:row.risk?.rrT2??null,
    hourlyMa100:row.hourly?.hourlyMa100??null,missingConditions:row.missingConditions||[]
  };
  x.families.push('CONFLUENCE');
  x.rawScores.push(Number(row.score)||0);
  x.states.push(row.state);
  x.evidence.push(...(row.factors||[]));
  x.warnings.push(...(row.missingConditions||[]));
  setLevels(x,{entryLow:row.entryLow,entryHigh:row.entryHigh,stop:row.structuralStop,target1:row.targets?.t1,target2:row.targets?.t2},5);
  map.set(row.ticker,x);
}

for(const [ticker,r] of recMap){
  const x=map.get(ticker); if(!x)continue;
  x.close=Number(r.close);
  x.liquidity={tier:r.liq_tier||null,turnoverM:r.turnover_m??null,maxPositionEgp:r.max_position_egp??null};
  x.marketEvidence={groupHit:r.group_hit??null,groupHitLow90:r.group_hit_low90??null,groupAvg:r.evidence?.avg??null,groupPf:r.evidence?.pf??null,stockProbExperimental:r.stock_prob_experimental??null};
  if(r.liq_tier==='منخفضة')x.warnings.push('LOW_LIQUIDITY');
}

const regimeAdj=regimeAdjustment(sig.regime);
const rows=[];
for(const x of map.values()){
  x.families=uniq(x.families);
  x.evidence=uniq(x.evidence);
  x.warnings=uniq(x.warnings);
  const quality=Math.max(0,...x.rawScores.filter(Number.isFinite));
  const agreementCount=x.families.length;
  const consensusBonus=Math.max(0,(agreementCount-1)*6);
  let readinessBonus=0;
  const c2state=x.engines.confluenceV2?.state;
  if(c2state==='ENTRY_READY')readinessBonus=8;
  else if(c2state==='ENTRY_READY_SECONDARY')readinessBonus=5;
  else if(c2state==='WAITING_FOR_TRIGGER')readinessBonus=2;
  else if(x.engines.v4)readinessBonus=2;
  let riskPenalty=0;
  const rp=Number(x.engines.confluenceV2?.riskPct);
  const rr2=Number(x.engines.confluenceV2?.rrT2);
  if(Number.isFinite(rp)&&rp>8)riskPenalty-=8;
  if(Number.isFinite(rr2)&&rr2<2)riskPenalty-=6;
  if(x.liquidity?.tier==='منخفضة')riskPenalty-=5;
  const conviction=clamp(Math.round(quality+consensusBonus+readinessBonus+regimeAdj+riskPenalty));
  const entryMid=mid(x.entryLow,x.entryHigh);
  const riskPct=Number.isFinite(rp)?rp:(entryMid&&Number.isFinite(Number(x.stop))?+(((entryMid-Number(x.stop))/entryMid)*100).toFixed(2):null);
  const rrT2=Number.isFinite(rr2)?rr2:rr(entryMid,x.stop,x.target2);
  const stage=stageFor(x);
  rows.push({
    ticker:x.ticker,
    stage,
    conviction,
    qualityScore:+quality.toFixed(1),
    agreementCount,
    engineFamilies:x.families,
    engineAgreement:{
      quant:!!x.engines.quant,
      v4:!!x.engines.v4,
      claude:!!x.engines.claude,
      confluence:!!(x.engines.confluenceV1||x.engines.confluenceV2)
    },
    entryLow:x.entryLow,entryHigh:x.entryHigh,stop:x.stop,target1:x.target1,target2:x.target2,
    riskPct,rrT2,
    close:x.close,
    liquidity:x.liquidity,
    marketEvidence:x.marketEvidence||null,
    evidence:x.evidence,
    warnings:x.warnings,
    engines:x.engines
  });
}
const priority={ENTRY_READY:0,ENTRY_READY_SECONDARY:1,WAITING_FOR_TRIGGER:2,NEAR_ENTRY:3,WAITING_FOR_ENTRY:4,WATCHLIST:5,REJECTED_RISK:6,REJECTED:7};
rows.sort((a,b)=>(priority[a.stage]??99)-(priority[b.stage]??99)||b.conviction-a.conviction||a.ticker.localeCompare(b.ticker));
rows.forEach((x,i)=>x.rank=i+1);

const health={
  session:cmp.session,
  generatedAt:cmp.generatedAt,
  stale:sig.stale===true,
  staleLagSessions:sig.stale_lag_sessions??null,
  universe:sig.universe??null,
  symbols:sig.symbols??null,
  excludedCount:Object.keys(sig.excluded||{}).length,
  executionAllowed:false,
  v2V5Independent:cmp.independence?.v2AndV5IndependentToday===true,
  confluenceV2Evaluated:cf2.counts?.evaluated??0,
  confluenceV2EntryReady:cf2.counts?.entryReady??0,
  forwardRecords:(ledger.records||[]).length,
  forwardResolved:ledger.metrics?.resolved??0
};
const payload={
  schemaVersion:'astra-decision-cockpit/v1',
  product:'ASTRA V5.1 DECISION COCKPIT',
  generatedAt:new Date().toISOString(),
  session:cmp.session,
  safety:{researchOnly:true,executionAllowed:false,automaticOrders:false},
  market:{
    regime:sig.regime||null,
    breadthPct:sig.breadth_pct??null,
    marketR20Pct:sig.market_r20_pct??null,
    exposureScale:sig.exposure_scale??null,
    driftGuard:sig.drift_guard===true,
    regimeAdjustment:regimeAdj
  },
  methodology:{
    note:'V2.1 and V5 are treated as one NEXT_QUANT family when they are not independent. Conviction is a transparent ranking score, not a probability of profit.',
    formula:'max(source quality) + 6 per additional independent engine family + readiness bonus + market regime adjustment - risk/liquidity penalties',
    stages:['ENTRY_READY','ENTRY_READY_SECONDARY','WAITING_FOR_TRIGGER','NEAR_ENTRY','WAITING_FOR_ENTRY','WATCHLIST','REJECTED_RISK','REJECTED']
  },
  counts:{
    total:rows.length,
    entryReady:rows.filter(x=>x.stage==='ENTRY_READY').length,
    nearEntry:rows.filter(x=>['ENTRY_READY_SECONDARY','WAITING_FOR_TRIGGER','NEAR_ENTRY','WAITING_FOR_ENTRY'].includes(x.stage)).length,
    watchlist:rows.filter(x=>x.stage==='WATCHLIST').length,
    rejected:rows.filter(x=>x.stage.startsWith('REJECTED')).length
  },
  topOpportunities:rows.slice(0,20),
  entryReady:rows.filter(x=>x.stage==='ENTRY_READY'),
  nearEntry:rows.filter(x=>['ENTRY_READY_SECONDARY','WAITING_FOR_TRIGGER','NEAR_ENTRY','WAITING_FOR_ENTRY'].includes(x.stage)).slice(0,20),
  watchlist:rows.filter(x=>x.stage==='WATCHLIST').slice(0,25),
  rejected:rows.filter(x=>x.stage.startsWith('REJECTED')).slice(0,25),
  performance:{
    quantBacktest:{
      top3:sig.backtest?.top3||null,
      top5:sig.backtest?.top5||null,
      top10:sig.backtest?.top10||null,
      baseline:sig.backtest?.baseline_all||null,
      fillRatePct:sig.integrity?.fill_rate_pct??null,
      top5ExcessMeanPct:sig.integrity?.top5_excess_mean_pct??null,
      top5ExcessCi90:sig.integrity?.top5_excess_ci90_block||null
    },
    confluenceForward:ledger.metrics||{}
  },
  dataHealth:health
};
write(OUT,payload);write(DOC,payload);
console.log(JSON.stringify({session:payload.session,counts:payload.counts,market:payload.market,top:rows.slice(0,10).map(x=>({ticker:x.ticker,stage:x.stage,conviction:x.conviction,agreement:x.agreementCount,riskPct:x.riskPct,rrT2:x.rrT2}))},null,2));
