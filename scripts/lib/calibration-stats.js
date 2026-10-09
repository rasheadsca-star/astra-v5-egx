'use strict';

const crypto=require('crypto');

const MATURITY_THRESHOLDS={
  preliminary:{resolved:30,sessions:10},
  calibrating:{resolved:60,sessions:20},
  mature:{resolved:90,sessions:30},
  bucket:{resolved:30,sessions:10},
  scoring:{resolved:30,sessions:10}
};

function n(v){
  if(v===null||v===undefined||v==='')return null;
  const x=Number(v);
  return Number.isFinite(x)?x:null;
}
function r(v,d=2){return Number.isFinite(v)?+v.toFixed(d):null}
function distinctSessions(records){return new Set((records||[]).map(x=>String(x.session||'')).filter(Boolean)).size}
function maturity(records){
  const resolved=(records||[]).length, sessions=distinctSessions(records);
  if(resolved<MATURITY_THRESHOLDS.preliminary.resolved||sessions<MATURITY_THRESHOLDS.preliminary.sessions)return 'INSUFFICIENT_EVIDENCE';
  if(resolved<MATURITY_THRESHOLDS.calibrating.resolved||sessions<MATURITY_THRESHOLDS.calibrating.sessions)return 'PRELIMINARY';
  if(resolved<MATURITY_THRESHOLDS.mature.resolved||sessions<MATURITY_THRESHOLDS.mature.sessions)return 'CALIBRATING';
  return 'MATURE_SAMPLE';
}
function bucketGrade(g){return ['A+','A','B','C','REJECT'].includes(g)?g:'UNKNOWN'}
function bucketEntry(q){return ['IDEAL','EARLY','EXTENDED','CHASE_RISK','INVALIDATED'].includes(q)?q:'UNKNOWN'}
function bucketRR(rr){
  rr=n(rr);if(rr==null)return 'UNKNOWN';
  if(rr>=3)return 'RR_3_PLUS';
  if(rr>=2)return 'RR_2_3';
  if(rr>=1.5)return 'RR_1_5_2';
  return 'RR_LT_1_5';
}
function bucketContext(v){
  v=n(v);if(v==null)return 'UNKNOWN';
  if(v>=70)return 'CTX_STRONG';
  if(v>=50)return 'CTX_NEUTRAL';
  return 'CTX_WEAK';
}
function hierarchyKeys(x){
  const g=bucketGrade(x.finalDecisionGrade),e=bucketEntry(x.entryQuality),rr=bucketRR(x.rrT2),c=bucketContext(x.contextScore);
  return [
    {level:'L4_EXACT',key:[g,e,rr,c].join('|')},
    {level:'L3_GRADE_ENTRY_RR',key:[g,e,rr].join('|')},
    {level:'L2_GRADE_ENTRY',key:[g,e].join('|')},
    {level:'L1_GRADE',key:g},
    {level:'L0_OVERALL',key:'ALL'}
  ];
}
function keyForLevel(r,level){
  const keys=hierarchyKeys(r);
  return keys.find(x=>x.level===level)?.key||'ALL';
}
function buildHierarchy(records){
  const levels=['L4_EXACT','L3_GRADE_ENTRY_RR','L2_GRADE_ENTRY','L1_GRADE','L0_OVERALL'];
  const maps=Object.fromEntries(levels.map(l=>[l,new Map()]));
  for(const r0 of records||[]){
    for(const level of levels){
      const key=level==='L0_OVERALL'?'ALL':keyForLevel(r0,level);
      if(!maps[level].has(key))maps[level].set(key,[]);
      maps[level].get(key).push(r0);
    }
  }
  return maps;
}
function selectHierarchicalPool(target,records,requirements=MATURITY_THRESHOLDS.bucket){
  const maps=buildHierarchy(records);
  for(const {level,key} of hierarchyKeys(target)){
    const rows=maps[level].get(key)||[];
    if(rows.length>=requirements.resolved&&distinctSessions(rows)>=requirements.sessions){
      return {level,key,records:rows,fallback:level!=='L4_EXACT'};
    }
  }
  return {level:'L0_OVERALL',key:'ALL',records:maps.L0_OVERALL.get('ALL')||[],fallback:true};
}
function outcomeValue(r0,target){
  const o=r0?.outcome||{},result=String(o.result||'');
  if(target==='t1')return (o.t1HitAt||result==='TARGET2')?1:0;
  if(target==='t2')return (o.t2HitAt||result==='TARGET2')?1:0;
  if(target==='stop')return result==='STOP'?1:0;
  throw new Error('UNKNOWN_CALIBRATION_TARGET '+target);
}
function empirical(records,target){
  const rows=records||[];
  if(!rows.length)return null;
  return 100*rows.reduce((s,x)=>s+outcomeValue(x,target),0)/rows.length;
}
function avgReturn(records){
  const xs=(records||[]).map(x=>n(x.outcome?.netReturnPct)).filter(Number.isFinite);
  return xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
}
function seedFrom(text){
  const h=crypto.createHash('sha256').update(String(text)).digest();
  return h.readUInt32LE(0)>>>0;
}
function rng(seed){
  let x=seed>>>0;
  return ()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296};
}
function percentile(xs,p){
  const a=xs.filter(Number.isFinite).slice().sort((a,b)=>a-b);
  if(!a.length)return null;
  const pos=(a.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);
  if(lo===hi)return a[lo];
  return a[lo]+(a[hi]-a[lo])*(pos-lo);
}
function blockBootstrap(records,metric,{reps=500,seed='ASTRA'}={}){
  const groups=new Map();
  for(const rec of records||[]){
    const s=String(rec.session||'');
    if(!s)continue;
    if(!groups.has(s))groups.set(s,[]);
    groups.get(s).push(rec);
  }
  const sessions=[...groups.keys()].sort();
  if(sessions.length<2)return {method:'SESSION_BLOCK_BOOTSTRAP',reps:0,sessions:sessions.length,ci90:[null,null]};
  const random=rng(seedFrom(seed)),vals=[];
  for(let k=0;k<reps;k++){
    const sample=[];
    for(let i=0;i<sessions.length;i++){
      const chosen=sessions[Math.floor(random()*sessions.length)];
      sample.push(...groups.get(chosen));
    }
    const v=metric(sample);
    if(Number.isFinite(v))vals.push(v);
  }
  return {
    method:'SESSION_BLOCK_BOOTSTRAP',
    reps:vals.length,
    sessions:sessions.length,
    ci90:[r(percentile(vals,0.05),2),r(percentile(vals,0.95),2)]
  };
}
function aggregate(records,seedKey='ALL'){
  const rows=records||[];
  const net=avgReturn(rows);
  return {
    n:rows.length,
    distinctSessions:distinctSessions(rows),
    maturity:maturity(rows),
    t1EstimatePct:r(empirical(rows,'t1'),1),
    t2EstimatePct:r(empirical(rows,'t2'),1),
    stopEstimatePct:r(empirical(rows,'stop'),1),
    avgNetReturnPct:r(net,2),
    intervals:{
      t1:blockBootstrap(rows,x=>empirical(x,'t1'),{seed:seedKey+'|T1'}).ci90,
      t2:blockBootstrap(rows,x=>empirical(x,'t2'),{seed:seedKey+'|T2'}).ci90,
      stop:blockBootstrap(rows,x=>empirical(x,'stop'),{seed:seedKey+'|STOP'}).ci90,
      avgNetReturn:blockBootstrap(rows,avgReturn,{seed:seedKey+'|RET'}).ci90
    },
    intervalMethod:'90% session-block bootstrap'
  };
}
function scoreCalibration(records,probField,target){
  const rows=(records||[]).filter(r0=>
    r0.probabilityStatusAtCapture==='VALIDATED' &&
    n(r0[probField])!=null
  );
  const sessions=distinctSessions(rows);
  if(rows.length<MATURITY_THRESHOLDS.scoring.resolved||sessions<MATURITY_THRESHOLDS.scoring.sessions){
    return {status:'INSUFFICIENT_SCORED_PREDICTIONS',n:rows.length,distinctSessions:sessions,brier:null,ece:null,bins:[]};
  }
  let brier=0;
  const bins=Array.from({length:5},(_,i)=>({low:i*.2,high:(i+1)*.2,n:0,pSum:0,ySum:0}));
  for(const row of rows){
    const p=Math.max(0,Math.min(1,n(row[probField])/100)),y=outcomeValue(row,target);
    brier+=(p-y)*(p-y);
    const idx=Math.min(4,Math.floor(p*5));
    bins[idx].n++;bins[idx].pSum+=p;bins[idx].ySum+=y;
  }
  let ece=0;
  const out=bins.map(b=>{
    const predicted=b.n?b.pSum/b.n:null,observed=b.n?b.ySum/b.n:null;
    if(b.n)ece+=(b.n/rows.length)*Math.abs(predicted-observed);
    return {
      range:[r(100*b.low,0),r(100*b.high,0)],
      n:b.n,
      predictedPct:predicted==null?null:r(predicted*100,1),
      observedPct:observed==null?null:r(observed*100,1)
    };
  });
  return {status:'AVAILABLE',n:rows.length,distinctSessions:sessions,brier:r(brier/rows.length,4),ece:r(ece,4),bins:out};
}
module.exports={
  MATURITY_THRESHOLDS,n,r,distinctSessions,maturity,bucketGrade,bucketEntry,bucketRR,bucketContext,
  hierarchyKeys,buildHierarchy,selectHierarchicalPool,outcomeValue,empirical,avgReturn,blockBootstrap,aggregate,scoreCalibration
};
