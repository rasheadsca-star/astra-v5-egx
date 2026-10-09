'use strict';

const fs=require('fs'),path=require('path');
const {n,r,mean,ema,rsi,atr,linreg,pivots,clusterLevels,assess}=require('../../scripts/lib/technical-indicators');
const ROOT=path.join(__dirname,'../..');
function read(rel,fallback){try{return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'))}catch{return fallback}}

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
    const sr=clusterLevels(pivots(rows.slice(-90)),current);
    const analysis=assess({close:current,sma20,sma50,rsi14,channelSlopePct:channel?.slopePctPerSession});
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
