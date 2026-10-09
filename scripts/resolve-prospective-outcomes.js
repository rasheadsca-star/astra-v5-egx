'use strict';

const fs=require('fs'),path=require('path');
const EVID='data/prospective-evidence.json';
const DOC='docs/data/prospective-evidence.json';
const MARKET='data/canonical-market.json';
const COST_PCT=0.60;

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function pct(a,b){return a!=null&&b>0?+((a/b-1)*100).toFixed(2):null}
function maxv(a,b){return a==null?b:b==null?a:Math.max(a,b)}
function minv(a,b){return a==null?b:b==null?a:Math.min(a,b)}

const book=read(EVID,{schemaVersion:'astra-prospective-evidence/v1',records:[]});
const market=read(MARKET,null);
if(!market) throw new Error('canonical market missing');

const mSession=market.source?.expectedSession||market.rows?.[0]?.marketSessionDate||null;
const rows=new Map((market.rows||[]).map(r=>[r.symbol,r]));

for(const rec of book.records||[]){
  rec.outcome=rec.outcome||{status:'PENDING'};
  const o=rec.outcome;
  if(!mSession||!rec.session||mSession<=rec.session) continue;
  const bar=rows.get(rec.ticker);
  if(!bar) continue;

  const high=n(bar.high),low=n(bar.low),close=n(bar.last??bar.price);
  const entryLow=n(rec.entryLow),entryHigh=n(rec.entryHigh),stop=n(rec.stop),t1=n(rec.target1),t2=n(rec.target2);
  if(high==null||low==null||entryLow==null||entryHigh==null) continue;

  o.lastEvaluatedSession=mSession;
  o.lastHigh=high;o.lastLow=low;o.lastClose=close;

  if(o.status==='PENDING'){
    const touched=low<=entryHigh && high>=entryLow;
    if(!touched) continue;
    // Long-side research plan: use upper edge as conservative assumed fill.
    o.status='OPEN';
    o.filledAt=mSession;
    o.fillPrice=entryHigh;
    o.maxFavorablePct=pct(high,o.fillPrice);
    o.maxAdversePct=pct(low,o.fillPrice);
  } else if(String(o.status).startsWith('OPEN')){
    o.maxFavorablePct=maxv(n(o.maxFavorablePct),pct(high,n(o.fillPrice)));
    o.maxAdversePct=minv(n(o.maxAdversePct),pct(low,n(o.fillPrice)));
  } else {
    continue;
  }

  const fill=n(o.fillPrice);
  if(fill==null) continue;

  const stopHit=stop!=null && low<=stop;
  const t1Hit=t1!=null && high>=t1;
  const t2Hit=t2!=null && high>=t2;

  // With only OHLC, intraday order is unknown. Never invent chronology.
  if(stopHit && (t1Hit||t2Hit)){
    o.status='AMBIGUOUS_OHLC_ORDER';
    o.ambiguitySession=mSession;
    o.note='Stop and target were both inside the same daily bar; chronology unavailable, so no win/loss is assigned.';
    continue;
  }
  if(stopHit){
    o.status='RESOLVED';
    o.result='STOP';
    o.resolvedAt=mSession;
    o.exitPrice=stop;
    o.grossReturnPct=pct(stop,fill);
    o.netReturnPct=+(o.grossReturnPct-COST_PCT).toFixed(2);
    continue;
  }
  if(t2Hit){
    o.status='RESOLVED';
    o.result='TARGET2';
    o.resolvedAt=mSession;
    o.exitPrice=t2;
    o.grossReturnPct=pct(t2,fill);
    o.netReturnPct=+(o.grossReturnPct-COST_PCT).toFixed(2);
    continue;
  }
  if(t1Hit){
    o.status='OPEN_T1_HIT';
    o.t1HitAt=o.t1HitAt||mSession;
  }
}

const records=book.records||[];
const resolved=records.filter(r=>r.outcome?.status==='RESOLVED');
const wins=resolved.filter(r=>String(r.outcome?.result||'').startsWith('TARGET'));
const losses=resolved.filter(r=>r.outcome?.result==='STOP');
const avg=resolved.length?+(resolved.reduce((s,r)=>s+(n(r.outcome?.netReturnPct)||0),0)/resolved.length).toFixed(2):null;
const grossWin=wins.reduce((s,r)=>s+Math.max(0,n(r.outcome?.netReturnPct)||0),0);
const grossLoss=Math.abs(losses.reduce((s,r)=>s+Math.min(0,n(r.outcome?.netReturnPct)||0),0));
book.generatedAt=new Date().toISOString();
book.lastMarketSession=mSession;
book.policy={
  version:'prospective-resolver/v1',
  longOnly:true,
  roundTripCostPct:COST_PCT,
  fillAssumption:'entryHigh (conservative)',
  sameBarStopTarget:'AMBIGUOUS_OHLC_ORDER; never force chronology',
  automaticExecution:false
};
book.counts={
  total:records.length,
  pending:records.filter(r=>r.outcome?.status==='PENDING').length,
  open:records.filter(r=>String(r.outcome?.status||'').startsWith('OPEN')).length,
  ambiguous:records.filter(r=>r.outcome?.status==='AMBIGUOUS_OHLC_ORDER').length,
  resolved:resolved.length,
  wins:wins.length,
  losses:losses.length
};
book.metrics={
  hitRatePct:resolved.length?+((wins.length/resolved.length)*100).toFixed(1):null,
  avgNetReturnPct:avg,
  profitFactor:grossLoss>0?+(grossWin/grossLoss).toFixed(2):(grossWin>0?null:null)
};
write(EVID,book);write(DOC,book);
console.log(JSON.stringify({session:mSession,counts:book.counts,metrics:book.metrics},null,2));
