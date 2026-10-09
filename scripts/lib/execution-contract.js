'use strict';

const fs=require('fs');
const path=require('path');

const DEFAULT_SPEC=JSON.parse(fs.readFileSync(path.join(process.cwd(),'config/execution-contract.json'),'utf8'));

function num(v){const x=Number(v);return Number.isFinite(x)?x:null}

function evaluatePlan(input,spec=DEFAULT_SPEC){
  const bars=input.bars||[];
  const i=Number(input.signalIndex??0);
  const H=Number(spec.plan.holdingHorizonSessions);
  const cost=Number(spec.plan.roundTripCostRate);
  const frac=Number(spec.plan.target1Fraction);
  const limit=Number(spec.limitDown.nominalPct);
  const tol=Number(spec.limitDown.lockDetectionTolerancePct);
  const ref=num(input.referenceClose);
  const entryLow=num(input.entryLow)??ref*(1-Number(spec.entry.referenceZonePct));
  const entryHigh=num(input.entryHigh)??ref*(1+Number(spec.entry.referenceZonePct));
  const stop=num(input.stop),t1=num(input.target1),t2=num(input.target2);

  if(!(ref>0)||!(entryLow>0)||!(entryHigh>0)||!(stop>0)||!(t1>0)||!(t2>0))throw new Error('EXECUTION_CONTRACT_INVALID_LEVELS');
  if(i+1>=bars.length)return {status:'open',e:null,hit1:null,hit2:null,ret:null,xeq:null,end:null,locked:false,reason:'NO_NEXT_SESSION_BAR'};

  const entryBar=i+1;
  const e=num(bars[entryBar].open);
  if(e==null)return {status:'invalid',e:null,hit1:null,hit2:null,ret:null,xeq:null,end:bars[entryBar].date||null,locked:false,reason:'ENTRY_OPEN_MISSING'};
  if(e<entryLow||e>entryHigh)return {status:'unfilled',e:null,hit1:null,hit2:null,ret:null,xeq:null,end:bars[entryBar].date||null,locked:false,reason:'NEXT_OPEN_OUTSIDE_ENTRY_ZONE'};

  let x1=null,hit1=0,end1=null,locked=false,firstExitType=null;
  for(let j=entryBar;j<Math.min(i+1+H,bars.length);j++){
    const b=bars[j],o=num(b.open),h=num(b.high),l=num(b.low),c=num(b.close);
    let stopHit=false;
    if(j>entryBar){
      if(o<=stop){x1=o;stopHit=true;firstExitType='STOP_GAP'}
      else if(o>=t1){x1=o;hit1=1;end1=b.date;firstExitType='TARGET1_GAP';break}
    }
    if(!stopHit){
      if(l<=stop){x1=stop;stopHit=true;firstExitType='STOP'}
      else if(h>=t1){x1=t1;hit1=1;end1=b.date;firstExitType='TARGET1';break}
    }
    if(stopHit){
      end1=b.date;
      const prevClose=num(bars[j-1]?.close);
      if(prevClose!=null&&c!=null&&c<=prevClose*(1-limit+tol)){
        locked=true;firstExitType='STOP_LOCK_NEXT_OPEN';
        if(j+1<bars.length){x1=num(bars[j+1].open);end1=bars[j+1].date}
        else x1=c;
      }
      break;
    }
  }

  if(x1==null){
    if(i+H<bars.length){x1=num(bars[i+H].close);end1=bars[i+H].date;firstExitType='TIME_EXIT'}
    else return {status:'open',e,hit1:null,hit2:null,ret:null,xeq:null,end:null,locked:false,reason:'HORIZON_INCOMPLETE'};
  }

  if(hit1===0){
    return {status:'closed',e,hit1:0,hit2:0,ret:x1/e-1-cost,xeq:x1,end:end1,locked,firstExitType,firstExitAt:end1,secondExitType:null,secondExitAt:null,reason:firstExitType};
  }

  const j0=bars.findIndex(b=>String(b.date)===String(end1));
  let ex2=null,hit2=0,end2=null,secondExitType=null;
  if(j0>entryBar&&num(bars[j0].open)>=t2){
    ex2=num(bars[j0].open);hit2=1;end2=bars[j0].date;secondExitType='TARGET2_GAP_SAME_T1_SESSION';
  }else{
    for(let j=j0+1;j<Math.min(i+1+H,bars.length);j++){
      const b=bars[j],o=num(b.open),h=num(b.high),l=num(b.low);
      if(o<=e){ex2=o;end2=b.date;secondExitType='BREAKEVEN_GAP';break}
      if(l<=e){ex2=e;end2=b.date;secondExitType='BREAKEVEN';break}
      if(o>=t2){ex2=o;hit2=1;end2=b.date;secondExitType='TARGET2_GAP';break}
      if(h>=t2){ex2=t2;hit2=1;end2=b.date;secondExitType='TARGET2';break}
    }
    if(ex2==null){
      if(i+H<bars.length){ex2=num(bars[i+H].close);end2=bars[i+H].date;secondExitType='TIME_EXIT'}
      else return {status:'open',e,hit1:1,hit2:null,ret:null,xeq:null,end:null,locked:false,reason:'HORIZON_INCOMPLETE_AFTER_T1'};
    }
  }
  const gross=frac*(x1/e-1)+(1-frac)*(ex2/e-1);
  return {status:'closed',e,hit1:1,hit2,ret:gross-cost,xeq:e*(1+gross),end:end2,locked:false,firstExitType,firstExitAt:end1,secondExitType,secondExitAt:end2,reason:secondExitType};
}

module.exports={evaluatePlan,DEFAULT_SPEC};
