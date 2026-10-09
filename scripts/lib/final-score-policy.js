'use strict';

function n(v){
  if(v===null||v===undefined||v==='')return null;
  const x=Number(v);return Number.isFinite(x)?x:null;
}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function r(v,d=1){return Number.isFinite(v)?+v.toFixed(d):null}

const BASE_WEIGHTS={
  technical:0.25,
  entryQuality:0.20,
  context:0.15,
  riskReward:0.15,
  riskControl:0.10,
  evidence:0.10
};
const CRITICAL=['technical','entryQuality','riskReward','riskControl'];

function weightedAvailable(components,weights=BASE_WEIGHTS){
  let num=0,den=0,configured=0,availableConfigured=0;
  const used={},missing=[];
  for(const [k,w0] of Object.entries(weights)){
    const w=n(w0)||0;configured+=w;
    const v=n(components[k]);
    if(v==null){missing.push(k);continue}
    num+=v*w;den+=w;availableConfigured+=w;used[k]={value:r(v,1),configuredWeight:r(w,4)};
  }
  const score=den>0?num/den:null;
  const coverage=configured>0?availableConfigured/configured:0;
  return {score,coveragePct:r(coverage*100,1),used,missing,totalAvailableWeight:r(den,4)};
}

function capForMissing(score,missing){
  if(score==null)return {score:null,cap:null,reasons:['NO_SCORABLE_COMPONENTS']};
  let cap=100;const reasons=[];
  if(missing.includes('technical')){cap=Math.min(cap,49);reasons.push('TECHNICAL_COMPONENT_MISSING')}
  if(missing.some(x=>['entryQuality','riskReward','riskControl'].includes(x))){
    cap=Math.min(cap,61.9);reasons.push('CRITICAL_DECISION_COMPONENT_MISSING');
  }
  if(missing.includes('context')){cap=Math.min(cap,74.9);reasons.push('CONTEXT_COMPONENT_MISSING')}
  return {score:Math.min(score,cap),cap:cap<100?cap:null,reasons};
}

function applyPenalties(score,row){
  if(score==null)return {score:null,totalPenalty:0,items:[]};
  let total=0;const items=[];
  function add(id,value){total+=value;items.push({id,value})}
  if(row.entryQuality==='CHASE_RISK')add('CHASE_RISK',-8);
  if(row.entryQuality==='EXTENDED')add('EXTENDED',-3);
  if((row.warnings||[]).includes('WEAK_MARKET_CONTEXT'))add('WEAK_MARKET_CONTEXT',-4);
  if((row.warnings||[]).includes('LOW_LIQUIDITY_CONTEXT'))add('LOW_LIQUIDITY_CONTEXT',-5);
  return {score:clamp(score+total),totalPenalty:total,items};
}

function grade(score,row){
  if(row.entryQuality==='INVALIDATED'||row.stage==='REJECTED_RISK')return 'REJECT';
  if(score==null)return 'REJECT';
  if(score>=85)return 'A+';
  if(score>=75)return 'A';
  if(score>=62)return 'B';
  if(score>=50)return 'C';
  return 'REJECT';
}
function label(g){
  if(g==='A+')return 'TOP RESEARCH SETUP';
  if(g==='A')return 'STRONG RESEARCH SETUP';
  if(g==='B')return 'WATCH / CONDITIONAL';
  if(g==='C')return 'LOW PRIORITY';
  return 'REJECT / NO ACTION';
}
function scoreWithWeights(components,row,weights){
  const wa=weightedAvailable(components,weights);
  const capped=capForMissing(wa.score,wa.missing);
  const penalized=applyPenalties(capped.score,row);
  return {raw:wa.score,coveragePct:wa.coveragePct,missing:wa.missing,cap:capped.cap,capReasons:capped.reasons,score:penalized.score,penalties:penalized.items};
}
function sensitivity(components,row,weights=BASE_WEIGHTS){
  const base=scoreWithWeights(components,row,weights);
  if(base.score==null)return {status:'UNSCORABLE',base:null,min:null,max:null,maxAbsDelta:null,cases:[]};
  const cases=[];
  for(const key of Object.keys(weights)){
    if(n(components[key])==null)continue;
    for(const factor of [0.8,1.2]){
      const w={...weights,[key]:weights[key]*factor};
      const s=scoreWithWeights(components,row,w);
      cases.push({component:key,factor,score:r(s.score,2),delta:r(s.score-base.score,2)});
    }
  }
  const vals=cases.map(x=>x.score).filter(Number.isFinite);
  const min=vals.length?Math.min(...vals):base.score,max=vals.length?Math.max(...vals):base.score;
  const maxAbs=Math.max(Math.abs(base.score-min),Math.abs(max-base.score));
  return {
    status:maxAbs<=2.5?'STABLE':maxAbs<=5?'SENSITIVE':'FRAGILE',
    base:r(base.score,2),min:r(min,2),max:r(max,2),maxAbsDelta:r(maxAbs,2),cases
  };
}

module.exports={n,r,clamp,BASE_WEIGHTS,CRITICAL,weightedAvailable,capForMissing,applyPenalties,grade,label,scoreWithWeights,sensitivity};
