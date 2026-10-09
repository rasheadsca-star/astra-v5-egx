'use strict';

const fs=require('fs'),path=require('path');
const {dedupeEvidenceRecords}=require('./lib/evidence-dedupe');
const EVID='data/prospective-evidence.json';
const DOC='docs/data/prospective-evidence.json';
const MARKET='data/canonical-market.json';
const HISTORY='data/history-index.json';
const COST_PCT=0.60;
const HOLDING_SESSIONS=10;

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function pct(a,b){return a!=null&&b>0?+((a/b-1)*100).toFixed(2):null}
function maxv(a,b){return a==null?b:b==null?a:Math.max(a,b)}
function minv(a,b){return a==null?b:b==null?a:Math.min(a,b)}
function terminal(status){return ['RESOLVED','AMBIGUOUS_OHLC_ORDER','AMBIGUOUS_ENTRY_BAR'].includes(status)}

const book=read(EVID,{schemaVersion:'astra-prospective-evidence/v1',records:[]});
const market=read(MARKET,null);
const history=read(HISTORY,null);
if(!market||!history) throw new Error('canonical market/history missing');

const mSession=market.source?.expectedSession||market.rows?.[0]?.marketSessionDate||null;
if(!mSession)throw new Error('market session missing');

function barsFor(ticker){
  return (history.symbols?.[ticker]?.sessions||[])
    .map(x=>({date:String(x.date),open:n(x.open),high:n(x.high),low:n(x.low),close:n(x.close)}))
    .filter(x=>x.date&&x.date<=mSession&&x.high!=null&&x.low!=null&&x.close!=null)
    .sort((a,b)=>a.date.localeCompare(b.date));
}

const dedupe=dedupeEvidenceRecords(book.records||[]);
for(const dup of dedupe.duplicates){
  dup.record.excludedFromAnalytics=true;
  dup.record.duplicateOf=dup.primary.id;
}
for(const rec of dedupe.primary){
  rec.outcome=rec.outcome||{status:'PENDING'};
  const o=rec.outcome;
  if(terminal(o.status))continue;
  if(!rec.session||mSession<=rec.session)continue;

  const bars=barsFor(rec.ticker);
  if(!bars.length)continue;

  const entryLow=n(rec.entryLow),entryHigh=n(rec.entryHigh),stop=n(rec.stop),t1=n(rec.target1),t2=n(rec.target2);
  if(entryLow==null||entryHigh==null)continue;

  // Backward-compatible initialization for records created before the holding-session counter existed.
  if(o.filledAt && n(o.holdingSessionsObserved)==null){
    const through=o.lastEvaluatedSession||o.filledAt;
    o.holdingSessionsObserved=bars.filter(b=>b.date>o.filledAt&&b.date<=through).length;
  }
  if(n(o.holdingSessionsObserved)==null)o.holdingSessionsObserved=0;

  const after=o.lastEvaluatedSession||rec.session;
  const unseen=bars.filter(b=>b.date>after);
  for(const bar of unseen){
    if(terminal(o.status))break;
    o.lastEvaluatedSession=bar.date;
    o.lastHigh=bar.high;o.lastLow=bar.low;o.lastClose=bar.close;

    if(o.status==='PENDING'){
      const touched=bar.low<=entryHigh && bar.high>=entryLow;
      if(!touched)continue;

      o.status='OPEN';
      o.filledAt=bar.date;
      o.fillPrice=entryHigh; // conservative long-side fill
      o.holdingSessionsObserved=0;
      o.maxFavorablePct=pct(bar.high,o.fillPrice);
      o.maxAdversePct=pct(bar.low,o.fillPrice);

      // Daily OHLC cannot establish whether entry happened before a same-bar stop/target touch.
      const stopOnFill=stop!=null&&bar.low<=stop;
      const t1OnFill=t1!=null&&bar.high>=t1;
      const t2OnFill=t2!=null&&bar.high>=t2;
      if(stopOnFill||t1OnFill||t2OnFill){
        o.status='AMBIGUOUS_ENTRY_BAR';
        o.ambiguitySession=bar.date;
        o.note='Entry and stop/target were inside the same daily bar; entry chronology is unknowable from OHLC, so no outcome is assigned.';
      }
      continue;
    }

    if(!String(o.status).startsWith('OPEN'))continue;
    const fill=n(o.fillPrice);
    if(fill==null)continue;

    o.holdingSessionsObserved=(n(o.holdingSessionsObserved)||0)+1;
    o.maxFavorablePct=maxv(n(o.maxFavorablePct),pct(bar.high,fill));
    o.maxAdversePct=minv(n(o.maxAdversePct),pct(bar.low,fill));

    const stopHit=stop!=null&&bar.low<=stop;
    const t1Hit=t1!=null&&bar.high>=t1;
    const t2Hit=t2!=null&&bar.high>=t2;

    if(stopHit&&(t1Hit||t2Hit)){
      o.status='AMBIGUOUS_OHLC_ORDER';
      o.ambiguitySession=bar.date;
      o.note='Stop and target were both inside the same post-entry daily bar; chronology unavailable, so no win/loss is assigned.';
      continue;
    }
    if(stopHit){
      o.status='RESOLVED';o.result='STOP';o.resolvedAt=bar.date;o.exitPrice=stop;
      o.grossReturnPct=pct(stop,fill);o.netReturnPct=+(o.grossReturnPct-COST_PCT).toFixed(2);
      continue;
    }
    if(t2Hit){
      o.status='RESOLVED';o.result='TARGET2';o.resolvedAt=bar.date;o.exitPrice=t2;
      o.t1HitAt=o.t1HitAt||bar.date;o.t2HitAt=bar.date;
      o.grossReturnPct=pct(t2,fill);o.netReturnPct=+(o.grossReturnPct-COST_PCT).toFixed(2);
      continue;
    }
    if(t1Hit){
      o.status='OPEN_T1_HIT';
      o.t1HitAt=o.t1HitAt||bar.date;
    }

    if(!terminal(o.status)&&(n(o.holdingSessionsObserved)||0)>=HOLDING_SESSIONS){
      o.status='RESOLVED';o.result='TIME_EXIT';o.resolvedAt=bar.date;o.exitPrice=bar.close;
      o.grossReturnPct=pct(bar.close,fill);o.netReturnPct=+(o.grossReturnPct-COST_PCT).toFixed(2);
      o.note='Resolved at the fixed '+HOLDING_SESSIONS+'-session research horizon.';
    }
  }
}

