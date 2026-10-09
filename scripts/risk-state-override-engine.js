'use strict';

const fs=require('fs'),path=require('path');
const {riskStatePolicy}=require('./lib/risk-state-policy');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function r(v,d=3){return Number.isFinite(v)?+v.toFixed(d):null}

const d=read(IN,null);
if(!d)throw new Error('decision cockpit missing');
const rb=d.riskBudgetEngine;
const mon=d.monitoringAlertsEngine;
if(!rb||!mon)throw new Error('V6.3 requires risk budget + monitoring engines');

const mmap=new Map((mon.rows||[]).map(x=>[x.ticker,x]));

const positions=(rb.positions||[]).map(p=>{
  const m=mmap.get(p.ticker)||null;
  const rule=riskStatePolicy(m);
  const theoreticalRisk=n(p.riskBudgetPct)||0;
  const theoreticalShares=n(p.referenceShares)||0;
  const theoreticalValue=n(p.referencePositionValue)||0;
  const theoreticalLoss=n(p.referenceMaxLossAtStop)||0;

  const actionableRisk=r(theoreticalRisk*rule.factor,3);
  const actionableShares=Math.floor(theoreticalShares*rule.factor);
  const actionableValue=r(theoreticalValue*rule.factor,2);
  const actionableLoss=r(theoreticalLoss*rule.factor,2);

  return {
    ...p,
    theoreticalRiskBudgetPct:theoreticalRisk,
    theoreticalReferenceShares:theoreticalShares,
    theoreticalReferencePositionValue:theoreticalValue,
    theoreticalReferenceMaxLossAtStop:theoreticalLoss,
    actionableRiskBudgetPct:actionableRisk,
    actionableReferenceShares:actionableShares,
    actionableReferencePositionValue:actionableValue,
    actionableReferenceMaxLossAtStop:actionableLoss,
    actionableNow:rule.allowed&&actionableShares>0,
    riskStateOverrideFactor:rule.factor,
    riskStateOverrideReason:rule.reason,
    monitoringState:m?.state||null,
    monitoringSeverity:m?.severity||null,
    monitoringAction:m?.action||null,
    status:rule.allowed&&actionableShares>0?'ACTIONABLE_SIZED':'THEORETICAL_ONLY_BLOCKED'
  };
});

const totalActionableRisk=r(positions.reduce((s,x)=>s+(n(x.actionableRiskBudgetPct)||0),0),3);
const totalActionableValue=r(positions.reduce((s,x)=>s+(n(x.actionableReferencePositionValue)||0),0),2);
const totalActionableLoss=r(positions.reduce((s,x)=>s+(n(x.actionableReferenceMaxLossAtStop)||0),0),2);

rb.version='risk-budget/v2-risk-state-aware';
rb.generatedAt=new Date().toISOString();
rb.positions=positions;
rb.totals={
  ...rb.totals,
  theoreticalRiskBudgetPct:rb.totals?.riskBudgetPct??r(positions.reduce((s,x)=>s+(n(x.theoreticalRiskBudgetPct)||0),0),3),
  theoreticalReferencePortfolioValue:rb.totals?.referencePortfolioValue??r(positions.reduce((s,x)=>s+(n(x.theoreticalReferencePositionValue)||0),0),2),
  theoreticalReferenceMaxLossAtStops:rb.totals?.referenceMaxLossAtStops??r(positions.reduce((s,x)=>s+(n(x.theoreticalReferenceMaxLossAtStop)||0),0),2),
  actionablePositions:positions.filter(x=>x.actionableNow).length,
  actionableRiskBudgetPct:totalActionableRisk,
  actionableReferencePortfolioValue:totalActionableValue,
  actionableReferenceMaxLossAtStops:totalActionableLoss
};
rb.policy={
  ...rb.policy,
  riskStateOverride:'ONLY_IN_ENTRY_ZONE_AND_GATE_PASSED_IS_ACTIONABLE',
  blockedStates:['STOP_HIT','NEAR_STOP','CHASE_RISK','GATE_BLOCKED','ABOVE_ENTRY_ZONE','SLIGHTLY_ABOVE_ENTRY','BELOW_ENTRY_ZONE','T1_HIT','T2_HIT','NO_CURRENT_PRICE'],
  automaticExecution:false
};
rb.note='Theoretical size is preserved for plan analysis. Actionable size is forced to zero unless the latest monitoring state is IN_ENTRY_ZONE and the Decision Gate passes. Near-stop/critical setups can never display a positive actionable new-entry size.';

d.riskStateOverrideEngine={
  version:'risk-state-override/v1',
  generatedAt:new Date().toISOString(),
  policy:rb.policy.riskStateOverride,
  positions:positions.map(x=>({
    ticker:x.ticker,
    monitoringState:x.monitoringState,
    monitoringSeverity:x.monitoringSeverity,
    theoreticalRiskBudgetPct:x.theoreticalRiskBudgetPct,
    actionableRiskBudgetPct:x.actionableRiskBudgetPct,
    theoreticalShares100k:x.theoreticalReferenceShares,
    actionableShares100k:x.actionableReferenceShares,
    actionableNow:x.actionableNow,
    reason:x.riskStateOverrideReason
  })),
  blockedCount:positions.filter(x=>!x.actionableNow).length,
  actionableCount:positions.filter(x=>x.actionableNow).length,
  researchOnly:true,
  automaticExecution:false
};

const pmap=new Map(positions.map(x=>[x.ticker,x]));
for(const group of ['topOpportunities','watchlist','rejected']){
  d[group]=(d[group]||[]).map(x=>{
    const p=pmap.get(x.ticker);
    if(!p)return x;
    return {
      ...x,
      theoreticalRiskBudgetPct:p.theoreticalRiskBudgetPct,
      actionableRiskBudgetPct:p.actionableRiskBudgetPct,
      theoreticalShares100k:p.theoreticalReferenceShares,
      actionableShares100k:p.actionableReferenceShares,
      actionablePositionValue100k:p.actionableReferencePositionValue,
      actionableMaxLoss100k:p.actionableReferenceMaxLossAtStop,
      actionableNow:p.actionableNow,
      riskStateOverrideReason:p.riskStateOverrideReason
    };
  });
}

write(IN,d);write(DOC,d);
console.log(JSON.stringify(d.riskStateOverrideEngine,null,2));
