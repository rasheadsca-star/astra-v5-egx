'use strict';
const {objectHash,immutableEvidencePayload,captureHash,outcomePayload,outcomeHash,verifyCaptureHash}=require('./persistent-evidence');

function verifyChain(records){
  const errors=[];
  for(let i=0;i<(records||[]).length;i++){
    const rec=records[i],prev=i?records[i-1]:null;
    if((rec.previousRecordHash||null)!==(prev?.recordHash||null))errors.push({index:i,eventId:rec.eventId,error:'PREVIOUS_HASH_MISMATCH'});
    const core={...rec};delete core.recordHash;
    if(objectHash(core)!==rec.recordHash)errors.push({index:i,eventId:rec.eventId,error:'RECORD_HASH_MISMATCH'});
  }
  return {ok:errors.length===0,errors};
}
function appendEvent(records,core){
  const prev=records.at(-1)||null;
  const fullCore={...core,previousRecordHash:prev?.recordHash||null};
  const recordHash=objectHash(fullCore);
  records.push({...fullCore,recordHash});
}
function updateEventLedger(existing,evidenceRecords,observedAt){
  const ledger=existing&&Array.isArray(existing.records)?structuredClone(existing):{schemaVersion:'astra-evidence-event-ledger/v1',records:[]};
  const chain=verifyChain(ledger.records);
  if(!chain.ok)throw new Error('EVIDENCE_EVENT_LEDGER_CHAIN_BROKEN '+JSON.stringify(chain.errors));
  const captureByKey=new Map();
  const lastOutcomeByKey=new Map();
  for(const e of ledger.records){
    if(e.type==='PREDICTION_CAPTURED')captureByKey.set(e.evidenceKey,e);
    if(e.type==='OUTCOME_STATE')lastOutcomeByKey.set(e.evidenceKey,e);
  }
  const sorted=[...(evidenceRecords||[])].sort((a,b)=>String(a.session).localeCompare(String(b.session))||String(a.ticker).localeCompare(String(b.ticker)));
  for(const r of sorted){
    if(r.excludedFromAnalytics===true)continue;
    const v=verifyCaptureHash(r);
    if(!v.ok)throw new Error(v.reason+': '+r.session+'|'+r.ticker);
    const key=String(r.session)+'|'+String(r.ticker);
    const ch=captureHash(r);
    const existingCapture=captureByKey.get(key);
    if(existingCapture){
      if(existingCapture.payloadHash!==ch)throw new Error('IMMUTABLE_CAPTURE_CHANGED: '+key);
    }else{
      appendEvent(ledger.records,{eventId:key+'|CAPTURE',evidenceKey:key,session:r.session,ticker:r.ticker,type:'PREDICTION_CAPTURED',observedAt:r.capturedAt||observedAt,captureTiming:r.captureTiming||null,recordedForwardEligible:r.recordedForwardEligible===true,payloadHash:ch,payload:immutableEvidencePayload(r)});
      captureByKey.set(key,ledger.records.at(-1));
    }
    const oh=outcomeHash(r);
    const prevOutcome=lastOutcomeByKey.get(key);
    if(!prevOutcome||prevOutcome.payloadHash!==oh){
      appendEvent(ledger.records,{eventId:key+'|OUTCOME|'+oh.slice(0,16),evidenceKey:key,session:r.session,ticker:r.ticker,type:'OUTCOME_STATE',observedAt,payloadHash:oh,payload:outcomePayload(r)});
      lastOutcomeByKey.set(key,ledger.records.at(-1));
    }
  }
  const verified=verifyChain(ledger.records);
  if(!verified.ok)throw new Error('EVIDENCE_EVENT_LEDGER_POST_APPEND_BROKEN');
  ledger.generatedAt=observedAt;
  ledger.chain={status:'VERIFIED',records:ledger.records.length,errors:[]};
  ledger.captureEvents=ledger.records.filter(x=>x.type==='PREDICTION_CAPTURED').length;
  ledger.outcomeEvents=ledger.records.filter(x=>x.type==='OUTCOME_STATE').length;
  ledger.note='Append-only event ledger: immutable prediction captures plus append-only outcome-state transitions. Materialized prospective-evidence.json may update outcome state, but historical events are never rewritten.';
  return ledger;
}
module.exports={verifyChain,updateEventLedger};
