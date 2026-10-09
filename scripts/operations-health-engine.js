'use strict';
const fs=require('fs'),path=require('path');
const {evaluateOperations}=require('./lib/operations-health');

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}

const pkg=read('package.json',{version:'unknown'});
const cockpit=read('data/decision-cockpit.json',{});
const payload=evaluateOperations({
  cockpit,
  market:read('data/canonical-market.json',{}),
  history:read('data/history-index.json',{}),
  sourceHealth:read('data/source-health.json',cockpit.sourceHealthEngine||{}),
  prediction:read('data/prediction-ledger.json',{}),
  eventLedger:read('data/evidence-event-ledger.json',{}),
  replay:read('data/replay/index.json',{}),
  walkForward:read('data/walk-forward-validation.json',cockpit.walkForwardValidationEngine||{}),
  governance:read('data/model-governance.json',cockpit.modelGovernanceEngine||{}),
  quantStatus:read('quant/data/daily-data-update-status.json',{}),
  packageVersion:pkg.version
});
write('data/operations-health.json',payload);
write('docs/data/operations-health.json',payload);
cockpit.operationsHealthEngine=payload;
write('data/decision-cockpit.json',cockpit);
write('docs/data/decision-cockpit.json',cockpit);

if(process.argv.includes('--summary')){
  console.log('## ASTRA Operations Health');
  console.log('');
  console.log('- Overall: **'+payload.overall+'**');
  console.log('- Session: `'+(payload.session||'UNKNOWN')+'`');
  console.log('- Checks: '+payload.summary.pass+' PASS · '+payload.summary.warn+' WARN · '+payload.summary.fail+' FAIL · '+payload.summary.info+' INFO');
  console.log('- Active issue candidates: '+payload.summary.activeIssueCandidates);
  console.log('- Automatic execution: **OFF**');
  console.log('');
  console.log('| Check | Status | Detail |');
  console.log('|---|---|---|');
  for(const x of payload.checks)console.log('| '+x.id+' | '+x.status+' | '+String(x.detail).replaceAll('|','/')+' |');
}else{
  console.log(JSON.stringify({overall:payload.overall,session:payload.session,summary:payload.summary,activeIssues:payload.issueCandidates.filter(x=>x.active).map(x=>x.key)},null,2));
}
