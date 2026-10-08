'use strict';

const fs=require('fs'), path=require('path');
const OUT='data/confluence-v2/signals.json';
const DOC='docs/data/confluence-v2-signals.json';
const LEDGER='data/confluence-v2/forward-ledger.json';
const MAX_HOURLY_FETCH=30;
const HOURLY_TOL_PCT=3;
const MAX_RISK_PCT=8;
const MIN_RR_T2=2;
const MIN_SCORE=70;

function read(p){return JSON.parse(fs.readFileSync(p,'utf8'))}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function near(a,b,t){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)/Math.max(Math.abs(b),1e-9)*100<=t}
function cairoDate(sec){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(sec*1000))}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function fetchJson(url,attempt=0){
  const c=new AbortController(); const timer=setTimeout(()=>c.abort(),12000);
  try{
    const r=await fetch(url,{headers:{'User-Agent':'ASTRA-CONFLUENCE-V2/1.0','Accept':'application/json','Cache-Control':'no-cache'},signal:c.signal});
    if(!r.ok)throw new Error('HTTP_'+r.status);
    return await r.json();
  }catch(e){
    if(attempt<1){await sleep(350);return fetchJson(url,attempt+1)}
    throw e;
  }finally{clearTimeout(timer)}
}
function extractBars(j){
  const r=j?.chart?.result?.[0], meta=r?.meta||{}, ts=r?.timestamp||[], q=r?.indicators?.quote?.[0]||{};
  const bars=[];
  for(let i=0;i<ts.length;i++){
    const close=Number(q.close?.[i]),vol=Number(q.volume?.[i]||0);
    if(Number.isFinite(close))bars.push({ts:ts[i],date:cairoDate(ts[i]),close,volume:vol});
  }
  return {r,meta,bars};
}
function aggregateToHourly(bars){
  const buckets=new Map();
  for(const b of bars){
    const hour=Math.floor(Number(b.ts)/3600)*3600;
    const prev=buckets.get(hour);
    if(!prev||b.ts>prev.ts)buckets.set(hour,b);
  }
  return [...buckets.values()].sort((a,b)=>a.ts-b.ts);
}
async function hourlyEvidence(ticker,yahooSymbol,session,currentPrice){
  if(!yahooSymbol)return {available:false,status:'YAHOO_SYMBOL_MISSING'};
  try{
    let interval='1h';
    let raw=extractBars(await fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yahooSymbol)+'?range=60d&interval=1h&includePrePost=false&events=history'));
    let bars=raw.bars, meta=raw.meta;
    let eligible=bars.filter(x=>x.date<=session);
    if(eligible.length<100){
      interval='30m_aggregated_to_1h';
      const half=extractBars(await fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(yahooSymbol)+'?range=60d&interval=30m&includePrePost=false&events=history'));
      if(half.bars.length){
        bars=aggregateToHourly(half.bars);
        meta=half.meta;
        eligible=bars.filter(x=>x.date<=session);
      }
    }
    if(!bars.length)return {available:false,status:'HOURLY_EMPTY'};
    const latest=eligible.at(-1);
    if(!latest)return {available:false,status:'NO_BAR_ON_OR_BEFORE_SESSION'};
    const last100=eligible.slice(-100).map(x=>x.close).filter(Number.isFinite);
    const ma100=last100.length===100?avg(last100):null;
    const identityOk=!meta.symbol||String(meta.symbol).toUpperCase()===String(yahooSymbol).toUpperCase();
    const currencyOk=!meta.currency||meta.currency==='EGP';
    const sessionAligned=latest.date===session;
    const ma100Hit=near(currentPrice,ma100,HOURLY_TOL_PCT);
    return {
      available:Number.isFinite(ma100),
      status:Number.isFinite(ma100)?'READY':'INSUFFICIENT_100_HOURLY_BARS',
      source:'YAHOO_CHART_INTRADAY',
      intervalUsed:interval,
      yahooSymbol,
      identityOk,currencyOk,sessionAligned,
      latestBarSession:latest.date,
      latestBarClose:+latest.close.toFixed(4),
      hourlyMa100:ma100?+ma100.toFixed(4):null,
      hourlyMa100Hit:ma100Hit,
      barsUsed:last100.length
    };
  }catch(e){
    return {available:false,status:'FETCH_FAILED',error:String(e.message||e)};
  }
}
function riskMetrics(x){
  const entry=(Number(x.entryLow)+Number(x.entryHigh))/2;
  const stop=Number(x.structuralInvalidation);
  const t1=Number(x.targets?.t1),t2=Number(x.targets?.t2);
  const risk=entry-stop;
  return {
    entryMid:+entry.toFixed(4),
    riskPct:risk>0?+((risk/entry)*100).toFixed(2):null,
    rrT1:risk>0&&t1>entry?+((t1-entry)/risk).toFixed(2):null,
    rrT2:risk>0&&t2>entry?+((t2-entry)/risk).toFixed(2):null
  };
}
function missing(x,h,r){
  const m=[];
  const f=x.confluence?.fundamentals||{};
  if(!(f.verified&&f.profitable))m.push('VERIFIED_PROFITABILITY_REQUIRED');
  if(!(x.confluence?.inFib||x.confluence?.vwapHit))m.push('FIB_OR_AVWAP_REQUIRED');
  if(!(x.confluence?.ma50Hit||x.confluence?.supportHit||h.hourlyMa100Hit))m.push('MA50_OR_HOURLY_MA100_OR_SUPPORT_REQUIRED');
  if(!x.confluence?.reaction?.ok)m.push('REACTION_REQUIRED');
  if(!x.confluence?.volumeConfirmed)m.push('VOLUME_CONFIRMATION_REQUIRED');
  if(!h.available)m.push('HOURLY_1H_DATA_REQUIRED');
  if(h.available&&!h.sessionAligned)m.push('HOURLY_SESSION_MISMATCH');
  if(h.available&&!h.identityOk)m.push('HOURLY_IDENTITY_MISMATCH');
  if(h.available&&!h.currencyOk)m.push('HOURLY_CURRENCY_MISMATCH');
  if(h.available&&!h.hourlyMa100Hit)m.push('HOURLY_MA100_NOT_ALIGNED');
  if(!(Number.isFinite(r.riskPct)&&r.riskPct>0&&r.riskPct<=MAX_RISK_PCT))m.push('RISK_GT_8_OR_INVALID');
  if(!(Number.isFinite(r.rrT2)&&r.rrT2>=MIN_RR_T2))m.push('RR_T2_LT_2');
  return m;
}
(async()=>{
  const v1=read('data/confluence/signals.json');
  const historiesDir='quant/data/history';
  const session=v1.session;
  if(!session)throw new Error('V2_SESSION_MISSING');

  const sourceCandidates=(v1.allTop||[]).slice(0,MAX_HOURLY_FETCH);
  const rows=[];
  for(const x of sourceCandidates){
    let yahooSymbol=null;
    const hp=path.join(historiesDir,x.ticker+'.json');
    if(fs.existsSync(hp)){try{yahooSymbol=read(hp).yahooSymbol||null}catch{}}
    const h=await hourlyEvidence(x.ticker,yahooSymbol,session,Number(x.close));
    const r=riskMetrics(x);
    const hourlyPoints=h.available&&h.sessionAligned&&h.identityOk&&h.currencyOk&&h.hourlyMa100Hit?10:0;
    const score=Math.min(100,Number(x.score||0)+hourlyPoints);
    const misses=missing(x,h,r);
    const entryReady=score>=MIN_SCORE&&misses.length===0;
    let state='WATCHLIST';
    if(entryReady)state='ENTRY_READY';
    else if(misses.includes('VERIFIED_PROFITABILITY_REQUIRED'))state='FUNDAMENTALS_PENDING';
    else if(misses.includes('REACTION_REQUIRED')||misses.includes('VOLUME_CONFIRMATION_REQUIRED'))state='WAITING_FOR_TRIGGER';
    else if(misses.includes('HOURLY_1H_DATA_REQUIRED')||misses.includes('HOURLY_SESSION_MISMATCH'))state='HOURLY_DATA_PENDING';
    else if(misses.includes('RISK_GT_8_OR_INVALID')||misses.includes('RR_T2_LT_2'))state='RISK_REJECTED';
    else if(misses.includes('HOURLY_MA100_NOT_ALIGNED'))state='WAITING_FOR_HOURLY_CONFLUENCE';

    rows.push({
      ticker:x.ticker,session,state,score,dailyScore:x.score,
      researchSignal:entryReady,
      executionAllowed:false,
      entryLow:x.entryLow,entryHigh:x.entryHigh,
      structuralStop:x.structuralInvalidation,
      targets:x.targets,
      risk:r,
      hourly:h,
      dailyConfluence:x.confluence,
      factors:[...(x.factors||[]),...(hourlyPoints?['HOURLY_MA100']:[])],
      missingConditions:misses,
      signalRule:'ENTRY_READY_IS_RESEARCH_SIGNAL_NOT_AUTOMATIC_ORDER'
    });
  }
  rows.sort((a,b)=>(b.researchSignal-a.researchSignal)||b.score-a.score||a.ticker.localeCompare(b.ticker));
  const ready=rows.filter(x=>x.researchSignal);
  const payload={
    schemaVersion:'astra-confluence-pullback/v2',
    engine:'CONFLUENCE_PULLBACK_V2',
    generatedAt:new Date().toISOString(),
    session,
    marketStatus:v1.marketStatus,
    sourceV1GeneratedAt:v1.generatedAt,
    policy:{
      verifiedProfitabilityRequired:true,
      minScore:MIN_SCORE,
      hourlyMa100Required:true,
      hourlyMa100TolerancePct:HOURLY_TOL_PCT,
      reactionRequired:true,
      volumeConfirmationRequired:true,
      maxRiskPct:MAX_RISK_PCT,
      minRrToTarget2:MIN_RR_T2,
      structuralStopRequired:true,
      executionAllowed:false,
      automaticOrders:false
    },
    counts:{evaluated:rows.length,entryReady:ready.length,watchlist:rows.length-ready.length},
    entryReady:ready,
    watchlist:rows.filter(x=>!x.researchSignal),
    all:rows
  };
  write(OUT,payload);write(DOC,payload);

  let ledger={schemaVersion:'astra-confluence-v2-forward/v1',updatedAt:null,records:[]};
  if(fs.existsSync(LEDGER)){try{ledger=read(LEDGER)}catch{}}
  ledger.records=Array.isArray(ledger.records)?ledger.records:[];
  for(const x of ready){
    const key=session+'|'+x.ticker;
    if(!ledger.records.some(r=>r.key===key)){
      ledger.records.push({
        key,signalSession:session,capturedAt:payload.generatedAt,ticker:x.ticker,status:'PENDING_ENTRY',
        entryLow:x.entryLow,entryHigh:x.entryHigh,entryMid:x.risk.entryMid,stop:x.structuralStop,
        targets:x.targets,score:x.score,riskPct:x.risk.riskPct,rrT2:x.risk.rrT2,
        factors:x.factors,hourlyMa100:x.hourly.hourlyMa100,
        entrySession:null,entryPrice:null,exitSession:null,outcome:null,netReturnPct:null,
        maxHoldSessions:10,sameBarPolicy:'STOP_FIRST'
      });
    }
  }
  ledger.updatedAt=payload.generatedAt; write(LEDGER,ledger);
  console.log(JSON.stringify({session,evaluated:rows.length,entryReady:ready.map(x=>({ticker:x.ticker,score:x.score,riskPct:x.risk.riskPct,rrT2:x.risk.rrT2})),topWatch:rows.filter(x=>!x.researchSignal).slice(0,10).map(x=>({ticker:x.ticker,score:x.score,state:x.state,missing:x.missingConditions}))},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
