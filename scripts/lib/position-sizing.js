'use strict';

function num(v){const x=Number(v);return Number.isFinite(x)?x:null}

function sizeByRiskAndExposure({capital,riskPct,entry,stopDistance,maxPositionPct}){
  const C=num(capital),R=num(riskPct),E=num(entry),D=num(stopDistance),M=num(maxPositionPct);
  if(!(C>0)||!(R>0)||!(E>0)||!(D>0)||!(M>0)){
    return {shares:0,positionValue:0,maxLossAtStop:0,sharesByRisk:0,sharesByExposure:0};
  }
  const sharesByRisk=Math.max(0,Math.floor((C*R/100)/D));
  const sharesByExposure=Math.max(0,Math.floor((C*M/100)/E));
  const shares=Math.max(0,Math.min(sharesByRisk,sharesByExposure));
  return {
    shares,
    positionValue:shares*E,
    maxLossAtStop:shares*D,
    sharesByRisk,
    sharesByExposure
  };
}
module.exports={sizeByRiskAndExposure};
