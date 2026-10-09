'use strict';
const fs=require('fs'),path=require('path');
const {n,r,mean,ema,rsi,atr,linreg,pivots,clusterLevels,assess}=require('./lib/technical-indicators');
const ROOT=process.cwd();
function read(rel,fallback){try{return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'))}catch{return fallback}}
function write(rel,v){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}

const history=read('data/history-index.json',{symbols:{}}),market=read('data/canonical-market.json',{rows:[]}),cockpit=read('data/decision-cockpit.json',{});
const mm=new Map((market.rows||[]).map(x=>[String(x.symbol||'').toUpperCase(),x]));
const all=[...(cockpit.topOpportunities||[]),...(cockpit.watchlist||[]),...(cockpit.rejected||[])];
const cmap=new Map(all.map(x=>[x.ticker,x]));
const symbols=[];
for(const ticker of Object.keys(history.symbols||{}).sort()){
  const doc=history.symbols[ticker],rows=(doc.sessions||[]).slice(-120).map(x=>({date:x.date,open:n(x.open),high:n(x.high),low:n(x.low),close:n(x.close),volume:n(x.volume)})).filter(x=>x.close!=null);
  if(rows.length<20)continue;
  const closes=rows.map(x=>x.close),sma20=mean(closes.slice(-20)),sma50=mean(closes.slice(-50)),ema20=ema(closes,20).at(-1),rsi14=rsi(closes),atr14=atr(rows),current=closes.at(-1);
  const lb=rows.slice(-60),highs=lb.map(x=>x.high).filter(Number.isFinite),lows=lb.map(x=>x.low).filter(Number.isFinite);
  const swingHigh=Math.max(...highs),swingLow=Math.min(...lows),range=swingHigh-swingLow;
  const fibonacci={high:r(swingHigh,4),low:r(swingLow,4),levels:[0,.236,.382,.5,.618,.786,1].map(q=>({ratio:q,price:r(swingHigh-range*q,4)}))};
  const lr=linreg(lb.map(x=>x.close));const channel=lr?{lookback:lb.length,slopePerSession:r(lr.slope,5),slopePctPerSession:r(100*lr.slope/current,3),centerStart:r(lr.start,4),centerEnd:r(lr.end,4),upperStart:r(lr.upperStart,4),upperEnd:r(lr.upperEnd,4),lowerStart:r(lr.lowerStart,4),lowerEnd:r(lr.lowerEnd,4),width2Sigma:r(2*lr.sd,4)}:null;
  const sr=clusterLevels(pivots(rows.slice(-90)),current),ta=assess({close:current,sma20,sma50,rsi14,channelSlopePct:channel?.slopePctPerSession}),op=cmap.get(ticker)||null,m=mm.get(ticker)||{};
  const scenario={bullishTrigger:sr.resistances[0]?.price??null,bullishObjective:sr.resistances[1]?.price??fibonacci.high,neutralRangeLow:sr.supports[0]?.price??null,neutralRangeHigh:sr.resistances[0]?.price??null,bearishTrigger:sr.supports[0]?.price??null,bearishObjective:sr.supports[1]?.price??fibonacci.low,note:'Scenario levels are technical reference levels, not guaranteed forecasts.'};
  const payload={success:true,schemaVersion:'astra-technical-analysis/v1',ticker,name:m.name_en||m.name_ar||ticker,session:doc.lastSession||history.source?.expectedSession||null,delayed:market.source?.delayed===true,researchOnly:true,automaticExecution:false,bars:rows,indicators:{last:r(current,4),sma20:r(sma20,4),sma50:r(sma50,4),ema20:r(ema20,4),rsi14:r(rsi14,1),atr14:r(atr14,4),atrPct:current&&atr14?r(100*atr14/current,2):null},fibonacci,channel,supportResistance:sr,technicalAssessment:ta,scenario,astraContext:op?{stage:op.stage,finalDecisionScore:n(op.finalDecisionScore),grade:op.finalDecisionGrade||null,entryQuality:op.entryQuality||null,decisionGate:op.decisionGate||null,entryLow:n(op.entryLow),entryHigh:n(op.entryHigh),stop:n(op.stop),target1:n(op.target1),target2:n(op.target2),monitoringState:op.monitoringState||null,sector:op.sector||null,sectorStrengthScore:n(op.sectorStrengthScore),riskBudgetPct:n(op.riskBudgetPct)}:null};
  write('data/technical/'+ticker+'.json',payload);write('docs/data/technical/'+ticker+'.json',payload);
  symbols.push({ticker,name:payload.name,last:payload.indicators.last,session:payload.session});
}
const index={success:true,schemaVersion:'astra-technical-index/v1',generatedAt:new Date().toISOString(),session:history.source?.expectedSession||null,delayed:market.source?.delayed===true,count:symbols.length,symbols};
write('data/technical/index.json',index);write('docs/data/technical/index.json',index);
console.log(JSON.stringify({count:symbols.length,session:index.session},null,2));
