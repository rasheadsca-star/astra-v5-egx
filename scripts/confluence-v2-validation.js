'use strict';
const fs=require('fs');
function fail(m){console.error('CONFLUENCE_V2_VALIDATION_FAILED',m);process.exit(1)}
const p='data/confluence-v2/signals.json';
if(!fs.existsSync(p))fail('OUTPUT_MISSING');
const d=JSON.parse(fs.readFileSync(p,'utf8'));
if(d.schemaVersion!=='astra-confluence-pullback/v2')fail('SCHEMA');
if(d.engine!=='CONFLUENCE_PULLBACK_V2')fail('ENGINE');
if(d.policy?.executionAllowed!==false||d.policy?.automaticOrders!==false)fail('EXECUTION_GATE');
for(const x of d.entryReady||[]){
  if(x.state!=='ENTRY_READY'||x.researchSignal!==true)fail('BAD_READY_STATE:'+x.ticker);
  if(!(x.score>=70))fail('SCORE:'+x.ticker);
  const f=x.dailyConfluence?.fundamentals||{};
  if(!(f.verified&&f.profitable))fail('FUNDAMENTALS:'+x.ticker);
  if(!x.dailyConfluence?.reaction?.ok)fail('REACTION:'+x.ticker);
  if(!x.dailyConfluence?.volumeConfirmed)fail('VOLUME:'+x.ticker);
  if(!(x.hourly?.available&&x.hourly?.sessionAligned&&x.hourly?.identityOk&&x.hourly?.currencyOk&&x.hourly?.hourlyMa100Hit))fail('HOURLY:'+x.ticker);
  if(!(Number(x.risk?.riskPct)>0&&Number(x.risk?.riskPct)<=8))fail('RISK:'+x.ticker);
  if(!(Number(x.risk?.rrT2)>=2))fail('RR:'+x.ticker);
  if(!(Number(x.structuralStop)<Number(x.entryLow)))fail('STOP:'+x.ticker);
  if(x.executionAllowed!==false)fail('ITEM_EXECUTION:'+x.ticker);
}
console.log(JSON.stringify({ok:true,session:d.session,entryReady:d.counts?.entryReady,watchlist:d.counts?.watchlist},null,2));
