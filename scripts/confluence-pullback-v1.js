'use strict';

const fs=require('fs'), path=require('path');
const ROOT=process.cwd();
const HIST=path.join(ROOT,'quant/data/history');
const OUT=path.join(ROOT,'data/confluence/signals.json');
const DOC=path.join(ROOT,'docs/data/confluence-signals.json');
const LEDGER=path.join(ROOT,'data/confluence/forward-ledger.json');
const SOURCE_REPO='rasheadsca-star/RAS-EGX-PRO2026-NEXT';

function read(p){return JSON.parse(fs.readFileSync(p,'utf8'))}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function avg(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:null}
function pct(a,b){return b?((a/b)-1)*100:null}
function near(a,b,tolPct){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)/Math.max(Math.abs(b),1e-9)*100<=tolPct}
function sma(rows,n){const a=rows.slice(-n).map(x=>Number(x.close)).filter(Number.isFinite);return a.length===n?avg(a):null}
function atr(rows,n=14){
  if(rows.length<n+1)return null; const x=[];
  for(let i=rows.length-n;i<rows.length;i++){const r=rows[i],p=rows[i-1];x.push(Math.max(r.high-r.low,Math.abs(r.high-p.close),Math.abs(r.low-p.close)))}
  return avg(x);
}
function avwap(rows,start){
  let pv=0,v=0;
  for(let i=start;i<rows.length;i++){const r=rows[i],vol=Number(r.volume)||0,tp=(Number(r.high)+Number(r.low)+Number(r.close))/3;if(vol>0&&Number.isFinite(tp)){pv+=tp*vol;v+=vol}}
  return v?pv/v:null;
}
function support(rows,current){
  const old=rows.slice(Math.max(0,rows.length-70),Math.max(0,rows.length-5));
  if(!old.length)return null;
  const lows=old.map(x=>Number(x.low)).filter(Number.isFinite).sort((a,b)=>Math.abs(a-current)-Math.abs(b-current));
  return lows[0]??null;
}
function reaction(rows){
  if(rows.length<2)return {ok:false,type:'NONE'};
  const a=rows.at(-1),p=rows.at(-2);
  const range=Math.max(1e-9,a.high-a.low);
  const bullish=a.close>a.open && (a.close-a.low)/range>=0.65;
  const engulf=a.close>p.open && a.open<=p.close && a.close>a.open;
  return {ok:bullish||engulf,type:engulf?'BULLISH_ENGULFING':bullish?'BULLISH_REJECTION':'NONE'};
}
function findImpulse(rows){
  const start=Math.max(0,rows.length-120); let best=null;
  for(let i=start;i<rows.length-10;i++){
    const lo=Number(rows[i].low); if(!Number.isFinite(lo))continue;
    for(let j=i+5;j<rows.length;j++){
      const hi=Number(rows[j].high); if(!Number.isFinite(hi)||hi<=lo)continue;
      const gain=pct(hi,lo);
      if(gain<18)continue;
      if(!best||gain>best.gain)best={i,j,low:lo,high:hi,gain};
    }
  }
  return best;
}
async function githubJson(file){
  const u='https://api.github.com/repos/'+SOURCE_REPO+'/contents/'+file+'?ref=main&fresh='+Date.now();
  const h={Accept:'application/vnd.github.raw+json','Cache-Control':'no-cache','User-Agent':'ASTRA-CONFLUENCE/1.0'};
  if(process.env.GITHUB_TOKEN)h.Authorization='Bearer '+process.env.GITHUB_TOKEN;
  const r=await fetch(u,{headers:h}); if(!r.ok)throw new Error('GITHUB_'+r.status+':'+file); return JSON.parse(await r.text());
}
function profitableMap(input){
  const m=new Map();
  for(const c of input.companies||[]){
    const periods=(c.periods||[]).filter(x=>x.comparable!==false&&Number.isFinite(Number(x.netProfit))).sort((a,b)=>String(a.periodEnd).localeCompare(String(b.periodEnd)));
    const last=periods.at(-1);
    m.set(c.ticker,{verified:!!last,profitable:!!last&&Number(last.netProfit)>0,netProfit:last?Number(last.netProfit):null,period:last?.periodEnd||null,sourceConfidence:c.sourceConfidence||null});
  }
  return m;
}
(async()=>{
  const market=read('data/canonical-market.json');
  const status=read('quant/data/daily-data-update-status.json');
  const holidays=read('quant/config/holidays.json');
  const expected=status.expectedSession||market.source?.expectedSession;
  const isHoliday=holidays.some(x=>typeof x==='string'?x===expected:(x?.market==='EGX'&&x?.date===expected));
  const session=market.source?.expectedSession||null;
  if(!session)throw new Error('CONFLUENCE_SESSION_MISSING');
  if(!isHoliday && expected && session!==expected)throw new Error('CONFLUENCE_FAIL_CLOSED_SESSION_MISMATCH:'+session+'!='+expected);

  const fundamentals=profitableMap(await githubJson('data/v17/historical-recovery/fundamentals/verified-input.json'));
  const files=fs.readdirSync(HIST).filter(x=>x.endsWith('.json')&&!x.startsWith('.'));
  const all=[];
  for(const file of files){
    let h; try{h=read(path.join(HIST,file))}catch{continue}
    let rows=(h.sessions||[]).filter(x=>x.date<=session).map(x=>({date:x.date,open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Number(x.volume)||0})).filter(x=>[x.open,x.high,x.low,x.close].every(Number.isFinite));
    if(rows.length<60||rows.at(-1)?.date!==session)continue;
    const ticker=h.ticker||file.replace('.json',''), current=rows.at(-1), imp=findImpulse(rows);
    if(!imp)continue;
    const range=imp.high-imp.low, fib618=imp.high-range*0.618, fib786=imp.high-range*0.786;
    const zoneLow=Math.min(fib618,fib786),zoneHigh=Math.max(fib618,fib786);
    const inFib=current.close>=zoneLow*0.98&&current.close<=zoneHigh*1.02;
    const correction=((imp.high-current.close)/imp.high)*100;
    const ma50=sma(rows,50), ma50Hit=near(current.close,ma50,3);
    const vw=avwap(rows,imp.i),vwapHit=near(current.close,vw,3);
    const sup=support(rows,current.close),supportHit=near(current.close,sup,3);
    const react=reaction(rows);
    const v20=avg(rows.slice(-21,-1).map(x=>x.volume).filter(Number.isFinite))||0;
    const volRatio=v20?current.volume/v20:null,volOk=Number.isFinite(volRatio)&&volRatio>=1.2;
    const f=fundamentals.get(ticker)||{verified:false,profitable:false,netProfit:null,period:null};
    const a=atr(rows,14);

    let score=0; const factors=[];
    if(f.profitable){score+=15;factors.push('PROFITABLE_VERIFIED')}
    if(inFib){score+=15;factors.push('FIB_61_8_78_6')}
    if(vwapHit){score+=15;factors.push('ANCHORED_VWAP')}
    if(ma50Hit){score+=10;factors.push('DAILY_MA50')}
    // HOURLY_MA100 intentionally unavailable: no points awarded.
    if(supportHit){score+=10;factors.push('PRIOR_SUPPORT')}
    if(correction>=30&&correction<=38){score+=10;factors.push('CORRECTION_30_38')}
    else if(correction>=25&&correction<=45){score+=5;factors.push('CORRECTION_NEAR_TARGET')}
    if(react.ok){score+=8;factors.push('PRICE_REACTION')}
    if(volOk){score+=7;factors.push('VOLUME_CONFIRMATION')}

    const setup=inFib&&vwapHit&&(ma50Hit||supportHit);
    let state='REJECTED';
    if(!f.verified)state='FUNDAMENTALS_MISSING';
    else if(!f.profitable)state='FUNDAMENTALS_FAIL';
    else if(setup&&!react.ok)state='WAITING_FOR_REACTION';
    else if(setup&&react.ok&&score>=65)state='ENTRY_CONFIRMED';
    else if(score>=50)state='WATCH';

    const structuralBase=Math.min(zoneLow,sup??zoneLow);
    const invalidation=Number.isFinite(a)?structuralBase-0.5*a:structuralBase*0.97;
    const entryLow=Math.min(current.close,zoneHigh),entryHigh=Math.max(current.close,zoneLow);
    all.push({
      ticker,session,state,score,actionable:state==='ENTRY_CONFIRMED',
      close:+current.close.toFixed(4),
      entryLow:+Math.min(entryLow,entryHigh).toFixed(4),entryHigh:+Math.max(entryLow,entryHigh).toFixed(4),
      structuralInvalidation:+invalidation.toFixed(4),
      targets:{t1:+(current.close*1.08).toFixed(4),t2:+(current.close*1.15).toFixed(4),t3:+(current.close*1.22).toFixed(4),t4:+(current.close*1.30).toFixed(4)},
      confluence:{
        fib618:+fib618.toFixed(4),fib786:+fib786.toFixed(4),inFib,
        anchoredVwap:vw?+vw.toFixed(4):null,vwapHit,
        dailyMa50:ma50?+ma50.toFixed(4):null,ma50Hit,
        hourlyMa100:null,hourlyMa100Status:'NOT_AVAILABLE_NO_INTRADAY_1H_SOURCE',
        priorSupport:sup?+sup.toFixed(4):null,supportHit,
        correctionPct:+correction.toFixed(2),reaction:react,volumeRatio:volRatio?+volRatio.toFixed(2):null,volumeConfirmed:volOk,
        fundamentals:f
      },
      impulse:{startDate:rows[imp.i].date,peakDate:rows[imp.j].date,low:+imp.low.toFixed(4),high:+imp.high.toFixed(4),risePct:+imp.gain.toFixed(2)},
      factors,
      researchOnly:true,executionAllowed:false
    });
  }
  all.sort((a,b)=>b.score-a.score||a.ticker.localeCompare(b.ticker));
  const top=all.slice(0,30),actionable=top.filter(x=>x.actionable);
  const payload={
    schemaVersion:'astra-confluence-pullback/v1',
    engine:'CONFLUENCE_PULLBACK_V1',
    generatedAt:new Date().toISOString(),
    session,expectedSession:expected,
    marketStatus:isHoliday?'MARKET_HOLIDAY':'TRADING_SESSION',
    holiday:isHoliday?{date:expected,market:'EGX'}:null,
    methodology:{
      philosophy:'MULTI_FACTOR_CONFLUENCE_PULLBACK',
      fib:'61.8%-78.6% retracement of detected impulse',
      anchoredVwap:'daily OHLCV typical-price VWAP anchored at impulse start',
      reactionRequired:true,
      verifiedProfitabilityHardGate:true,
      hourlyMa100:'NOT_SCORED_UNTIL_VERIFIED_1H_SOURCE_EXISTS',
      risk:'STRUCTURAL_INVALIDATION_REQUIRED_NO_NO_STOP_MODE',
      scaleOut:'+8%, +15%, +22%, +30%'
    },
    permissions:{researchOnly:true,executionAllowed:false,automaticOrders:false,automaticPromotion:false},
    counts:{scanned:all.length,published:top.length,actionable:actionable.length},
    recommendations:actionable,
    watchlist:top.filter(x=>!x.actionable),
    allTop:top
  };
  write(OUT,payload);write(DOC,payload);

  let ledger={schemaVersion:'astra-confluence-forward/v1',records:[]};
  if(fs.existsSync(LEDGER)){try{ledger=read(LEDGER)}catch{}}
  ledger.records=Array.isArray(ledger.records)?ledger.records:[];
  if(!ledger.records.some(x=>x.session===session)){
    ledger.records.push({session,capturedAt:payload.generatedAt,marketStatus:payload.marketStatus,recommendations:actionable.map(x=>({ticker:x.ticker,entryLow:x.entryLow,entryHigh:x.entryHigh,structuralInvalidation:x.structuralInvalidation,targets:x.targets,score:x.score,state:'FROZEN'}))});
  }
  write(LEDGER,ledger);
  console.log(JSON.stringify({session,expected,marketStatus:payload.marketStatus,scanned:all.length,top:top.slice(0,10).map(x=>({ticker:x.ticker,score:x.score,state:x.state})),actionable:actionable.map(x=>x.ticker)},null,2));
})().catch(e=>{console.error(e);process.exit(1)});
