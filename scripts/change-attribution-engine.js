'use strict';

const fs=require('fs'),path=require('path');
const CUR='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const HIST='data/daily-decision-brief-history.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function r1(x){return Number.isFinite(x)?+x.toFixed(1):null}
function changed(a,b,tol=0.05){return a!=null&&b!=null&&Math.abs(a-b)>=tol}
function delta(cur,prev){return cur!=null&&prev!=null?r1(cur-prev):null}

const d=read(CUR,null);
if(!d)throw new Error('decision cockpit missing');
const h=read(HIST,{records:[]});
const session=d.session||null;
const prior=[...(h.records||[])].reverse().find(r=>r.session&&r.session!==session)||null;
const priorMap=new Map((prior?.opportunitySnapshots||[]).map(x=>[x.ticker,x]));

function explain(cur,prev){
  if(!prev)return [{factor:'NEW_SETUP',direction:'NEW',impact:null}];
  const parts=[];
  const metrics=[
    ['FINAL_SCORE',n(cur.finalDecisionScore),n(prev.finalDecisionScore),1],
    ['ENTRY_QUALITY_SCORE',n(cur.entryQualityScore),n(prev.entryQualityScore),1],
    ['CONTEXT_SCORE',n(cur.contextScore),n(prev.contextScore),1],
    ['RR_T2',n(cur.rrT2),n(prev.rrT2),0.05],
    ['LIQUIDITY_SCORE',n(cur.liquidityContextScore),n(prev.liquidityContextScore),1],
    ['CURRENT_PRICE',n(cur.currentPrice),n(prev.currentPrice),0.001]
  ];
  for(const [factor,c,p,tol] of metrics){
    if(changed(c,p,tol))parts.push({factor,direction:c>p?'IMPROVED':'WEAKENED',current:c,previous:p,delta:delta(c,p)});
  }
  if((cur.entryQuality||null)!==(prev.entryQuality||null)){
    parts.push({factor:'ENTRY_QUALITY_STATE',direction:'CHANGED',current:cur.entryQuality||null,previous:prev.entryQuality||null});
  }
  const gateNow=cur.decisionGate?.pass===true;
  const gatePrev=prev.gatePass===true;
  if(gateNow!==gatePrev){
    parts.push({factor:'DECISION_GATE',direction:gateNow?'IMPROVED':'WEAKENED',current:gateNow?'PASSED':'BLOCKED',previous:gatePrev?'PASSED':'BLOCKED'});
  }
  const reasonsNow=cur.decisionGate?.reasons||[];
  const reasonsPrev=prev.gateReasons||[];
  const added=reasonsNow.filter(x=>!reasonsPrev.includes(x));
  const removed=reasonsPrev.filter(x=>!reasonsNow.includes(x));
  if(added.length)parts.push({factor:'NEW_GATE_BLOCKERS',direction:'WEAKENED',items:added});
  if(removed.length)parts.push({factor:'REMOVED_GATE_BLOCKERS',direction:'IMPROVED',items:removed});
  return parts.length?parts:[{factor:'NO_MATERIAL_CHANGE',direction:'FLAT',impact:0}];
}

const current=[...(d.topOpportunities||[]),...(d.watchlist||[])];
const rows=current.map(cur=>{
  const prev=priorMap.get(cur.ticker)||null;
  const reasons=explain(cur,prev);
  const scoreDelta=delta(n(cur.finalDecisionScore),n(prev?.finalDecisionScore));
  let status='UNCHANGED';
  if(!prev)status='NEW';
  else if((cur.portfolioSelected===true)!==(prev.portfolioSelected===true))status=cur.portfolioSelected?'ENTERED_BASKET':'EXITED_BASKET';
  else if(scoreDelta!=null&&scoreDelta>=3)status='IMPROVED';
  else if(scoreDelta!=null&&scoreDelta<=-3)status='WEAKENED';
  return {
    ticker:cur.ticker,
    status,
    score:n(cur.finalDecisionScore),
    previousScore:n(prev?.finalDecisionScore),
    scoreDelta,
    portfolioSelected:cur.portfolioSelected===true,
    previousPortfolioSelected:prev?.portfolioSelected===true,
    gatePass:cur.decisionGate?.pass===true,
    entryQuality:cur.entryQuality||null,
    reasons
  };
}).sort((a,b)=>Math.abs(n(b.scoreDelta)||0)-Math.abs(n(a.scoreDelta)||0));

const priorTickers=new Set((prior?.opportunitySnapshots||[]).map(x=>x.ticker));
const currentTickers=new Set(current.map(x=>x.ticker));
const disappeared=[...priorTickers].filter(x=>!currentTickers.has(x)).map(ticker=>({
  ticker,status:'DROPPED_FROM_ACTIVE_LIST',score:null,previousScore:n(priorMap.get(ticker)?.finalDecisionScore),
  scoreDelta:null,portfolioSelected:false,previousPortfolioSelected:priorMap.get(ticker)?.portfolioSelected===true,
  gatePass:false,entryQuality:null,reasons:[{factor:'DROPPED_FROM_ACTIVE_LIST',direction:'WEAKENED'}]
}));

const engine={
  version:'change-attribution/v1',
  generatedAt:new Date().toISOString(),
  session,
  priorSession:prior?.session||null,
  status:prior?'COMPARED':'NO_PRIOR_PERSISTED_SESSION',
  rows:[...rows,...disappeared],
  highlights:{
    enteredBasket:[...rows,...disappeared].filter(x=>x.status==='ENTERED_BASKET').map(x=>x.ticker),
    exitedBasket:[...rows,...disappeared].filter(x=>x.status==='EXITED_BASKET').map(x=>x.ticker),
    biggestImprovers:rows.filter(x=>(n(x.scoreDelta)||0)>0).slice(0,5).map(x=>({ticker:x.ticker,delta:x.scoreDelta})),
    biggestWeakening:rows.filter(x=>(n(x.scoreDelta)||0)<0).slice().sort((a,b)=>(a.scoreDelta||0)-(b.scoreDelta||0)).slice(0,5).map(x=>({ticker:x.ticker,delta:x.scoreDelta}))
  },
  note:prior?'Attribution compares persisted prior-session factor snapshots; it explains observed ranking changes, not causal market effects.':'No prior persisted V5.11 snapshot exists yet; attribution will activate after the next committed market session.',
  automaticExecution:false
};

d.changeAttributionEngine=engine;
write(CUR,d);write(DOC,d);
console.log(JSON.stringify(engine,null,2));