const records=(book.records||[]).filter(r=>r.excludedFromAnalytics!==true);
const resolved=records.filter(r=>r.outcome?.status==='RESOLVED');
const ambiguous=records.filter(r=>['AMBIGUOUS_OHLC_ORDER','AMBIGUOUS_ENTRY_BAR'].includes(r.outcome?.status));
const positive=resolved.filter(r=>(n(r.outcome?.netReturnPct)||0)>0);
const negative=resolved.filter(r=>(n(r.outcome?.netReturnPct)||0)<0);
const t1Observed=resolved.filter(r=>!!r.outcome?.t1HitAt||r.outcome?.result==='TARGET2');
const t2Observed=resolved.filter(r=>r.outcome?.result==='TARGET2');
const stops=resolved.filter(r=>r.outcome?.result==='STOP');
const timeExits=resolved.filter(r=>r.outcome?.result==='TIME_EXIT');
const avg=resolved.length?+(resolved.reduce((s,r)=>s+(n(r.outcome?.netReturnPct)||0),0)/resolved.length).toFixed(2):null;
const grossWin=positive.reduce((s,r)=>s+Math.max(0,n(r.outcome?.netReturnPct)||0),0);
const grossLoss=Math.abs(negative.reduce((s,r)=>s+Math.min(0,n(r.outcome?.netReturnPct)||0),0));

book.generatedAt=new Date().toISOString();
book.lastMarketSession=mSession;
book.policy={
  version:'prospective-resolver/v2-fixed-horizon',
  longOnly:true,
  holdingHorizonSessions:HOLDING_SESSIONS,
  roundTripCostPct:COST_PCT,
  fillAssumption:'entryHigh (conservative)',
  fillBarOutcome:'AMBIGUOUS_ENTRY_BAR if entry and stop/target coexist in same daily bar',
  postEntrySameBarStopTarget:'AMBIGUOUS_OHLC_ORDER; never force chronology',
  missedSessionRecovery:'Replays every unseen history-index bar sequentially',
  automaticExecution:false
};
book.duplicateRecordsExcluded=(book.records||[]).filter(r=>r.excludedFromAnalytics===true).length;
book.counts={
  total:records.length,
  pending:records.filter(r=>r.outcome?.status==='PENDING').length,
  open:records.filter(r=>String(r.outcome?.status||'').startsWith('OPEN')).length,
  ambiguous:ambiguous.length,
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
console.log(JSON.stringify({session:mSession,counts:book.counts,metrics:book.metrics,policy:book.policy},null,2));
