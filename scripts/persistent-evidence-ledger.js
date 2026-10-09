'use strict';
const fs=require('fs'),path=require('path');
const {updateEventLedger}=require('./lib/evidence-event-store');
const EVID='data/prospective-evidence.json';
const OUT='data/evidence-event-ledger.json';
const DOC='docs/data/evidence-event-ledger.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}

const evidence=read(EVID,{records:[]});
const existing=read(OUT,{schemaVersion:'astra-evidence-event-ledger/v1',records:[]});
const observedAt=new Date().toISOString();
const ledger=updateEventLedger(existing,evidence.records||[],observedAt);
ledger.researchOnly=true;
ledger.automaticExecution=false;
write(OUT,ledger);write(DOC,ledger);
console.log(JSON.stringify({records:ledger.records.length,captureEvents:ledger.captureEvents,outcomeEvents:ledger.outcomeEvents,chain:ledger.chain.status},null,2));
