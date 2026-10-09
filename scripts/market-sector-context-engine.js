'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const MARKET='data/canonical-market.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function round(x,d=1){return Number.isFinite(x)?+x.toFixed(d):null}

const cockpit=read(IN,null);
const market=read(MARKET,null);
if(!cockpit) throw new Error('decision cockpit missing');
if(!market) throw new Error('canonical market missing');

const marketRows=(market.rows||[]).filter(r=>n(r.changePct)!=null);
const adv=marketRows.filter(r=>n(r.changePct)>0).length;
const dec=marketRows.filter(r=>n(r.changePct)<0).length;
const flat=marketRows.length-adv-dec;
const breadth=marketRows.length?100*adv/marketRows.length:null;
const medianChange=marketRows.length
  ? [...marketRows].map(r=>n(r.changePct)).sort((a,b)=>a-b)[Math.floor(marketRows.length/2)]
  : null;

function marketScore(regime,b){
  let s=50;
  const rg=String(regime||'');
  if(rg.includes('صاعد')) s+=20;
  else if(rg.includes('هابط')) s-=20;
  else if(rg.includes('متذبذب')) s-=5;
  if(b!=null) s+=(b-50)*0.5;
  return clamp(s);
}
function liquidityScore(x){
  const liq=x.liquidity||{};
  const tier=String(liq.tier||'');
  const turnover=n(liq.turnoverM);
  if(tier.includes('عالية')) return 90;
  if(tier.includes('متوسطة')) return 65;
  if(tier.includes('منخفضة')) return 30;
  if(turnover!=null){
    if(turnover>=15)return 90;
    if(turnover>=5)return 65;
    return 30;
  }
  return 50;
}
function sectorScore(x){
  const s=n(x.sectorStrengthScore);
  return s==null?50:s;
}
const mScore=marketScore(cockpit.market?.regime,breadth??n(cockpit.market?.breadthPct));

function adjust(x){
  const base=n(x.conviction)??n(x.qualityScore)??50;
  const liq=liquidityScore(x);
  const sec=sectorScore(x);
  const context=clamp(0.50*mScore+0.30*liq+0.20*sec);
  const adj=round((context-50)*0.30,1);
  const adjusted=round(clamp(base+adj),1);
  const warnings=[...(x.warnings||[])];
  if(mScore<40 && !warnings.includes('WEAK_MARKET_CONTEXT')) warnings.push('WEAK_MARKET_CONTEXT');
  if(liq<40 && !warnings.includes('LOW_LIQUIDITY_CONTEXT')) warnings.push('LOW_LIQUIDITY_CONTEXT');
  return {
    ...x,
    contextScore:round(context,1),
    contextAdjustment:adj,
    adjustedConviction:adjusted,
    marketContextScore:round(mScore,1),
    sectorContextScore:sec,
    sectorContextStatus:x.sectorSource==='CONTROLLED_SYMBOL_MAP'?'VERIFIED_MAP':'UNCLASSIFIED_NEUTRAL',
    liquidityContextScore:liq,
    warnings
  };
}

for(const group of ['topOpportunities','watchlist','rejected']){
  cockpit[group]=(cockpit[group]||[]).map(adjust);
  cockpit[group].sort((a,b)=>(b.adjustedConviction??-1)-(a.adjustedConviction??-1)||(a.rank??999)-(b.rank??999));
  cockpit[group]=cockpit[group].map((x,i)=>({...x,contextRank:i+1}));
}

cockpit.marketSectorContextEngine={
  version:'market-sector-context/v1',
  generatedAt:new Date().toISOString(),
  marketSession:market.source?.expectedSession||null,
  market:{
    regime:cockpit.market?.regime||null,
    breadthPct:round(breadth??n(cockpit.market?.breadthPct),1),
    advancing:adv,
    declining:dec,
    flat,
    medianChangePct:round(medianChange,2),
    score:round(mScore,1)
  },
  weights:{market:0.50,liquidity:0.30,sector:0.20},
  convictionAdjustmentScale:0.30,
  sector:{
    status:cockpit.sectorCorrelationEngine?.taxonomy?.coveragePct>0?'CONTROLLED_MAP_ACTIVE':'UNAVAILABLE_NEUTRAL',
    coveragePct:cockpit.sectorCorrelationEngine?.taxonomy?.coveragePct??0,
    note:'Sector contribution uses controlled symbol mappings only; unmapped symbols remain neutral.'
  },
  automaticExecution:false
};

write(IN,cockpit);write(DOC,cockpit);
console.log(JSON.stringify(cockpit.marketSectorContextEngine,null,2));
