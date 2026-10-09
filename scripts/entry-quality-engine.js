'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const MARKET='data/canonical-market.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function pct(a,b){return a!=null&&b>0?+((a/b-1)*100).toFixed(2):null}

const cockpit=read(IN,null);
const market=read(MARKET,null);
if(!cockpit) throw new Error('decision cockpit missing');
if(!market) throw new Error('canonical market missing');

const prices=new Map((market.rows||[]).map(r=>[r.symbol,n(r.last??r.price)]));

function classify(x){
  const px=prices.get(x.ticker);
  const lo=n(x.entryLow),hi=n(x.entryHigh),stop=n(x.stop),t1=n(x.target1);
  if(px==null||lo==null||hi==null) return {entryQuality:'UNKNOWN',entryQualityScore:null,currentPrice:px,entryDistancePct:null,chaseDistancePct:null};

  const distanceToZone=px<lo?pct(lo,px):px>hi?pct(px,hi):0;
  const chase=px>hi?pct(px,hi):0;

  if(stop!=null&&px<=stop){
    return {entryQuality:'INVALIDATED',entryQualityScore:0,currentPrice:px,entryDistancePct:distanceToZone,chaseDistancePct:chase};
  }
  if(px>=lo&&px<=hi){
    return {entryQuality:'IDEAL',entryQualityScore:100,currentPrice:px,entryDistancePct:0,chaseDistancePct:0};
  }
  if(px<lo){
    return {entryQuality:'EARLY',entryQualityScore:75,currentPrice:px,entryDistancePct:distanceToZone,chaseDistancePct:0};
  }
  const extThreshold=hi*1.02;
  if(px<=extThreshold && (t1==null || px<t1)){
    return {entryQuality:'EXTENDED',entryQualityScore:55,currentPrice:px,entryDistancePct:distanceToZone,chaseDistancePct:chase};
  }
  return {entryQuality:'CHASE_RISK',entryQualityScore:20,currentPrice:px,entryDistancePct:distanceToZone,chaseDistancePct:chase};
}

const buckets={EARLY:0,IDEAL:0,EXTENDED:0,CHASE_RISK:0,INVALIDATED:0,UNKNOWN:0};
for(const group of ['topOpportunities','watchlist','rejected']){
  cockpit[group]=(cockpit[group]||[]).map(x=>{
    const q=classify(x);
    buckets[q.entryQuality]=(buckets[q.entryQuality]||0)+1;
    return {...x,...q};
  });
}

cockpit.entryQualityEngine={
  version:'entry-quality/v1',
  generatedAt:new Date().toISOString(),
  marketSession:market.source?.expectedSession||null,
  rules:{
    invalidated:'current price <= stop',
    ideal:'current price inside entry zone',
    early:'current price below entry zone but above stop',
    extended:'0-2% above entry high and still below target1',
    chaseRisk:'>2% above entry high or already at/above target1',
    unknown:'missing current price or entry zone'
  },
  counts:buckets,
  automaticExecution:false
};

write(IN,cockpit);write(DOC,cockpit);
console.log(JSON.stringify(cockpit.entryQualityEngine,null,2));
