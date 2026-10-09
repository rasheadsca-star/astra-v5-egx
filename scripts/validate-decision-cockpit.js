'use strict';
const fs=require('fs');
function fail(m){console.error('COCKPIT_VALIDATION_FAILED',m);process.exit(1)}
const p='data/decision-cockpit.json';
if(!fs.existsSync(p))fail('OUTPUT_MISSING');
const d=JSON.parse(fs.readFileSync(p,'utf8'));
if(d.schemaVersion!=='astra-decision-cockpit/v1')fail('SCHEMA');
if(d.safety?.executionAllowed!==false||d.safety?.automaticOrders!==false)fail('EXECUTION_GATE');
if(!Array.isArray(d.topOpportunities))fail('TOP_ARRAY');
for(const x of d.topOpportunities){
  if(!(Number.isFinite(Number(x.conviction))&&x.conviction>=0&&x.conviction<=100))fail('CONVICTION:'+x.ticker);
  if((x.engineFamilies||[]).filter(z=>z==='NEXT_QUANT').length>1)fail('DOUBLE_COUNT_QUANT_FAMILY:'+x.ticker);
  if(x.stage==='ENTRY_READY'){
    if(x.engines?.confluenceV2?.state!=='ENTRY_READY')fail('READY_SOURCE_MISMATCH:'+x.ticker);
    if(!(Number(x.riskPct)>0&&Number(x.riskPct)<=8))fail('READY_RISK:'+x.ticker);
    if(!(Number(x.rrT2)>=2))fail('READY_RR:'+x.ticker);
  }
}
if(d.dataHealth?.executionAllowed!==false)fail('HEALTH_EXECUTION');
console.log(JSON.stringify({ok:true,session:d.session,counts:d.counts,top:d.topOpportunities.slice(0,5).map(x=>({ticker:x.ticker,stage:x.stage,conviction:x.conviction}))},null,2));
