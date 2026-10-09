'use strict';
const fs=require('fs'),path=require('path');
const ROOT=process.cwd();
function read(rel,fallback){try{return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'))}catch{return fallback}}
function write(rel,v){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function r(v,d=2){return Number.isFinite(v)?+v.toFixed(d):null}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function std(a){const x=a.filter(Number.isFinite);if(x.length<2)return null;const m=mean(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)*(v-m),0)/(x.length-1))}
function ema(vals,period){if(!vals.length)return[];const k=2/(period+1);let e=vals[0];return vals.map((v,i)=>i===0?e:(e=v*k+e*(1-k)))}
function rsi(vals,period=14){if(vals.length<=period)return null;let gain=0,loss=0;for(let i=1;i<=period;i++){const d=vals[i]-vals[i-1];if(d>=0)gain+=d;else loss-=d}gain/=period;loss/=period;for(let i=period+1;i<vals.length;i++){const d=vals[i]-vals[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period}if(loss===0)return 100;return 100-100/(1+gain/loss)}
function atr(rows,period=14){const trs=[];for(let i=1;i<rows.length;i++){const h=n(rows[i].high),l=n(rows[i].low),pc=n(rows[i-1].close);if(h==null||l==null||pc==null)continue;trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)))}return trs.length?mean(trs.slice(-period)):null}
function linreg(vals){const N=vals.length;if(N<10)return null;let sx=0,sy=0,sxy=0,sxx=0;vals.forEach((y,x)=>{sx+=x;sy+=y;sxy+=x*y;sxx+=x*x});const den=N*sxx-sx*sx;if(!den)return null;const slope=(N*sxy-sx*sy)/den,intercept=(sy-slope*sx)/N;const residuals=vals.map((y,x)=>y-(intercept+slope*x));const sd=std(residuals)||0;return {slope,intercept,sd,start:intercept,end:intercept+slope*(N-1),upperStart:intercept+2*sd,upperEnd:intercept+slope*(N-1)+2*sd,lowerStart:intercept-2*sd,lowerEnd:intercept+slope*(N-1)-2*sd}}
function pivots(rows){const pts=[];for(let i=2;i<rows.length-2;i++){const h=n(rows[i].high),l=n(rows[i].low);if(h==null||l==null)continue;const ph=[-2,-1,1,2].every(k=>h>=n(rows[i+k].high));const pl=[-2,-1,1,2].every(k=>l<=n(rows[i+k].low));if(ph)pts.push({type:'R',price:h,date:rows[i].date});if(pl)pts.push({type:'S',price:l,date:rows[i].date})}return pts}
function cluster(points,current){const sorted=points.slice().sort((a,b)=>a.price-b.price),groups=[];for(const p of sorted){const g=groups.at(-1);if(g&&Math.abs(p.price-g.avg)/g.avg<=0.018){g.items.push(p);g.avg=mean(g.items.map(x=>x.price))}else groups.push({avg:p.price,items:[p]})}const levels=groups.map(g=>({price:r(g.avg,4),touches:g.items.length,type:g.avg<=current?'SUPPORT':'RESISTANCE'}));return {supports:levels.filter(x=>x.type==='SUPPORT').sort((a,b)=>b.price-a.price).slice(0,3),resistances:levels.filter(x=>x.type==='RESISTANCE').sort((a,b)=>a.price-b.price).slice(0,3)}}
function assess(close,sma20,sma50,rsi14,slope){let score=50,reasons=[];if(close!=null&&sma20!=null){if(close>sma20){score+=10;reasons.push('PRICE_ABOVE_SMA20')}else{score-=10;reasons.push('PRICE_BELOW_SMA20')}}if(sma20!=null&&sma50!=null){if(sma20>sma50){score+=12;reasons.push('SMA20_ABOVE_SMA50')}else{score-=12;reasons.push('SMA20_BELOW_SMA50')}}if(slope!=null){if(slope>0.12){score+=12;reasons.push('RISING_PRICE_CHANNEL')}else if(slope<-0.12){score-=12;reasons.push('FALLING_PRICE_CHANNEL')}}if(rsi14!=null){if(rsi14>=55&&rsi14<=72){score+=7;reasons.push('RSI_POSITIVE')}else if(rsi14>75){score-=5;reasons.push('RSI_OVERBOUGHT')}else if(rsi14<35){score-=7;reasons.push('RSI_WEAK')}}score=Math.max(0,Math.min(100,score));return {score:r(score,1),outlook:score>=68?'BULLISH_BIAS':score<=38?'BEARISH_BIAS':'NEUTRAL_MIXED',reasons}}

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
  const sr=cluster(pivots(rows.slice(-90)),current),ta=assess(current,sma20,sma50,rsi14,channel?.slopePctPerSession),op=cmap.get(ticker)||null,m=mm.get(ticker)||{};
  const scenario={bullishTrigger:sr.resistances[0]?.price??null,bullishObjective:sr.resistances[1]?.price??fibonacci.high,neutralRangeLow:sr.supports[0]?.price??null,neutralRangeHigh:sr.resistances[0]?.price??null,bearishTrigger:sr.supports[0]?.price??null,bearishObjective:sr.supports[1]?.price??fibonacci.low,note:'Scenario levels are technical reference levels, not guaranteed forecasts.'};
  const payload={success:true,schemaVersion:'astra-technical-analysis/v1',ticker,name:m.name_en||m.name_ar||ticker,session:doc.lastSession||history.source?.expectedSession||null,delayed:market.source?.delayed===true,researchOnly:true,automaticExecution:false,bars:rows,indicators:{last:r(current,4),sma20:r(sma20,4),sma50:r(sma50,4),ema20:r(ema20,4),rsi14:r(rsi14,1),atr14:r(atr14,4),atrPct:current&&atr14?r(100*atr14/current,2):null},fibonacci,channel,supportResistance:sr,technicalAssessment:ta,scenario,astraContext:op?{stage:op.stage,finalDecisionScore:n(op.finalDecisionScore),grade:op.finalDecisionGrade||null,entryQuality:op.entryQuality||null,decisionGate:op.decisionGate||null,entryLow:n(op.entryLow),entryHigh:n(op.entryHigh),stop:n(op.stop),target1:n(op.target1),target2:n(op.target2),monitoringState:op.monitoringState||null,sector:op.sector||null,sectorStrengthScore:n(op.sectorStrengthScore),riskBudgetPct:n(op.riskBudgetPct)}:null};
  write('data/technical/'+ticker+'.json',payload);write('docs/data/technical/'+ticker+'.json',payload);
  symbols.push({ticker,name:payload.name,last:payload.indicators.last,session:payload.session});
}
const index={success:true,schemaVersion:'astra-technical-index/v1',generatedAt:new Date().toISOString(),session:history.source?.expectedSession||null,delayed:market.source?.delayed===true,count:symbols.length,symbols};
write('data/technical/index.json',index);write('docs/data/technical/index.json',index);
console.log(JSON.stringify({count:symbols.length,session:index.session},null,2));
