'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const MARKET='data/canonical-market.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function r(x,d=2){return Number.isFinite(x)?+x.toFixed(d):null}

const d=read(IN,null), market=read(MARKET,null);
if(!d||!market)throw new Error('V5.14 inputs missing');

const marketMap=new Map((market.rows||[]).map(x=>[String(x.symbol||'').toUpperCase(),x]));
const sourceDelayed=market.source?.delayed===true;
const sourceSession=market.source?.expectedSession||d.session||null;

function classify(x){
  const row=marketMap.get(String(x.ticker||'').toUpperCase())||{};
  const px=n(row.price??row.last??x.currentPrice);
  const lo=n(x.entryLow), hi=n(x.entryHigh), stop=n(x.stop), t1=n(x.target1), t2=n(x.target2);
  const gatePass=x.decisionGate?.pass===true;
  const quality=x.entryQuality||'UNKNOWN';

  let state='WATCH';
  let severity='INFO';
  let action='WATCH';
  const reasons=[];

  if(px==null){
    state='NO_CURRENT_PRICE';severity='WARN';action='WAIT_FOR_PRICE';reasons.push('CURRENT_PRICE_MISSING');
  }else if(stop!=null && px<=stop){
    state='STOP_HIT';severity='CRITICAL';action='RISK_ALERT';reasons.push('PRICE_AT_OR_BELOW_STOP');
  }else if(t2!=null && px>=t2){
    state='T2_HIT';severity='SUCCESS';action='TARGET_HIT';reasons.push('TARGET2_REACHED');
  }else if(t1!=null && px>=t1){
    state='T1_HIT';severity='SUCCESS';action='TARGET_HIT';reasons.push('TARGET1_REACHED');
  }else if(quality==='CHASE_RISK'){
    state='CHASE_RISK';severity='WARN';action='DO_NOT_CHASE';reasons.push('ENTRY_QUALITY_CHASE_RISK');
  }else if(!gatePass){
    state='GATE_BLOCKED';severity='WARN';action='NO_ACTION';reasons.push(...(x.decisionGate?.reasons||['DECISION_GATE_BLOCKED']));
  }else if(lo!=null && hi!=null && px>=lo && px<=hi){
    state='IN_ENTRY_ZONE';severity='ACTION';action='REVIEW_ENTRY';reasons.push('PRICE_INSIDE_ENTRY_ZONE');
  }else if(lo!=null && px<lo){
    state='BELOW_ENTRY_ZONE';severity='INFO';action='WATCH';reasons.push('PRICE_BELOW_ENTRY_ZONE');
  }else if(hi!=null && px>hi){
    const extPct=100*(px-hi)/hi;
    if(extPct<=2){
      state='SLIGHTLY_ABOVE_ENTRY';severity='WARN';action='WAIT_OR_REVIEW';reasons.push('PRICE_ABOVE_ENTRY_UP_TO_2PCT');
    }else{
      state='ABOVE_ENTRY_ZONE';severity='WARN';action='DO_NOT_CHASE';reasons.push('PRICE_ABOVE_ENTRY_ZONE');
    }
  }

  if(px!=null && stop!=null && state!=='STOP_HIT' && px>stop){
    const stopGapPct=100*(px-stop)/px;
    if(stopGapPct<=2.5){
      state='NEAR_STOP';severity='CRITICAL';action='RISK_ALERT';reasons.unshift('PRICE_WITHIN_2_5PCT_OF_STOP');
    }
  }

  return {
    ticker:x.ticker,
    portfolioSelected:x.portfolioSelected===true,
    portfolioRank:x.portfolioRank??null,
    currentPrice:r(px,4),
    entryLow:r(lo,4),
    entryHigh:r(hi,4),
    stop:r(stop,4),
    target1:r(t1,4),
    target2:r(t2,4),
    entryQuality:quality,
    gatePass,
    state,severity,action,reasons,
    priceSource:row.source||'cockpit_fallback',
    sourceSession:row.marketSessionDate||row.sourceSessionDate||sourceSession
  };
}

const active=[...(d.topOpportunities||[]),...(d.watchlist||[])];
const rows=active.map(classify);

const basketRows=rows.filter(x=>x.portfolioSelected);
const priority={CRITICAL:5,ACTION:4,WARN:3,SUCCESS:2,INFO:1};
const alerts=rows
  .filter(x=>['CRITICAL','ACTION','WARN','SUCCESS'].includes(x.severity))
  .sort((a,b)=>(priority[b.severity]-priority[a.severity])||((a.portfolioRank??999)-(b.portfolioRank??999)))
  .slice(0,40)
  .map(x=>({
    ticker:x.ticker,
    type:x.action,
    severity:x.severity,
    state:x.state,
    currentPrice:x.currentPrice,
    portfolioSelected:x.portfolioSelected,
    reasons:x.reasons
  }));

const counts={};
for(const x of rows)counts[x.state]=(counts[x.state]||0)+1;

d.monitoringAlertsEngine={
  version:'monitoring-alerts/v1',
  generatedAt:new Date().toISOString(),
  session:sourceSession,
  dataMode:sourceDelayed?'DELAYED_SESSION_MONITORING':'CURRENT_SESSION_MONITORING',
  delayed:sourceDelayed,
  realTime:false,
  monitored:rows.length,
  monitoredBasket:basketRows.length,
  counts,
  rows,
  alerts,
  policy:{
    nearStopPct:2.5,
    slightlyAboveEntryPct:2.0,
    autoExecution:false,
    autoOrders:false
  },
  note:sourceDelayed
    ?'Monitoring uses delayed/current-session data. Alerts are state-change research signals, not real-time execution triggers.'
    :'Monitoring uses the latest available session data. Alerts remain research-only and do not create orders.',
  automaticExecution:false
};

const mmap=new Map(rows.map(x=>[x.ticker,x]));
for(const group of ['topOpportunities','watchlist','rejected']){
  d[group]=(d[group]||[]).map(x=>{
    const m=mmap.get(x.ticker);
    return {...x,
      monitoringState:m?.state??null,
      monitoringSeverity:m?.severity??null,
      monitoringAction:m?.action??null,
      monitoringReasons:m?.reasons??[]
    };
  });
}

write(IN,d);write(DOC,d);
console.log(JSON.stringify(d.monitoringAlertsEngine,null,2));
