'use strict';

function num(v){const x=Number(v);return Number.isFinite(x)?x:null}

function allocateCappedWeights(items,{maxSingleWeightPct=30,lowLiquidityCapPct=15,lowLiquidityThreshold=40}={}){
  const rows=(items||[]).map((x,i)=>({
    index:i,
    score:Math.max(1,num(x.portfolioSelectionScore)||1),
    cap:(num(x.liquidityContextScore)??50)<lowLiquidityThreshold?lowLiquidityCapPct:maxSingleWeightPct,
    weight:0
  }));
  let remaining=100;
  let active=rows.slice();
  let guard=0;

  while(active.length&&remaining>0.0001&&guard++<50){
    const totalScore=active.reduce((s,x)=>s+x.score,0);
    if(totalScore<=0)break;
    const capped=[];
    for(const x of active){
      const share=remaining*x.score/totalScore;
      if(share>x.cap+1e-9)capped.push(x);
    }
    if(!capped.length){
      for(const x of active)x.weight=remaining*x.score/totalScore;
      remaining=0;
      break;
    }
    for(const x of capped){
      x.weight=x.cap;
      remaining-=x.cap;
    }
    active=active.filter(x=>!capped.includes(x));
    if(remaining<0)remaining=0;
  }

  const weights=rows.map(x=>Math.max(0,Math.min(x.cap,x.weight)));
  const allocatedPct=weights.reduce((s,x)=>s+x,0);
  return {
    weights,
    allocatedPct,
    unallocatedPct:Math.max(0,100-allocatedPct)
  };
}

module.exports={allocateCappedWeights};
