'use strict';

const crypto=require('crypto');

function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(v&&typeof v==='object'){
    const o={};
    for(const k of Object.keys(v).sort())o[k]=stable(v[k]);
    return o;
  }
  return v;
}
function objectHash(v){
  return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
}
function unique(arr){return [...new Set(arr)]}

function evaluateLiveAcceptance(input){
  const {
    freeze={},replay={},prediction={},events={},evidence={},snapshots={},
    cockpit={},market={},history={}
  }=input||{};
  const baseline=freeze.baseline||{};
  const policy=freeze.liveAcceptance||{};
  const required=Math.max(1,Number(policy.requiredDistinctSessions||2));
  const baselineSession=String(baseline.session||'');
  const issues=[];

  const replaySessions=(replay.sessions||[]).slice().sort((a,b)=>String(a.session).localeCompare(String(b.session)));
  const ledgerRecords=(prediction.records||[]).slice().sort((a,b)=>String(a.session).localeCompare(String(b.session)));
  const eventRecords=events.records||[];
  const evidenceRecords=(evidence.records||[]).filter(r=>r.excludedFromAnalytics!==true);

  const replayNames=replaySessions.map(x=>String(x.session));
  const ledgerNames=ledgerRecords.map(x=>String(x.session));
  const duplicateReplay=unique(replayNames.filter((x,i)=>replayNames.indexOf(x)!==i));
  const duplicateLedger=unique(ledgerNames.filter((x,i)=>ledgerNames.indexOf(x)!==i));
  const duplicateEventIds=unique(eventRecords.map(x=>x.eventId).filter((x,i,a)=>x&&a.indexOf(x)!==i));

  if(duplicateReplay.length)issues.push({scope:'GLOBAL',code:'DUPLICATE_REPLAY_SESSION',detail:duplicateReplay.join(', ')});
  if(duplicateLedger.length)issues.push({scope:'GLOBAL',code:'DUPLICATE_LEDGER_SESSION',detail:duplicateLedger.join(', ')});
  if(duplicateEventIds.length)issues.push({scope:'GLOBAL',code:'DUPLICATE_EVENT_ID',detail:duplicateEventIds.slice(0,10).join(', ')});

  if(prediction.chain?.status!=='VERIFIED')issues.push({scope:'GLOBAL',code:'PREDICTION_CHAIN_NOT_VERIFIED',detail:String(prediction.chain?.status||'MISSING')});
  if(events.chain?.status!=='VERIFIED')issues.push({scope:'GLOBAL',code:'EVENT_CHAIN_NOT_VERIFIED',detail:String(events.chain?.status||'MISSING')});
  if(replay.ledgerChainStatus!=='VERIFIED')issues.push({scope:'GLOBAL',code:'REPLAY_LEDGER_CHAIN_NOT_VERIFIED',detail:String(replay.ledgerChainStatus||'MISSING')});

  const baselineReplay=replaySessions.find(x=>String(x.session)===baselineSession);
  const baselineLedger=ledgerRecords.find(x=>String(x.session)===baselineSession);
  if(!baselineReplay)issues.push({scope:'BASELINE',code:'BASELINE_REPLAY_MISSING',detail:baselineSession});
  if(!baselineLedger)issues.push({scope:'BASELINE',code:'BASELINE_LEDGER_MISSING',detail:baselineSession});
  if(baselineReplay&&baseline.snapshotSha256&&baselineReplay.snapshotSha256!==baseline.snapshotSha256){
    issues.push({scope:'BASELINE',code:'BASELINE_SNAPSHOT_CHANGED',detail:baselineReplay.snapshotSha256});
  }
  if(baselineLedger&&baseline.predictionRecordHash&&baselineLedger.recordHash!==baseline.predictionRecordHash){
    issues.push({scope:'BASELINE',code:'BASELINE_LEDGER_RECORD_CHANGED',detail:baselineLedger.recordHash});
  }

  const postFreeze=replaySessions.filter(x=>String(x.session)>baselineSession);
  const candidates=postFreeze.slice(0,required);
  const sessionReports=[];

  for(const r of candidates){
    const session=String(r.session);
    const lr=ledgerRecords.find(x=>String(x.session)===session)||null;
    const snap=snapshots[session]||null;
    const ev=eventRecords.filter(x=>String(x.session)===session);
    const captures=ev.filter(x=>x.type==='PREDICTION_CAPTURED');
    const er=evidenceRecords.filter(x=>String(x.session)===session);
    const checks=[];

    function check(id,ok,detail){
      checks.push({id,ok:!!ok,detail:detail??null});
      if(!ok)issues.push({scope:session,code:id,detail:detail??null});
    }

    check('REPLAY_UNIQUE',replayNames.filter(x=>x===session).length===1,'count='+replayNames.filter(x=>x===session).length);
    check('LEDGER_UNIQUE',ledgerNames.filter(x=>x===session).length===1,'count='+ledgerNames.filter(x=>x===session).length);
    check('RECORDED_FORWARD_ELIGIBLE',r.recordedForwardEligible===true,'replay='+String(r.recordedForwardEligible));
    check('CAPTURE_TIMING',r.captureTiming===String(policy.requireCaptureTiming||'ON_SESSION_AFTER_CLOSE'),'replay='+String(r.captureTiming));
    check('LEDGER_RECORD_PRESENT',!!lr,lr?.recordHash||null);
    check('SNAPSHOT_PRESENT',!!snap,r.snapshotSha256||null);

    if(lr){
      check('LEDGER_REPLAY_LINK',lr.snapshotSha256===r.snapshotSha256,'ledger='+lr.snapshotSha256+' replay='+r.snapshotSha256);
      check('LEDGER_FORWARD_ELIGIBLE',lr.recordedForwardEligible===true,'ledger='+String(lr.recordedForwardEligible));
      check('LEDGER_CAPTURE_TIMING',lr.captureTiming===String(policy.requireCaptureTiming||'ON_SESSION_AFTER_CLOSE'),'ledger='+String(lr.captureTiming));
    }
    if(snap){
      const core={...snap};delete core.snapshotSha256;
      check('SNAPSHOT_HASH_VALID',objectHash(core)===snap.snapshotSha256,'stored='+String(snap.snapshotSha256));
      check('SNAPSHOT_REPLAY_LINK',snap.snapshotSha256===r.snapshotSha256,'snapshot='+snap.snapshotSha256+' replay='+r.snapshotSha256);
      check('SNAPSHOT_FORWARD_ELIGIBLE',snap.recordedForwardEligible===true,'snapshot='+String(snap.recordedForwardEligible));
      check('SNAPSHOT_CAPTURE_TIMING',snap.captureTiming===String(policy.requireCaptureTiming||'ON_SESSION_AFTER_CLOSE'),'snapshot='+String(snap.captureTiming));
      check('SNAPSHOT_ATOMIC_HANDOFF',snap.inputFingerprint?.atomicHandoff===true,'atomic='+String(snap.inputFingerprint?.atomicHandoff));
      check('SNAPSHOT_EXPECTED_SESSION',String(snap.inputFingerprint?.expectedSession||'')===session,'expected='+String(snap.inputFingerprint?.expectedSession));
      if(lr){
        check('SOURCE_FINGERPRINT_LINK',
          !!lr.sourceSessionDataHash&&lr.sourceSessionDataHash===snap.inputFingerprint?.sourceSessionDataHash,
          'ledger='+String(lr.sourceSessionDataHash)+' snapshot='+String(snap.inputFingerprint?.sourceSessionDataHash));
      }
      check('SNAPSHOT_RESEARCH_ONLY',snap.researchOnly===true,'researchOnly='+String(snap.researchOnly));
      check('SNAPSHOT_EXECUTION_OFF',snap.automaticExecution===false,'automaticExecution='+String(snap.automaticExecution));
    }

    check('EVIDENCE_CAPTURE_EVENTS',captures.length>0,'count='+captures.length);
    if(captures.length){
      check('EVENTS_FORWARD_ELIGIBLE',captures.every(x=>x.recordedForwardEligible===true),'eligible='+captures.filter(x=>x.recordedForwardEligible===true).length+'/'+captures.length);
      check('EVENTS_CAPTURE_TIMING',captures.every(x=>x.captureTiming===String(policy.requireCaptureTiming||'ON_SESSION_AFTER_CLOSE')),'required='+String(policy.requireCaptureTiming||'ON_SESSION_AFTER_CLOSE'));
    }
    check('PROSPECTIVE_EVIDENCE_PRESENT',er.length>0,'count='+er.length);
    if(er.length){
      check('PROSPECTIVE_FORWARD_ELIGIBLE',er.every(x=>x.recordedForwardEligible===true),'eligible='+er.filter(x=>x.recordedForwardEligible===true).length+'/'+er.length);
      check('PROSPECTIVE_CAPTURE_TIMING',er.every(x=>x.captureTiming===String(policy.requireCaptureTiming||'ON_SESSION_AFTER_CLOSE')),'required='+String(policy.requireCaptureTiming||'ON_SESSION_AFTER_CLOSE'));
    }

    const passed=checks.every(x=>x.ok);
    sessionReports.push({
      session,passed,captureTiming:r.captureTiming||null,recordedForwardEligible:r.recordedForwardEligible===true,
      snapshotSha256:r.snapshotSha256||null,predictionRecordHash:lr?.recordHash||null,
      predictionCount:r.predictionCount??null,evidenceCaptureEvents:captures.length,prospectiveEvidenceRecords:er.length,checks
    });
  }

  const currentSession=String(cockpit.session||market.source?.expectedSession||history.source?.expectedSession||'');
  const currentSafetyOk=
    cockpit.safety?.researchOnly===true&&
    cockpit.safety?.executionAllowed===false&&
    cockpit.safety?.automaticOrders===false;
  if(!currentSafetyOk)issues.push({scope:'GLOBAL',code:'EXECUTION_SAFETY_CHANGED',detail:JSON.stringify(cockpit.safety||null)});
  if(market.source?.atomicHandoff!==true||history.source?.atomicHandoff!==true){
    issues.push({scope:'GLOBAL',code:'CURRENT_ATOMIC_HANDOFF_FAILED',detail:currentSession});
  }
  if(String(market.source?.expectedSession||'')!==String(history.source?.expectedSession||'')){
    issues.push({scope:'GLOBAL',code:'CURRENT_SESSION_MISMATCH',detail:String(market.source?.expectedSession)+' vs '+String(history.source?.expectedSession)});
  }
  if(market.source?.sourceSessionDataHash!==history.source?.sourceSessionDataHash){
    issues.push({scope:'GLOBAL',code:'CURRENT_FINGERPRINT_MISMATCH',detail:currentSession});
  }

  const globalBlocking=issues.some(x=>x.scope==='GLOBAL'||x.scope==='BASELINE');
  const passedCount=sessionReports.filter(x=>x.passed).length;
  let status;
  if(globalBlocking||sessionReports.some(x=>!x.passed))status='ACCEPTANCE_FAILED';
  else if(sessionReports.length>=required&&passedCount>=required)status='ACCEPTANCE_COMPLETE';
  else if(sessionReports.length===1&&passedCount===1)status='ONE_SESSION_ACCEPTED';
  else status='WAITING_FOR_FIRST_SESSION';

  return {
    schemaVersion:'astra-live-acceptance/v1',
    release:freeze.release||null,
    packageVersion:freeze.packageVersion||null,
    frozenCommit:freeze.frozenCommit||null,
    stableBranch:freeze.stableBranch||null,
    generatedAt:new Date().toISOString(),
    baselineSession,
    requiredDistinctSessions:required,
    currentSession:currentSession||null,
    status,
    acceptedSessions:sessionReports.filter(x=>x.passed).map(x=>x.session),
    observedPostFreezeSessions:postFreeze.map(x=>x.session),
    remainingSessions:Math.max(0,required-passedCount),
    sessionReports,
    global:{
      predictionChain:prediction.chain?.status||'MISSING',
      eventChain:events.chain?.status||'MISSING',
      replayLedgerChain:replay.ledgerChainStatus||'MISSING',
      replaySessionCount:replay.sessionCount??replaySessions.length,
      predictionLedgerRecords:ledgerRecords.length,
      eventRecords:eventRecords.length,
      currentSafetyOk,
      currentAtomicHandoff:market.source?.atomicHandoff===true&&history.source?.atomicHandoff===true
    },
    issues,
    automaticExecution:false,
    note:'Acceptance is complete only when the first two distinct post-freeze replay sessions are true recorded-forward captures and all persistence/integrity checks pass.'
  };
}

module.exports={evaluateLiveAcceptance,objectHash};
