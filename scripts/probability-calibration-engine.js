'use strict';

const fs=require('fs'),path=require('path');
const COCKPIT='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const EVID='data/prospective-evidence.json';
const QUANT='data/quant/signals.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function r1(x){return Number.isFinite(x)?+x.toFixed(1):null}
function wilson(k,total,z=1.645){
  if(!total)return [null,null];
  const p=k/total, z2=z*z, den=1+z2/total;
  const mid=(p+z2/(2*total))/den;
  const half=z*Math.sqrt((p*(1-p)+z2/(4*total))/total)/den;
  return [r1(100*Math.max(0,mid-half)),r1(100*Math.min(1,mid+half))];
}
function maturity(total){
  if(total<10)return 'INSUFFICIENT_DATA';
  if(total<30)return 'PRELIMINARY';
  if(total<90)return 'CALIBRATING';
  return 'VALIDATED';
}
function bucketGrade(g){return ['A+','A','B','C','REJECT'].includes(g)?g:'UNKNOWN'}
function bucketEntry(q){return ['IDEAL','EARLY','EXTENDED','CHASE_RISK','INVALIDATED'].includes(q)?q:'UNKNOWN'}
function bucketRR(rr){
  rr=n(rr); if(rr==null)return 'UNKNOWN';
  if(rr>=3)return 'RR_3_PLUS';
  if(rr>=2)return 'RR_2_3';
  if(rr>=1.5)return 'RR_1_5_2';
  return 'RR_LT_1_5';
}
function bucketContext(v){
  v=n(v); if(v==null)return 'UNKNOWN';
  if(v>=70)return 'CTX_STRONG';
  if(v>=50)return 'CTX_NEUTRAL';
  return 'CTX_WEAK';
}
function signature(x){
  return [bucketGrade(x.finalDecisionGrade),bucketEntry(x.entryQuality),bucketRR(x.rrT2),bucketContext(x.contextScore)].join('|');
}

const d=read(COCKPIT,null);
if(!d)throw new Error('decision cockpit missing');
const e=read(EVID,{records:[],counts:{},metrics:{}});
const q=read(QUANT,null);

const resolved=(e.records||[]).filter(r=>r.outcome?.status==='RESOLVED');
const groups=new Map();
for(const r of resolved){
  const key=signature(r);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(r);
}

function aggregate(records){
  const total=records.length;
  let t1=0,t2=0,stop=0;
  let net=0;
  for(const r of records){
    const result=String(r.outcome?.result||'');
    if(result==='TARGET2'){t1++;t2++}
    else if(result==='TARGET1'){t1++}
    else if(result==='STOP'){stop++}
    const ret=n(r.outcome?.netReturnPct); if(ret!=null) net+=ret;
  }
  return {
    n:total,
    t1Hits:t1,t2Hits:t2,stops:stop,
    t1Pct:total?r1(100*t1/total):null,
    t2Pct:total?r1(100*t2/total):null,
    stopPct:total?r1(100*stop/total):null,
    avgNetReturnPct:total?r1(net/total):null,
    t1Ci90:wilson(t1,total),
    t2Ci90:wilson(t2,total),
    stopCi90:wilson(stop,total),
    maturity:maturity(total)
  };
}

const overall=aggregate(resolved);

// Historical benchmark for NEXT_QUANT only; never relabel it as calibrated V5.8 probability.
const quantHist=q?.plan?.top||null;
const quantBenchmark=quantHist?{
  sampleSize:n(quantHist.n),
  t1HitPct:n(quantHist.hit1),
  t2HitPct:n(quantHist.hit2),
  source:'historical_quant_backtest',
  calibratedForward:false
}:null;

function probabilityFor(x){
  const key=signature(x);
  const local=aggregate(groups.get(key)||[]);
  const useLocal=local.n>=10;
  const base=useLocal?local:overall;
  const mat=maturity(base.n);
  const available=base.n>=10;

  let expectedValue=null;
  if(available){
    const entry=n(x.entryHigh??x.entryLow);
    const stop=n(x.stop),t1=n(x.target1),t2=n(x.target2);
    if(entry&&stop&&t1&&t2){
      const p2=(base.t2Pct||0)/100;
      const p1only=Math.max(0,((base.t1Pct||0)-(base.t2Pct||0))/100);
      const ps=(base.stopPct||0)/100;
      const r2=(t2-entry)/entry*100;
      const r1=(t1-entry)/entry*100;
      const rs=(stop-entry)/entry*100;
      expectedValue=r1round(p2*r2+p1only*r1+ps*rs);
    }
  }

  return {
    signature:key,
    sampleSize:base.n,
    source:useLocal?'matched_forward_bucket':'overall_forward_pool',
    status:mat,
    calibrated:mat==='VALIDATED',
    t1ProbabilityPct:available?base.t1Pct:null,
    t1Ci90:available?base.t1Ci90:[null,null],
    t2ProbabilityPct:available?base.t2Pct:null,
    t2Ci90:available?base.t2Ci90:[null,null],
    stopProbabilityPct:available?base.stopPct:null,
    stopCi90:available?base.stopCi90:[null,null],
    expectedValuePct:available?expectedValue:null,
    historicalBenchmark:(x.engineFamilies||[]).includes('NEXT_QUANT')?quantBenchmark:null,
    note:available
      ?'Forward empirical estimate with 90% Wilson interval; not a guarantee.'
      :'Insufficient resolved forward evidence. No calibrated probability is shown.'
  };
}
function r1round(x){return Number.isFinite(x)?+x.toFixed(2):null}

for(const group of ['topOpportunities','watchlist','rejected']){
  d[group]=(d[group]||[]).map(x=>({...x,targetAchievement:probabilityFor(x)}));
}

const all=[...(d.topOpportunities||[]),...(d.watchlist||[]),...(d.rejected||[])];
const withProb=all.filter(x=>n(x.targetAchievement?.t1ProbabilityPct)!=null);
const bestByT1=withProb.slice().sort((a,b)=>
  (n(b.targetAchievement?.t1ProbabilityPct)||-1)-(n(a.targetAchievement?.t1ProbabilityPct)||-1) ||
  (n(b.finalDecisionScore)||-1)-(n(a.finalDecisionScore)||-1)
)[0]||null;

d.probabilityCalibrationEngine={
  version:'probability-calibration/v1',
  generatedAt:new Date().toISOString(),
  forwardResolved:resolved.length,
  status:maturity(resolved.length),
  thresholds:{preliminary:10,calibrating:30,validated:90},
  methodology:'Empirical forward outcomes, matched by grade + entry quality + R:R bucket + context bucket. Falls back to overall forward pool only after 10 resolved records. 90% Wilson intervals are reported. No probability is emitted below the minimum evidence threshold.',
  overall,
  quantHistoricalBenchmark:quantBenchmark,
  bestByCalibratedT1:bestByT1?{
    ticker:bestByT1.ticker,
    t1ProbabilityPct:bestByT1.targetAchievement.t1ProbabilityPct,
    t2ProbabilityPct:bestByT1.targetAchievement.t2ProbabilityPct,
    stopProbabilityPct:bestByT1.targetAchievement.stopProbabilityPct,
    expectedValuePct:bestByT1.targetAchievement.expectedValuePct,
    sampleSize:bestByT1.targetAchievement.sampleSize,
    status:bestByT1.targetAchievement.status
  }:null,
  automaticExecution:false
};

write(COCKPIT,d);write(DOC,d);
console.log(JSON.stringify(d.probabilityCalibrationEngine,null,2));
