'use strict';

const fs=require('fs'),path=require('path');
const COCKPIT='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';
const EVID='data/prospective-evidence.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function r(v,d=2){return Number.isFinite(v)?+v.toFixed(d):null}

const d=read(COCKPIT,null);
const e=read(EVID,{records:[]});
if(!d)throw new Error('decision cockpit missing');

const records=e.records||[];
const activated=records.filter(x=>['OPEN','OPEN_T1_HIT','RESOLVED','AMBIGUOUS_OHLC_ORDER'].includes(x.outcome?.status));
const resolved=records.filter(x=>x.outcome?.status==='RESOLVED');
const ambiguous=records.filter(x=>x.outcome?.status==='AMBIGUOUS_OHLC_ORDER');

function aggregate(rows){
  const act=rows.filter(x=>['OPEN','OPEN_T1_HIT','RESOLVED','AMBIGUOUS_OHLC_ORDER'].includes(x.outcome?.status));
  const res=rows.filter(x=>x.outcome?.status==='RESOLVED');
  const amb=rows.filter(x=>x.outcome?.status==='AMBIGUOUS_OHLC_ORDER');

  let t1=0,t2=0,stops=0;
  const returns=[];
  const mfes=[],maes=[];
  for(const x of act){
    const o=x.outcome||{};
    if(o.status==='OPEN_T1_HIT'||o.result==='TARGET2'||o.result==='TARGET1'||o.t1HitAt)t1++;
    if(o.result==='TARGET2')t2++;
    if(o.result==='STOP')stops++;
    const mfe=n(o.maxFavorablePct),mae=n(o.maxAdversePct);
    if(mfe!=null)mfes.push(mfe);
    if(mae!=null)maes.push(mae);
  }
  for(const x of res){
    const ret=n(x.outcome?.netReturnPct);
    if(ret!=null)returns.push(ret);
  }
  const wins=returns.filter(x=>x>0), losses=returns.filter(x=>x<0), breakeven=returns.filter(x=>x===0);
  const grossWin=wins.reduce((s,x)=>s+x,0);
  const grossLoss=Math.abs(losses.reduce((s,x)=>s+x,0));
  const avg=returns.length?returns.reduce((s,x)=>s+x,0)/returns.length:null;
  const avgWin=wins.length?wins.reduce((s,x)=>s+x,0)/wins.length:null;
  const avgLoss=losses.length?losses.reduce((s,x)=>s+x,0)/losses.length:null;

  return {
    captured:rows.length,
    activated:act.length,
    resolved:res.length,
    ambiguous:amb.length,
    wins:wins.length,
    losses:losses.length,
    breakeven:breakeven.length,
    t1Hits:t1,
    t2Hits:t2,
    stops,
    t1ObservedPct:act.length?r(100*t1/act.length,1):null,
    t2ResolvedPct:res.length?r(100*t2/res.length,1):null,
    stopResolvedPct:res.length?r(100*stops/res.length,1):null,
    resolvedWinRatePct:res.length?r(100*wins.length/res.length,1):null,
    expectancyPct:avg==null?null:r(avg,2),
    avgWinPct:avgWin==null?null:r(avgWin,2),
    avgLossPct:avgLoss==null?null:r(avgLoss,2),
    payoffRatio:avgWin!=null&&avgLoss!=null&&avgLoss!==0?r(avgWin/Math.abs(avgLoss),2):null,
    profitFactor:grossLoss>0?r(grossWin/grossLoss,2):(grossWin>0?null:null),
    avgMfePct:mfes.length?r(mfes.reduce((s,x)=>s+x,0)/mfes.length,2):null,
    avgMaePct:maes.length?r(maes.reduce((s,x)=>s+x,0)/maes.length,2):null
  };
}

function groupBy(field,labelFn=v=>v??'UNKNOWN'){
  const map=new Map();
  for(const rec of records){
    const raw=typeof field==='function'?field(rec):rec[field];
    const key=labelFn(raw);
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(rec);
  }
  return [...map.entries()]
    .map(([key,rows])=>({key,...aggregate(rows)}))
    .sort((a,b)=>(b.resolved-a.resolved)||(b.activated-a.activated)||(b.captured-a.captured));
}

const byGrade=groupBy('finalDecisionGrade',v=>v||'UNKNOWN');
const byEntryQuality=groupBy('entryQuality',v=>v||'UNKNOWN');
const byRegime=groupBy('regime',v=>v||'UNKNOWN');
const bySector=groupBy('sector',v=>v||'UNCLASSIFIED');
const byPortfolioSelection=groupBy(r=>r.portfolioSelected===true?'SELECTED':'NOT_SELECTED');
const byMonitoringAtCapture=groupBy('monitoringState',v=>v||'UNKNOWN');

const overall=aggregate(records);

function maturity(n){
  if(n<10)return 'INSUFFICIENT_DATA';
  if(n<30)return 'PRELIMINARY';
  if(n<90)return 'CALIBRATING';
  return 'MATURE_SAMPLE';
}

const bestGrade=byGrade.filter(x=>x.resolved>=5&&x.expectancyPct!=null).sort((a,b)=>b.expectancyPct-a.expectancyPct)[0]||null;
const bestEntry=byEntryQuality.filter(x=>x.resolved>=5&&x.expectancyPct!=null).sort((a,b)=>b.expectancyPct-a.expectancyPct)[0]||null;
const bestSector=bySector.filter(x=>x.key!=='UNCLASSIFIED'&&x.resolved>=5&&x.expectancyPct!=null).sort((a,b)=>b.expectancyPct-a.expectancyPct)[0]||null;

d.outcomeAnalyticsEngine={
  version:'outcome-analytics/v1',
  generatedAt:new Date().toISOString(),
  evidenceGeneratedAt:e.generatedAt||null,
  status:maturity(overall.resolved),
  samplePolicy:{
    groupLeaderboardMinimumResolved:5,
    probabilityValidationThreshold:90,
    ambiguousExcludedFromReturnMetrics:true,
    t1Denominator:'activated records including OPEN/OPEN_T1_HIT/RESOLVED/AMBIGUOUS',
    returnMetricsDenominator:'RESOLVED only'
  },
  overall,
  groups:{
    byGrade,
    byEntryQuality,
    byRegime,
    bySector,
    byPortfolioSelection,
    byMonitoringAtCapture
  },
  leaders:{
    grade:bestGrade?{key:bestGrade.key,expectancyPct:bestGrade.expectancyPct,resolved:bestGrade.resolved}:null,
    entryQuality:bestEntry?{key:bestEntry.key,expectancyPct:bestEntry.expectancyPct,resolved:bestEntry.resolved}:null,
    sector:bestSector?{key:bestSector.key,expectancyPct:bestSector.expectancyPct,resolved:bestSector.resolved}:null
  },
  interpretation:{
    expectancy:'Average net return across resolved prospective records after resolver costs.',
    profitFactor:'Gross positive resolved returns divided by absolute gross negative resolved returns.',
    t1ObservedPct:'Share of activated records that have observed T1 or better; unresolved records remain in the denominator.',
    caution:'Small groups are descriptive only. No causal or calibrated-probability claim is made from subgroup rankings.'
  },
  researchOnly:true,
  automaticExecution:false
};

write(COCKPIT,d);write(DOC,d);
console.log(JSON.stringify(d.outcomeAnalyticsEngine,null,2));
