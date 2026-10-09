'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const DOC='docs/data/decision-cockpit.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}

const d=read(IN,null);
if(!d) throw new Error('decision cockpit missing');

const freshnessOk=d.dataHealth?.stale===false && (n(d.dataHealth?.staleLagSessions)||0)===0;
const marketScore=n(d.marketSectorContextEngine?.market?.score);

function gate(x){
  const reasons=[];
  const rr=n(x.rrT2);
  const liq=n(x.liquidityContextScore);
  const final=n(x.finalDecisionScore);

  if(!freshnessOk) reasons.push('DATA_NOT_FRESH');
  if(x.entryQuality==='INVALIDATED') reasons.push('ENTRY_INVALIDATED');
  if(x.entryQuality==='CHASE_RISK') reasons.push('CHASE_RISK');
  if(x.entryQuality==='UNKNOWN') reasons.push('ENTRY_QUALITY_UNKNOWN');
  if(rr==null || rr<2) reasons.push('RR_BELOW_2');
  if(liq!=null && liq<40) reasons.push('LIQUIDITY_TOO_LOW');
  if(marketScore!=null && marketScore<25) reasons.push('MARKET_SAFETY_TOO_WEAK');
  if(final==null || final<62) reasons.push('FINAL_SCORE_BELOW_B');
  if(x.stage==='REJECTED_RISK') reasons.push('RISK_REJECTED');

  const pass=reasons.length===0;
  return {
    ...x,
    decisionGate:{
      pass,
      status:pass?'RESEARCH_ELIGIBLE':'BLOCKED',
      reasons
    }
  };
}

for(const group of ['topOpportunities','watchlist','rejected']){
  d[group]=(d[group]||[]).map(gate);
}

const all=[...(d.topOpportunities||[]),...(d.watchlist||[]),...(d.rejected||[])];
const eligible=all.filter(x=>x.decisionGate?.pass);
const blocked=all.length-eligible.length;

d.decisionGateEngine={
  version:'decision-gate/v1',
  generatedAt:new Date().toISOString(),
  rules:{
    dataFreshness:'stale=false and staleLagSessions=0',
    entryQuality:'not INVALIDATED, CHASE_RISK or UNKNOWN',
    minimumRR:2.0,
    minimumLiquidityScore:40,
    minimumMarketSafetyScore:25,
    minimumFinalDecisionScore:62,
    riskRejected:'blocked'
  },
  counts:{total:all.length,eligible:eligible.length,blocked},
  eligible:eligible
    .sort((a,b)=>(b.finalDecisionScore??-1)-(a.finalDecisionScore??-1))
    .slice(0,20)
    .map(x=>({ticker:x.ticker,grade:x.finalDecisionGrade,score:x.finalDecisionScore,entryQuality:x.entryQuality,rrT2:x.rrT2,contextScore:x.contextScore})),
  researchOnly:true,
  executionAllowed:false,
  automaticOrders:false
};

write(IN,d);write(DOC,d);
console.log(JSON.stringify(d.decisionGateEngine,null,2));
