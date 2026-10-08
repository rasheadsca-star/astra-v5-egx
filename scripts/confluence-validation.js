'use strict';
const fs=require('fs');
function fail(m){console.error('CONFLUENCE_VALIDATION_FAILED',m);process.exit(1)}
const p='data/confluence/signals.json';
if(!fs.existsSync(p))fail('OUTPUT_MISSING');
const d=JSON.parse(fs.readFileSync(p,'utf8'));
if(d.schemaVersion!=='astra-confluence-pullback/v1')fail('SCHEMA');
if(d.engine!=='CONFLUENCE_PULLBACK_V1')fail('ENGINE');
if(d.permissions?.executionAllowed!==false)fail('EXECUTION_MUST_BE_FALSE');
if(d.permissions?.researchOnly!==true)fail('RESEARCH_ONLY_REQUIRED');
if(!d.session)fail('SESSION_MISSING');
if(d.marketStatus==='MARKET_HOLIDAY'&&!d.holiday?.date)fail('HOLIDAY_METADATA_MISSING');
for(const x of d.recommendations||[]){
  if(x.state!=='ENTRY_CONFIRMED'||x.actionable!==true)fail('BAD_ACTIONABLE_STATE:'+x.ticker);
  if(!(x.score>=65))fail('SCORE_GATE:'+x.ticker);
  if(x.confluence?.fundamentals?.profitable!==true||x.confluence?.fundamentals?.verified!==true)fail('FUNDAMENTAL_GATE:'+x.ticker);
  if(x.confluence?.reaction?.ok!==true)fail('REACTION_GATE:'+x.ticker);
  if(!(Number(x.structuralInvalidation)<Number(x.entryLow)))fail('INVALIDATION_NOT_BELOW_ENTRY:'+x.ticker);
  if(x.confluence?.hourlyMa100!==null||x.confluence?.hourlyMa100Status!=='NOT_AVAILABLE_NO_INTRADAY_1H_SOURCE')fail('INTRADAY_MUST_NOT_BE_INVENTED:'+x.ticker);
  if(x.executionAllowed!==false||x.researchOnly!==true)fail('ITEM_EXECUTION_GATE:'+x.ticker);
}
console.log(JSON.stringify({ok:true,session:d.session,marketStatus:d.marketStatus,scanned:d.counts?.scanned,actionable:d.counts?.actionable},null,2));
