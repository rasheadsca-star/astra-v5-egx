'use strict';

const fs=require('fs'),path=require('path');
const {summarize}=require('./lib/source-health');

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}

const history=read('data/history-index.json',null);
const market=read('data/canonical-market.json',null);
const quant=read('quant/data/daily-data-update-status.json',{});
const registry=read('config/data-source-registry.json',null);
if(!history||!market||!registry)throw new Error('SOURCE_HEALTH_INPUT_MISSING');

const payload=summarize(history,market,quant,registry);
payload.sources=(registry.sources||[]).map(s=>({
  id:s.id,role:s.role,enabled:s.enabled===true,independentVerifier:s.independentVerifier===true,
  complianceStatus:s.complianceStatus||null,currentUse:s.currentUse||null
}));
payload.sourcePolicy=registry.policy;

write('data/source-health.json',payload);
write('docs/data/source-health.json',payload);

const cockpit=read('data/decision-cockpit.json',null);
if(cockpit){
  cockpit.sourceHealthEngine=payload;
  cockpit.dataHealth=cockpit.dataHealth||{};
  cockpit.dataHealth.activeCoveragePct=payload.coverage.activeCoveragePct;
  cockpit.dataHealth.activeStaleSymbols=payload.coverage.staleActiveSymbols;
  cockpit.dataHealth.sourceFailedSymbols=payload.coverage.sourceFailedSymbols;
  cockpit.dataHealth.independentSourceQuorum=payload.independentVerification.quorumMet;
  write('data/decision-cockpit.json',cockpit);
  write('docs/data/decision-cockpit.json',cockpit);
}
console.log(JSON.stringify({
  expectedSession:payload.expectedSession,
  coverage:payload.coverage,
  independentVerification:payload.independentVerification,
  crossStoreConsistency:payload.crossStoreConsistency
},null,2));
