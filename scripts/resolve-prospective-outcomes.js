'use strict';

const fs=require('fs'),path=require('path');
const {dedupeEvidenceRecords}=require('./lib/evidence-dedupe');
const {verifyCaptureHash}=require('./lib/persistent-evidence');
const {evaluatePlan,DEFAULT_SPEC}=require('./lib/execution-contract');

const EVID='data/prospective-evidence.json';
const DOC='docs/data/prospective-evidence.json';
const MARKET='data/canonical-market.json';
const HISTORY='data/history-index.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function pct(v){return Number.isFinite(v)?+(v*100).toFixed(2):null}
function terminal(status){return ['RESOLVED','EXPIRED_UNFILLED','INVALID_CONTRACT'].includes(status)}

const book=read(EVID,{schemaVersion:'astra-prospective-evidence/v1',records:[]});
const market=read(MARKET,null);
const history=read(HISTORY,null);
if(!market||!history)throw new Error('canonical market/history missing');
const mSession=market.source?.expectedSession||market.rows?.[0]?.marketSessionDate||null;
if(!mSession)throw new Error('market session missing');

function barsFor(ticker){
  return (history.symbols?.[ticker]?.sessions||[])
    .map(x=>({date:String(x.date),open:n(x.open),high:n(x.high),low:n(x.low),close:n(x.close)}))
    .filter(x=>x.date&&x.date<=mSession&&x.open!=null&&x.high!=null&&x.low!=null&&x.close!=null)
    .sort((a,b)=>a.date.localeCompare(b.date));
}
function resultLabel(result){
  if(result.hit2===1)return 'TARGET2';
  if(String(result.firstExitType||'').startsWith('STOP'))return 'STOP';
  if(result.firstExitType==='TIME_EXIT'||result.secondExitType==='TIME_EXIT')return 'TIME_EXIT';
  if(String(result.secondExitType||'').startsWith('BREAKEVEN'))return 'BREAKEVEN_AFTER_T1';
  return 'CLOSED_OTHER';
}

const dedupe=dedupeEvidenceRecords(book.records||[]);
for(const dup of dedupe.duplicates){
  dup.record.excludedFromAnalytics=true;
  dup.record.duplicateOf=dup.primary.id;
}

for(const rec of dedupe.primary){
  if(rec.captureHash){
    const integrity=verifyCaptureHash(rec);
    if(!integrity.ok)throw new Error(integrity.reason+': '+rec.session+'|'+rec.ticker);
  }
  rec.outcome=rec.outcome||{status:'PENDING'};
  if(terminal(rec.outcome.status))continue;
  if(!rec.session||mSession<=rec.session)continue;

  const bars=barsFor(rec.ticker);
  const signalIndex=bars.findIndex(b=>b.date===String(rec.session));
  if(signalIndex<0)continue;

  const entryLow=n(rec.entryLow),entryHigh=n(rec.entryHigh),stop=n(rec.stop),t1=n(rec.target1),t2=n(rec.target2);
  if(entryLow==null||entryHigh==null||stop==null||t1==null||t2==null){
    rec.outcome={
      ...rec.outcome,
      status:'INVALID_CONTRACT',
      resolvedAt:mSession,
      executionSpecVersion:DEFAULT_SPEC.version,
      note:'Frozen prediction is missing one or more execution levels required by the canonical contract.'
    };
    continue;
  }

  const result=evaluatePlan({
    signalIndex,
    referenceClose:n(rec.currentPrice)??((entryLow+entryHigh)/2),
    entryLow,entryHigh,stop,target1:t1,target2:t2,bars
  });

  if(result.status==='unfilled'){
    rec.outcome={
      status:'EXPIRED_UNFILLED',
      result:'UNFILLED',
      resolvedAt:result.end,
      fillPrice:null,
      exitPrice:null,
      equivalentExitPrice:null,
      grossReturnPct:null,
      netReturnPct:null,
      t1HitAt:null,
      t2HitAt:null,
      locked:false,
      executionSpecVersion:DEFAULT_SPEC.version,
      exitType:'NEXT_OPEN_OUTSIDE_ENTRY_ZONE',
      note:'Canonical contract: entry expires when the next-session open is outside the frozen entry zone.'
    };
    continue;
  }

  if(result.status==='open'){
    rec.outcome={
      ...rec.outcome,
      status:result.e!=null?(result.hit1===1?'OPEN_T1_HIT':'OPEN'):'PENDING',
      fillPrice:result.e,
      lastEvaluatedSession:mSession,
      executionSpecVersion:DEFAULT_SPEC.version,
      note:result.reason
    };
    continue;
  }

  if(result.status!=='closed')continue;

  const label=resultLabel(result);
  rec.outcome={
    status:'RESOLVED',
    result:label,
    resolvedAt:result.end,
    fillPrice:result.e,
    exitPrice:result.xeq,
    equivalentExitPrice:result.xeq,
    grossReturnPct:result.ret==null?null:pct(result.ret+Number(DEFAULT_SPEC.plan.roundTripCostRate)),
    netReturnPct:pct(result.ret),
    t1HitAt:result.hit1===1?result.firstExitAt:null,
    t2HitAt:result.hit2===1?result.secondExitAt:null,
    locked:result.locked===true,
    executionSpecVersion:DEFAULT_SPEC.version,
    firstExitType:result.firstExitType||null,
    secondExitType:result.secondExitType||null,
    note:'Resolved under '+DEFAULT_SPEC.version+'.'
  };
}

