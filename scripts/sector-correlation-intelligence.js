'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const MARKET='data/canonical-market.json';
const HISTORY='data/history-index.json';
const SECTORS='data/sector-map.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function r(x,d=2){return Number.isFinite(x)?+x.toFixed(d):null}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}

const d=read(IN,null), market=read(MARKET,null), history=read(HISTORY,null), sm=read(SECTORS,null);
if(!d||!market||!history||!sm)throw new Error('V5.12 inputs missing');

const map=sm.symbolToSector||{};
const rows=(market.rows||[]).filter(x=>n(x.changePct)!=null);
const marketMean=mean(rows.map(x=>n(x.changePct)))??0;

const sectorRows=new Map();
for(const row of rows){
  const sector=map[String(row.symbol||'').toUpperCase()];
  if(!sector)continue;
  if(!sectorRows.has(sector))sectorRows.set(sector,[]);
  sectorRows.get(sector).push(row);
}
const sectorStats={};
for(const [sector,srows] of sectorRows){
  const changes=srows.map(x=>n(x.changePct)).filter(Number.isFinite);
  const avg=mean(changes)??0;
  const breadth=changes.length?100*changes.filter(x=>x>0).length/changes.length:50;
  const relative=avg-marketMean;
  const score=clamp(50 + relative*8 + (breadth-50)*0.25);
  sectorStats[sector]={
    sector,
    count:srows.length,
    avgChangePct:r(avg),
    relativeChangePct:r(relative),
    breadthPct:r(breadth,1),
    strengthScore:r(score,1),
    status:srows.length>=3?'ACTIVE':'LOW_SAMPLE'
  };
}

function returnSeries(ticker,limit=60){
  const s=history.symbols?.[ticker]?.sessions||[];
  const vals=s.slice(-Math.min(s.length,limit+1));
  const out=[];
  for(let i=1;i<vals.length;i++){
    const p=n(vals[i-1]?.close), c=n(vals[i]?.close);
    if(p&&c)out.push({date:String(vals[i].date),ret:c/p-1});
  }
  return out;
}
function corr(a,b){
  const bm=new Map(b.map(x=>[x.date,x.ret]));
  const pairs=a.map(x=>bm.has(x.date)?[x.ret,bm.get(x.date)]:null).filter(Boolean);
  if(pairs.length<30)return {value:null,n:pairs.length,status:'INSUFFICIENT_OVERLAP'};
  const xs=pairs.map(x=>x[0]), ys=pairs.map(x=>x[1]);
  const mx=mean(xs),my=mean(ys);
  let num=0,dx=0,dy=0;
  for(let i=0;i<xs.length;i++){const ax=xs[i]-mx,ay=ys[i]-my;num+=ax*ay;dx+=ax*ax;dy+=ay*ay}
  const v=dx>0&&dy>0?num/Math.sqrt(dx*dy):null;
  return {value:v==null?null:r(v,3),n:pairs.length,status:v==null?'UNDEFINED':'OK'};
}

const active=[...(d.topOpportunities||[]),...(d.watchlist||[])];
const tickers=[...new Set(active.map(x=>x.ticker).filter(Boolean))];
const series=Object.fromEntries(tickers.map(t=>[t,returnSeries(t)]));
const matrix={};
for(let i=0;i<tickers.length;i++){
  for(let j=i+1;j<tickers.length;j++){
    const a=tickers[i],b=tickers[j],c=corr(series[a],series[b]);
    matrix[a+'|'+b]=c;
  }
}
function pair(a,b){
  if(a===b)return {value:1,n:60,status:'SELF'};
  return matrix[a+'|'+b]||matrix[b+'|'+a]||{value:null,n:0,status:'MISSING'};
}
function annotate(x){
  const sector=map[String(x.ticker||'').toUpperCase()]||null;
  const ss=sector?sectorStats[sector]||null:null;
  const peers=tickers.filter(t=>t!==x.ticker).map(t=>({ticker:t,...pair(x.ticker,t)}))
    .filter(v=>v.value!=null).sort((a,b)=>b.value-a.value);
  const max=peers[0]||null;
  return {
    ...x,
    sector:sector,
    sectorSource:sector?'CONTROLLED_SYMBOL_MAP':'UNCLASSIFIED',
    sectorStrengthScore:ss?.strengthScore??50,
    sectorStrengthStatus:ss?.status??(sector?'NO_CURRENT_PEERS':'UNCLASSIFIED'),
    sectorRelativeChangePct:ss?.relativeChangePct??null,
    sectorBreadthPct:ss?.breadthPct??null,
    maxOpportunityCorrelation:max?.value??null,
    maxOpportunityCorrelationPeer:max?.ticker??null,
    maxOpportunityCorrelationN:max?.n??0,
    correlationRisk:max?.value!=null&&max.value>=0.85?'HIGH':max?.value!=null&&max.value>=0.70?'MEDIUM':'LOW_OR_UNKNOWN'
  };
}
for(const group of ['topOpportunities','watchlist','rejected']){
  d[group]=(d[group]||[]).map(annotate);
}

const classified=rows.filter(x=>map[String(x.symbol||'').toUpperCase()]).length;
const highPairs=Object.entries(matrix)
 .filter(([,v])=>v.value!=null&&v.value>=0.85)
 .sort((a,b)=>b[1].value-a[1].value)
 .slice(0,30)
 .map(([k,v])=>({pair:k,correlation:v.value,overlap:v.n}));

d.sectorCorrelationEngine={
  version:'sector-correlation/v1',
  generatedAt:new Date().toISOString(),
  taxonomy:{
    source:sm.astraSource||'controlled sector seed',
    symbolMappings:Object.keys(map).length,
    currentMarketClassified:classified,
    currentMarketRows:rows.length,
    coveragePct:rows.length?r(100*classified/rows.length,1):0,
    patternInferenceUsed:false
  },
  sectorStats:Object.values(sectorStats).sort((a,b)=>b.strengthScore-a.strengthScore),
  correlation:{
    lookbackReturns:60,
    minimumOverlap:30,
    highThreshold:0.85,
    mediumThreshold:0.70,
    activeTickers:tickers.length,
    evaluatedPairs:Object.values(matrix).filter(x=>x.value!=null).length,
    pairMatrix:Object.fromEntries(Object.entries(matrix).filter(([,v])=>v.value!=null).map(([k,v])=>[k,{correlation:v.value,overlap:v.n}])),
    highPairs
  },
  note:'Sector constraints use controlled symbol mappings only. Correlation is Pearson correlation of overlapping daily close-to-close returns and is used as a concentration-control signal, not as a forecast.',
  researchOnly:true,
  automaticOrders:false
};

write(IN,d);write(DOC,d);
console.log(JSON.stringify(d.sectorCorrelationEngine,null,2));
