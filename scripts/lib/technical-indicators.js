'use strict';

function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null}
function r(v,d=2){return Number.isFinite(v)?+v.toFixed(d):null}
function mean(a){const x=(a||[]).filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function std(a){const x=(a||[]).filter(Number.isFinite);if(x.length<2)return null;const m=mean(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)*(v-m),0)/(x.length-1))}
function ema(vals,period){if(!vals.length)return[];const k=2/(period+1);let e=vals[0];return vals.map((v,i)=>i===0?e:(e=v*k+e*(1-k)))}
function rsi(vals,period=14){
  if(vals.length<=period)return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=vals[i]-vals[i-1];if(d>=0)gain+=d;else loss-=d}
  gain/=period;loss/=period;
  for(let i=period+1;i<vals.length;i++){
    const d=vals[i]-vals[i-1];
    gain=(gain*(period-1)+Math.max(d,0))/period;
    loss=(loss*(period-1)+Math.max(-d,0))/period;
  }
  if(loss===0)return 100;
  return 100-100/(1+gain/loss);
}
function atr(rows,period=14){
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
function pivots(rows){
  const pts=[];
  for(let i=2;i<rows.length-2;i++){
    const h=n(rows[i].high),l=n(rows[i].low);if(h==null||l==null)continue;
    const ph=[-2,-1,1,2].every(k=>h>=n(rows[i+k].high));
    const pl=[-2,-1,1,2].every(k=>l<=n(rows[i+k].low));
    if(ph)pts.push({type:'R',price:h,date:rows[i].date});
    if(pl)pts.push({type:'S',price:l,date:rows[i].date});
  }
  return pts;
}
function clusterLevels(points,current,tolerance=0.018,maxEach=3){
  const sorted=points.slice().sort((a,b)=>a.price-b.price),groups=[];
  for(const p of sorted){
    const g=groups.at(-1);
    if(g&&Math.abs(p.price-g.avg)/g.avg<=tolerance){g.items.push(p);g.avg=mean(g.items.map(x=>x.price))}
    else groups.push({avg:p.price,items:[p]});
  }
  const levels=groups.map(g=>({price:r(g.avg,4),touches:g.items.length,type:g.avg<=current?'SUPPORT':'RESISTANCE'}));
  return {
    supports:levels.filter(x=>x.type==='SUPPORT').sort((a,b)=>b.price-a.price).slice(0,maxEach),
    resistances:levels.filter(x=>x.type==='RESISTANCE').sort((a,b)=>a.price-b.price).slice(0,maxEach)
  };
}
function assess({close,sma20,sma50,rsi14,channelSlopePct}){
  let score=50;const reasons=[];
  if(close!=null&&sma20!=null){if(close>sma20){score+=10;reasons.push('PRICE_ABOVE_SMA20')}else{score-=10;reasons.push('PRICE_BELOW_SMA20')}}
  if(sma20!=null&&sma50!=null){if(sma20>sma50){score+=12;reasons.push('SMA20_ABOVE_SMA50')}else{score-=12;reasons.push('SMA20_BELOW_SMA50')}}
  if(channelSlopePct!=null){if(channelSlopePct>0.12){score+=12;reasons.push('RISING_PRICE_CHANNEL')}else if(channelSlopePct<-0.12){score-=12;reasons.push('FALLING_PRICE_CHANNEL')}}
  if(rsi14!=null){if(rsi14>=55&&rsi14<=72){score+=7;reasons.push('RSI_POSITIVE')}else if(rsi14>75){score-=5;reasons.push('RSI_OVERBOUGHT')}else if(rsi14<35){score-=7;reasons.push('RSI_WEAK')}}
  score=Math.max(0,Math.min(100,score));
  return {score:r(score,1),outlook:score>=68?'BULLISH_BIAS':score<=38?'BEARISH_BIAS':'NEUTRAL_MIXED',reasons};
}

module.exports={n,r,mean,std,ema,rsi,atr,linreg,pivots,clusterLevels,assess};
