'use strict';

const fs=require('fs');
const assert=require('assert');
const {classifySymbol,summarize}=require('./lib/source-health');

const exp='2026-10-07';
assert.deepStrictEqual(classifySymbol({lastSession:exp,staleData:false,updateFailed:false,warnings:[]},exp),
  {status:'CURRENT_VERIFIED',reason:'LAST_SESSION_MATCHES_EXPECTED',activeDenominator:true});
assert.strictEqual(classifySymbol({lastSession:'2026-10-06',warnings:[]},exp).status,'ACTIVE_STALE');
assert.strictEqual(classifySymbol({lastSession:'2026-01-01',updateFailed:true,warnings:[]},exp).status,'SOURCE_FAILED');
assert.strictEqual(classifySymbol({instrumentStatus:'suspended',lastSession:'2026-01-01',warnings:[]},exp).activeDenominator,false);
assert.strictEqual(classifySymbol({instrumentStatus:'inactive',lastSession:'2026-01-01',warnings:[]},exp).status,'DORMANT');
assert.strictEqual(classifySymbol({warnings:['delisting_notice'],lastSession:'2026-01-01'},exp).status,'DELISTED');

const history=JSON.parse(fs.readFileSync('data/history-index.json','utf8'));
const market=JSON.parse(fs.readFileSync('data/canonical-market.json','utf8'));
const quant=JSON.parse(fs.readFileSync('quant/data/daily-data-update-status.json','utf8'));
const registry=JSON.parse(fs.readFileSync('config/data-source-registry.json','utf8'));
const out=summarize(history,market,quant,registry);

assert.strictEqual(out.coverage.registeredSymbols,Object.keys(history.symbols||{}).length);
assert.strictEqual(out.coverage.activeDenominator,
  out.coverage.registeredSymbols-out.coverage.explicitInactiveSymbols,
  'Only explicit inactive evidence may shrink denominator.');
assert.strictEqual(out.independentVerification.quorumMet,false,'No independent verifier is enabled yet.');
assert.strictEqual(out.independentVerification.claimAllowed,false);
const yahoo=registry.sources.find(x=>x.id==='YAHOO_FINANCE_PUBLIC_WEB');
assert.ok(yahoo);
assert.strictEqual(yahoo.enabled,false);
assert.strictEqual(yahoo.automatedAccessAllowed,false);
assert.match(yahoo.complianceStatus,/BLOCKED/);

for(const t of out.lists.activeStale){
  assert.strictEqual(out.symbols[t].activeDenominator,true,'stale symbol was improperly removed from denominator: '+t);
}
for(const t of out.lists.sourceFailed){
  assert.strictEqual(out.symbols[t].activeDenominator,true,'source-failed symbol was improperly removed from denominator: '+t);
}

assert.strictEqual(out.symbols.NDRL?.status,'SOURCE_FAILED');
assert.strictEqual(out.symbols.SPHT?.status,'SOURCE_FAILED');
assert.ok(out.crossStoreConsistency.canonicalCurrentButQuantStale.includes('EFID'));
assert.ok(out.crossStoreConsistency.canonicalCurrentButQuantStale.includes('EXPA'));

console.log(JSON.stringify({
  ok:true,
  expectedSession:out.expectedSession,
  activeCoveragePct:out.coverage.activeCoveragePct,
  counts:out.counts,
  crossStoreConsistency:out.crossStoreConsistency,
  independentVerification:out.independentVerification
},null,2));
