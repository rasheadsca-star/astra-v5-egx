'use strict';

const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'../..');
function read(rel,fallback){try{return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'))}catch{return fallback}}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function r(v,d=2){return Number.isFinite(v)?+v.toFixed(d):null}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function std(a){const x=a.filter(Number.isFinite);if(x.length<2)return null;const m=mean(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)*(v-m),0)/(x.length-1))}
function ema(vals,period){if(!vals.length)return[];const k=2/(period+1);let e=vals[0];return vals.map((v,i)=>{if(i===0)return e;e=v*k+e*(1-k);return e})}
function rsi(vals,period=14){
  if(vals.length<=period)return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=vals[i]-vals[i-1];if(d>=0)gain+=d;else loss-=d}
  gain/=period;loss/=period;
  for(let i=period+1;i<vals.length;i++){const d=vals[i]-vals[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period}
  if(loss===0)return 100;
  const rs=gain/loss;return 100-100/(1+rs);
}
function atr(rows,period=14){
  if(rows.length<2)return null;
  const trs=[];
  for(let i=1;i<rows.length;i++){
    const h=n(rows[i].high),l=n(rows[i].low),pc=n(rows[i-1].close);
    if(h==null||l==null||pc==null)continue;
    trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
  }
  return trs.length?mean(trs.slice(-period)):null;
}
function linreg(vals){
  const N=vals.length;if(N<10)return null;
  let sx=0,sy=0,sxy=0,sxx=0;
  vals.forEach((y,x)=>{sx+=x;sy+=y;sxy+=x*y;sxx+=x*x});
  const den=N*sxx-sx*sx;if(!den)return null;
  const slope=(N*sxy-sx*sy)/den,intercept=(sy-slope*sx)/N;
  const residuals=vals.map((y,x)=>y-(intercept+slope*x));
  const sd=std(residuals)||0;
  return {slope,intercept,sd,start:intercept,end:intercept+slope*(N-1),upperStart:intercept+2*sd,upperEnd:intercept+slope*(N-1)+2*sd,lowerStart:intercept-2*sd,lowerEnd:intercept+slope*(N-1)-2*sd};
}
function pivotLevels(rows){
  const pts=[];
  for(let i=2;i<rows.length-2;i++){
    const h=n(rows[i].high),l=n(rows[i].low); if(h==null||l==null)continue;
    const ph=[-2,-1,1,2].every(k=>h>=n(rows[i+k].high));
    const pl=[-2,-1,1,2].every(k=>l<=n(rows[i+k].low));
    if(ph)pts.push({type:'R',price:h,date:rows[i].date});
    if(pl)pts.push({type:'S',price:l,date:rows[i].date});
  }
  return pts;
}
function clusterLevels(points,current){
  const sorted=points.slice().sort((a,b)=>a.price-b.price),groups=[];
  for(const p of sorted){
    const g=groups.at(-1);
    if(g&&Math.abs(p.price-g.avg)/g.avg<=0.018){g.items.push(p);g.avg=mean(g.items.map(x=>x.price))}
    else groups.push({avg:p.price,items:[p]});
  }
  const levels=groups.map(g=>({price:r(g.avg,4),touches:g.items.length,type:g.avg<=current?'SUPPORT':'RESISTANCE'}));
  return {
    supports:levels.filter(x=>x.type==='SUPPORT').sort((a,b)=>b.price-a.price).slice(0,3),
    resistances:levels.filter(x=>x.type==='RESISTANCE').sort((a,b)=>a.price-b.price).slice(0,3)
  };
}
function scoreAnalysis({close,sma20,sma50,rsi14,channelSlopePct,supports,resistances}){
  let score=50;const reasons=[];
  if(close!=null&&sma20!=null){if(close>sma20){score+=10;reasons.push('PRICE_ABOVE_SMA20')}else{score-=10;reasons.push('PRICE_BELOW_SMA20')}}
  if(sma20!=null&&sma50!=null){if(sma20>sma50){score+=12;reasons.push('SMA20_ABOVE_SMA50')}else{score-=12;reasons.push('SMA20_BELOW_SMA50')}}
  if(channelSlopePct!=null){if(channelSlopePct>0.12){score+=12;reasons.push('RISING_PRICE_CHANNEL')}else if(channelSlopePct<-0.12){score-=12;reasons.push('FALLING_PRICE_CHANNEL')}}
  if(rsi14!=null){if(rsi14>=55&&rsi14<=72){score+=7;reasons.push('RSI_POSITIVE')}else if(rsi14>75){score-=5;reasons.push('RSI_OVERBOUGHT')}else if(rsi14<35){score-=7;reasons.push('RSI_WEAK')}}
  score=Math.max(0,Math.min(100,score));
  const outlook=score>=68?'BULLISH_BIAS':score<=38?'BEARISH_BIAS':'NEUTRAL_MIXED';
  return {score:r(score,1),outlook,reasons};
}

async function handler(req,res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate');
  try{
    const history=read('data/history-index.json',{symbols:{}});
    const market=read('data/canonical-market.json',{rows:[]});
    const cockpit=read('data/decision-cockpit.json',{});
    const mm=new Map((market.rows||[]).map(x=>[String(x.symbol||'').toUpperCase(),x]));
    const q=(req.query?.symbol||req.query?.ticker||'').toString().trim().toUpperCase();

    if(!q){
      const symbols=Object.keys(history.symbols||{}).sort().map(t=>{
        const m=mm.get(t)||{};
        return {ticker:t,name:m.name_en||m.name_ar||t,last:n(m.last??m.price),session:m.marketSessionDate||m.sourceSessionDate||history.symbols[t]?.lastSession||null};
      });
      return res.status(200).json({success:true,symbols,session:history.source?.expectedSession||null,delayed:market.source?.delayed===true});
    }

    const doc=history.symbols?.[q];
    if(!doc)return res.status(404).json({success:false,error:'SYMBOL_NOT_FOUND',ticker:q});

    const rows=(doc.sessions||[]).slice(-120).map(x=>({date:x.date,open:n(x.open),high:n(x.high),low:n(x.low),close:n(x.close),volume:n(x.volume)})).filter(x=>x.close!=null);
    if(rows.length<20)return res.status(200).json({success:false,error:'INSUFFICIENT_HISTORY',ticker:q,historySessions:rows.length});
    const closes=rows.map(x=>x.close);
    const sma20=mean(closes.slice(-20)),sma50=mean(closes.slice(-50));
    const ema20=ema(closes,20).at(-1);
    const rsi14=rsi(closes,14),atr14=atr(rows,14);
    const lookback=rows.slice(-60), highs=lookback.map(x=>x.high).filter(Number.isFinite),lows=lookback.map(x=>x.low).filter(Number.isFinite);
    const swingHigh=Math.max(...highs),swingLow=Math.min(...lows),range=swingHigh-swingLow;
    const fib={
      high:r(swingHigh,4),low:r(swingLow,4),
      levels:[
        {ratio:0,price:r(swingHigh,4)},{ratio:0.236,price:r(swingHigh-range*0.236,4)},{ratio:0.382,price:r(swingHigh-range*0.382,4)},
        {ratio:0.5,price:r(swingHigh-range*0.5,4)},{ratio:0.618,price:r(swingHigh-range*0.618,4)},{ratio:0.786,price:r(swingHigh-range*0.786,4)},{ratio:1,price:r(swingLow,4)}
      ]
    };
    const lr=linreg(lookback.map(x=>x.close));
    const current=closes.at(-1);
    const channel=lr?{
      lookback:lookback.length,slopePerSession:r(lr.slope,5),slopePctPerSession:r(100*lr.slope/current,3),
      centerStart:r(lr.start,4),centerEnd:r(lr.end,4),upperStart:r(lr.upperStart,4),upperEnd:r(lr.upperEnd,4),lowerStart:r(lr.lowerStart,4),lowerEnd:r(lr.lowerEnd,4),
      width2Sigma:r(2*lr.sd,4)
    }:null;
    const sr=clusterLevels(pivotLevels(rows.slice(-90)),current);
    const analysis=scoreAnalysis({close:current,sma20,sma50,rsi14,channelSlopePct:channel?.slopePctPerSession,supports:sr.supports,resistances:sr.resistances});
    const op=[...(cockpit.topOpportunities||[]),...(cockpit.watchlist||[]),...(cockpit.rejected||[])].find(x=>x.ticker===q)||null;
    const nextResistance=sr.resistances[0]?.price??null,nextSupport=sr.supports[0]?.price??null;
    const scenario={
      bullishTrigger:nextResistance,
      bullishObjective:sr.resistances[1]?.price??fib.levels.find(x=>x.ratio===0)?.price??null,
      neutralRangeLow:nextSupport,
      neutralRangeHigh:nextResistance,
      bearishTrigger:nextSupport,
      bearishObjective:sr.supports[1]?.price??fib.levels.find(x=>x.ratio===1)?.price??null,
      note:'Scenario levels are technical reference levels, not guaranteed forecasts.'
    };

    const m=mm.get(q)||{};
    return res.status(200).json({
      success:true,
      schemaVersion:'astra-technical-analysis/v1',
      ticker:q,name:m.name_en||m.name_ar||q,session:doc.lastSession||history.source?.expectedSession||null,
      delayed:market.source?.delayed===true,researchOnly:true,automaticExecution:false,
      bars:rows,
      indicators:{last:r(current,4),sma20:r(sma20,4),sma50:r(sma50,4),ema20:r(ema20,4),rsi14:r(rsi14,1),atr14:r(atr14,4),atrPct:current&&atr14?r(100*atr14/current,2):null},
      fibonacci:fib,
      channel,
      supportResistance:sr,
      technicalAssessment:analysis,
      scenario,
      astraContext:op?{
        stage:op.stage,finalDecisionScore:n(op.finalDecisionScore),grade:op.finalDecisionGrade||null,entryQuality:op.entryQuality||null,
        decisionGate:op.decisionGate||null,entryLow:n(op.entryLow),entryHigh:n(op.entryHigh),stop:n(op.stop),target1:n(op.target1),target2:n(op.target2),
        monitoringState:op.monitoringState||null,sector:op.sector||null,sectorStrengthScore:n(op.sectorStrengthScore),riskBudgetPct:n(op.riskBudgetPct)
      }:null
    });
  }catch(err){
    return res.status(200).json({success:false,error:err?.message||'TECHNICAL_ANALYSIS_ERROR'});
  }
}
module.exports=handler;
