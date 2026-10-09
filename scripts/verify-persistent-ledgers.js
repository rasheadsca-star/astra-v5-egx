'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {verifyChain:updateVerify}=require('./lib/evidence-event-store');
const {verifyCaptureHash,outcomeHash}=require('./lib/persistent-evidence');
const {dedupeEvidenceRecords,stableEvidenceKey}=require('./lib/evidence-dedupe');
const ROOT=process.cwd();

function read(p,fallback){try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return fallback}}
function hashText(s){return crypto.createHash('sha256').update(s).digest('hex')}
function stable(v){if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o}return v}
function objectHash(v){return hashText(JSON.stringify(stable(v)))}
function fail(msg){throw new Error('PERSISTENT_LEDGER_INTEGRITY: '+msg)}

const prediction=read('data/prediction-ledger.json',null);
const replay=read('data/replay/index.json',null);
const events=read('data/evidence-event-ledger.json',null);
const evidence=read('data/prospective-evidence.json',null);
const cockpit=read('data/decision-cockpit.json',null);
if(!prediction||!replay||!events||!evidence||!cockpit)fail('required persistent state missing');

let prev=null;
for(const rec of prediction.records||[]){
  const core={...rec};delete core.recordHash;
  if(objectHash(core)!==rec.recordHash)fail('prediction record hash mismatch '+rec.session);
  if((rec.previousRecordHash||null)!==(prev?.recordHash||null))fail('prediction chain link mismatch '+rec.session);
  prev=rec;
}
if((prediction.records||[]).length&&prediction.chain?.status!=='VERIFIED')fail('prediction ledger status not VERIFIED');

const eventCheck=updateVerify(events.records||[]);
if(!eventCheck.ok)fail('event chain broken '+JSON.stringify(eventCheck.errors));
if(events.chain?.status!=='VERIFIED')fail('event ledger status not VERIFIED');

const sessions=replay.sessions||[];
const seenSessions=new Set();
const snapshotHashes=new Set();
for(const item of sessions){
  if(seenSessions.has(item.session))fail('duplicate replay session '+item.session);
  seenSessions.add(item.session);
  const p=path.join(ROOT,'data/replay/sessions/'+item.session+'.json');
  if(!fs.existsSync(p))fail('missing replay snapshot '+item.session);
  const snap=JSON.parse(fs.readFileSync(p,'utf8'));
  const core={...snap};delete core.snapshotSha256;
  const h=objectHash(core);
  if(h!==snap.snapshotSha256)fail('snapshot hash mismatch '+item.session);
  if(h!==item.snapshotSha256)fail('replay index hash mismatch '+item.session);
  snapshotHashes.add(h);
}
for(const rec of prediction.records||[])if(!snapshotHashes.has(rec.snapshotSha256))fail('prediction ledger references missing snapshot '+rec.session);

const clean=dedupeEvidenceRecords((evidence.records||[]).filter(r=>r.excludedFromAnalytics!==true)).primary;
const captureEvents=new Map();
const lastOutcomeEvents=new Map();
for(const e of events.records||[]){
  if(e.type==='PREDICTION_CAPTURED'){
    if(captureEvents.has(e.evidenceKey))fail('duplicate capture event '+e.evidenceKey);
    captureEvents.set(e.evidenceKey,e);
  }
  if(e.type==='OUTCOME_STATE')lastOutcomeEvents.set(e.evidenceKey,e);
}
for(const r of clean){
  const key=stableEvidenceKey(r);
  const v=verifyCaptureHash(r);
  if(!v.ok)fail(v.reason+' '+key);
  const ce=captureEvents.get(key);
  if(!ce)fail('missing capture event '+key);
  if(ce.payloadHash!==r.captureHash)fail('capture event hash mismatch '+key);
  const oe=lastOutcomeEvents.get(key);
  if(!oe)fail('missing outcome event '+key);
  if(oe.payloadHash!==outcomeHash(r))fail('latest outcome event does not match materialized state '+key);
}

const currentSession=cockpit.session;
const pr=(prediction.records||[]).find(x=>x.session===currentSession);
const ri=sessions.find(x=>x.session===currentSession);
if(!pr||!ri)fail('current cockpit session is not persisted in prediction/replay ledgers: '+currentSession);

if(cockpit.safety?.automaticOrders!==false||cockpit.safety?.executionAllowed!==false)fail('execution safety invariant changed');
console.log(JSON.stringify({ok:true,currentSession,predictionRecords:(prediction.records||[]).length,replaySessions:sessions.length,evidenceRecords:clean.length,eventRecords:(events.records||[]).length},null,2));