const allRecords=(book.records||[]).filter(r=>r.excludedFromAnalytics!==true);
const records=allRecords.filter(r=>r.recordedForwardEligible===true);
const resolved=records.filter(r=>r.outcome?.status==='RESOLVED');
const unfilled=records.filter(r=>r.outcome?.status==='EXPIRED_UNFILLED');
const positive=resolved.filter(r=>(n(r.outcome?.netReturnPct)||0)>0);
const negative=resolved.filter(r=>(n(r.outcome?.netReturnPct)||0)<0);
const t1Observed=resolved.filter(r=>!!r.outcome?.t1HitAt);
const t2Observed=resolved.filter(r=>!!r.outcome?.t2HitAt||r.outcome?.result==='TARGET2');
const stops=resolved.filter(r=>r.outcome?.result==='STOP');
const timeExits=resolved.filter(r=>r.outcome?.result==='TIME_EXIT');
const avg=resolved.length?+(resolved.reduce((s,r)=>s+(n(r.outcome?.netReturnPct)||0),0)/resolved.length).toFixed(2):null;
const grossWin=positive.reduce((s,r)=>s+Math.max(0,n(r.outcome?.netReturnPct)||0),0);
const grossLoss=Math.abs(negative.reduce((s,r)=>s+Math.min(0,n(r.outcome?.netReturnPct)||0),0));

book.generatedAt=new Date().toISOString();
book.lastMarketSession=mSession;
book.policy={
  version:'prospective-resolver/v3-canonical-execution-contract',
  executionSpecVersion:DEFAULT_SPEC.version,
  longOnly:true,
  entryMethod:'next-session open only; expires if open is outside frozen entry zone',
  holdingHorizonSessions:DEFAULT_SPEC.plan.holdingHorizonSessions,
  roundTripCostPct:+(DEFAULT_SPEC.plan.roundTripCostRate*100).toFixed(2),
  target1FractionPct:+(DEFAULT_SPEC.plan.target1Fraction*100).toFixed(0),
  afterTarget1Stop:'BREAKEVEN',
  intradayTiePriority:'STOP_FIRST',
  laterGapFill:'OPEN',
  calibrationEligibility:'recordedForwardEligible=true only',
  automaticExecution:false
};
book.duplicateRecordsExcluded=(book.records||[]).filter(r=>r.excludedFromAnalytics===true).length;
book.lateCaptureRecordsExcludedFromForwardAnalytics=allRecords.filter(r=>r.recordedForwardEligible!==true).length;
book.counts={
  totalMaterialized:allRecords.length,
  forwardEligible:records.length,
  pending:records.filter(r=>r.outcome?.status==='PENDING').length,
  open:records.filter(r=>String(r.outcome?.status||'').startsWith('OPEN')).length,
  unfilled:unfilled.length,
  resolved:resolved.length,
  positive:positive.length,
  negative:negative.length,
  t1Observed:t1Observed.length,
  t2Observed:t2Observed.length,
  stops:stops.length,
  timeExits:timeExits.length
};
book.metrics={
  resolvedPositiveRatePct:resolved.length?+((positive.length/resolved.length)*100).toFixed(1):null,
  t1WithinHorizonPct:resolved.length?+((t1Observed.length/resolved.length)*100).toFixed(1):null,
  t2WithinHorizonPct:resolved.length?+((t2Observed.length/resolved.length)*100).toFixed(1):null,
  stopWithinHorizonPct:resolved.length?+((stops.length/resolved.length)*100).toFixed(1):null,
  avgNetReturnPct:avg,
  profitFactor:grossLoss>0?+(grossWin/grossLoss).toFixed(2):(grossWin>0?null:null)
};
write(EVID,book);write(DOC,book);
console.log(JSON.stringify({session:mSession,policy:book.policy,counts:book.counts,metrics:book.metrics},null,2));
