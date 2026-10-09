'use strict';

function n(v){if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null}
function check(id,status,severity,detail,meta={}){return {id,status,severity,detail,...meta}}

function evaluateOperations(input={}){
  const cockpit=input.cockpit||{}, market=input.market||{}, history=input.history||{}, sourceHealth=input.sourceHealth||{};
  const prediction=input.prediction||{}, eventLedger=input.eventLedger||{}, replay=input.replay||{};
  const walkForward=input.walkForward||{}, governance=input.governance||{}, quantStatus=input.quantStatus||{};
  const packageVersion=input.packageVersion||'unknown', checks=[];
  const session=cockpit.session||market.source?.expectedSession||history.source?.expectedSession||null;

  const safetyOk=cockpit.safety?.researchOnly===true&&cockpit.safety?.executionAllowed===false&&cockpit.safety?.automaticOrders===false&&governance.releaseGate?.canEnableAutomaticExecution!==true;
  checks.push(check('EXECUTION_SAFETY',safetyOk?'PASS':'FAIL','CRITICAL',safetyOk?'Research-only safety invariant verified.':'Execution safety invariant is not fully OFF.'));

  const atomicOk=market.source?.atomicHandoff===true&&history.source?.atomicHandoff===true&&market.source?.expectedSession===history.source?.expectedSession&&market.source?.sourceSessionDataHash===history.source?.sourceSessionDataHash;
  checks.push(check('ATOMIC_HANDOFF',atomicOk?'PASS':'FAIL','CRITICAL',atomicOk?'Market/history session and fingerprint match.':'Atomic market/history handoff failed or is misaligned.'));

  const stale=cockpit.dataHealth?.stale===true||(n(cockpit.dataHealth?.staleLagSessions)||0)>0;
  checks.push(check('DECISION_DATA_FRESHNESS',stale?'FAIL':'PASS',stale?'HIGH':'INFO',stale?'Decision cockpit reports stale market data.':'Decision cockpit freshness gate is current.'));

  const cov=n(sourceHealth.coverage?.activeCoveragePct), staleActive=n(sourceHealth.coverage?.staleActiveSymbols)||0, failedSources=n(sourceHealth.coverage?.sourceFailedSymbols)||0;
  let covStatus='INFO',covSeverity='INFO';
  if(cov!=null){if(cov<80){covStatus='FAIL';covSeverity='HIGH'}else if(cov<95||staleActive>0||failedSources>0){covStatus='WARN';covSeverity='MEDIUM'}else covStatus='PASS'}
  checks.push(check('SOURCE_COVERAGE',covStatus,covSeverity,cov==null?'Source coverage unavailable.':String(cov)+'% active coverage · '+staleActive+' active stale · '+failedSources+' source failed.',{activeCoveragePct:cov,staleActiveSymbols:staleActive,sourceFailedSymbols:failedSources}));

  const mismatch=sourceHealth.crossStoreConsistency?.canonicalCurrentButQuantStale||[];
  checks.push(check('CROSS_STORE_FRESHNESS',mismatch.length?'WARN':'PASS',mismatch.length?'MEDIUM':'INFO',mismatch.length?'Canonical-current but quant-stale: '+mismatch.join(', '):'Canonical/quant freshness classifications are aligned.',{tickers:mismatch}));

  const predictionOk=prediction.chain?.status==='VERIFIED', eventOk=eventLedger.chain?.status==='VERIFIED', ledgerOk=predictionOk&&eventOk;
  checks.push(check('LEDGER_INTEGRITY',ledgerOk?'PASS':'FAIL','CRITICAL',ledgerOk?'Prediction/event hash chains verified ('+(prediction.records?.length||0)+'/'+(eventLedger.records?.length||0)+' records).':'Ledger verification failed: prediction='+(prediction.chain?.status||'MISSING')+', events='+(eventLedger.chain?.status||'MISSING')+'.'));

  const replayItem=(replay.sessions||[]).find(x=>x.session===session), predItem=(prediction.records||[]).find(x=>x.session===session), persisted=Boolean(session&&replayItem&&predItem);
  checks.push(check('SESSION_PERSISTENCE',persisted?'PASS':'FAIL','HIGH',persisted?'Session '+session+' exists in replay and prediction ledger.':'Current session '+(session||'UNKNOWN')+' is not fully persisted.'));

  const qs=String(quantStatus.finalStatus||'UNKNOWN'), quantFail=['FAILED','INVALID','ERROR'].includes(qs), quantWarn=['PARTIAL','DEGRADED'].includes(qs);
  checks.push(check('QUANT_PIPELINE',quantFail?'FAIL':quantWarn?'WARN':qs==='UNKNOWN'?'INFO':'PASS',quantFail?'HIGH':quantWarn?'MEDIUM':'INFO','Quant update status: '+qs+'; coverage='+(quantStatus.coveragePct??'n/a')+'%.'));

  const calStatus=cockpit.probabilityCalibrationEngine?.status||'INSUFFICIENT_EVIDENCE';
  checks.push(check('CALIBRATION_MATURITY','INFO','INFO','Calibration status: '+calStatus+'; resolved='+(cockpit.probabilityCalibrationEngine?.forwardResolved??0)+', sessions='+(cockpit.probabilityCalibrationEngine?.forwardDistinctSessions??0)+'.'));

  const wfStatus=walkForward.status||'UNKNOWN';
  checks.push(check('WALK_FORWARD_MATURITY','INFO','INFO','Walk-forward status: '+wfStatus+'; valid folds='+(walkForward.coverage?.validFolds??0)+'.'));

  const independent=sourceHealth.independentVerification?.quorumMet===true;
  checks.push(check('INDEPENDENT_SOURCE_QUORUM',independent?'PASS':'INFO','INFO',independent?'Independent source verifier enabled.':'No independent source quorum is currently claimed.'));

  const issueCandidates=[
    {key:'EXECUTION_SAFETY',title:'[ASTRA OPS][EXECUTION_SAFETY] Execution safety invariant failed',severity:'CRITICAL',active:!safetyOk,body:'ASTRA detected that research-only / execution-OFF invariants are not satisfied.'},
    {key:'ATOMIC_HANDOFF',title:'[ASTRA OPS][ATOMIC_HANDOFF] Market/history atomic handoff failed',severity:'CRITICAL',active:!atomicOk,body:'Canonical market/history session, atomic flag, or source fingerprint is inconsistent.'},
    {key:'LEDGER_INTEGRITY',title:'[ASTRA OPS][LEDGER_INTEGRITY] Persistent evidence ledger integrity failed',severity:'CRITICAL',active:!ledgerOk,body:'Prediction chain: '+(prediction.chain?.status||'MISSING')+'; event chain: '+(eventLedger.chain?.status||'MISSING')+'.'},
    {key:'SESSION_PERSISTENCE',title:'[ASTRA OPS][SESSION_PERSISTENCE] Current session is not fully persisted',severity:'HIGH',active:!persisted,body:'Current session '+(session||'UNKNOWN')+' is missing from replay and/or prediction-ledger state.'},
    {key:'SOURCE_COVERAGE',title:'[ASTRA OPS][SOURCE_COVERAGE] Active source coverage below hard floor',severity:'HIGH',active:cov!=null&&cov<80,body:'Active coverage is '+(cov??'unknown')+'%. Hard operational floor is 80%.'},
    {key:'SOURCE_FAILURES',title:'[ASTRA OPS][SOURCE_FAILURES] One or more active symbols have source failures',severity:'MEDIUM',active:failedSources>0,body:String(failedSources)+' active symbol(s) report explicit source update failure. Review data/source-health.json.'},
    {key:'CROSS_STORE_FRESHNESS',title:'[ASTRA OPS][CROSS_STORE_FRESHNESS] Canonical and quant freshness disagree',severity:'MEDIUM',active:mismatch.length>0,body:mismatch.length?'Affected tickers: '+mismatch.join(', '):'Freshness stores are aligned.'},
    {key:'DECISION_DATA_FRESHNESS',title:'[ASTRA OPS][DECISION_DATA_FRESHNESS] Decision data is stale',severity:'HIGH',active:stale,body:'Decision cockpit session '+(session||'UNKNOWN')+' reports stale data or a non-zero stale lag.'}
  ];

  const activeIssues=issueCandidates.filter(x=>x.active);
  const hasCritical=checks.some(x=>x.status==='FAIL'&&x.severity==='CRITICAL'), hasFail=checks.some(x=>x.status==='FAIL'), hasWarn=checks.some(x=>x.status==='WARN');
  const overall=hasCritical?'CRITICAL':hasFail?'DEGRADED':hasWarn?'DEGRADED':'HEALTHY';

  return {
    schemaVersion:'astra-operations-health/v1',generatedAt:new Date().toISOString(),version:packageVersion,session,overall,
    researchOnly:true,automaticExecution:false,
    summary:{checks:checks.length,pass:checks.filter(x=>x.status==='PASS').length,warn:checks.filter(x=>x.status==='WARN').length,fail:checks.filter(x=>x.status==='FAIL').length,info:checks.filter(x=>x.status==='INFO').length,activeIssueCandidates:activeIssues.length},
    checks,issueCandidates,
    release:{governanceGate:governance.releaseGate?.status||governance.releaseGate?.evidenceGate||null,reliabilityScore:governance.reliability?.score??null,probabilityStatus:calStatus,walkForwardStatus:wfStatus}
  };
}
module.exports={evaluateOperations};
