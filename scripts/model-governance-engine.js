'use strict';

const fs=require('fs'),path=require('path');
const ROOT=process.cwd();
const COCKPIT='data/decision-cockpit.json';
const REPLAY='data/replay/index.json';
const LEDGER='data/prediction-ledger.json';
const WF='data/walk-forward-validation.json';
const EVID='data/prospective-evidence.json';
const MARKET='data/canonical-market.json';
const HISTORY='data/history-index.json';
const SOURCE_HEALTH='data/source-health.json';
const OUT='data/model-governance.json';
const DOC='docs/data/model-governance.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return fallback}}
function write(p,v){const f=path.join(ROOT,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function clamp(x,a=0,b=100){return Math.max(a,Math.min(b,x))}
function r(v,d=1){return Number.isFinite(v)?+v.toFixed(d):null}

const d=read(COCKPIT,null);
if(!d)throw new Error('decision cockpit missing');
const replay=read(REPLAY,{sessions:[],sessionCount:0,ledgerChainStatus:'UNKNOWN'});
const ledger=read(LEDGER,{records:[],chain:{status:'UNKNOWN'}});
const wf=read(WF,{status:'WAITING_FOR_MINIMUM_SESSIONS',coverage:{},outOfSample:{},governance:{}});
const evid=read(EVID,{records:[],counts:{},metrics:{}});
const market=read(MARKET,null);
const history=read(HISTORY,null);
const sourceHealth=read(SOURCE_HEALTH,null);

const checks=[];
function check(id,label,score,weight,status,detail){
  checks.push({id,label,score:r(clamp(score),1),weight,status,detail});
}

const atomicOk=market?.source?.atomicHandoff===true&&history?.source?.atomicHandoff===true&&
  market?.source?.expectedSession&&market?.source?.expectedSession===history?.source?.expectedSession&&
  market?.source?.sourceSessionDataHash&&market?.source?.sourceSessionDataHash===history?.source?.sourceSessionDataHash;
check('DATA_INTEGRITY','Atomic data integrity',atomicOk?100:0,20,atomicOk?'PASS':'FAIL',
  atomicOk?'Market/history atomic handoff, session and fingerprint match.':'Canonical market/history atomic integrity is not fully verified.');

const stale=d.dataHealth?.stale===true;
const lag=n(d.dataHealth?.staleLagSessions);
const freshness=stale?Math.max(0,55-(lag||1)*15):100;
check('DATA_FRESHNESS','Data freshness',freshness,12,stale?'WARN':'PASS',
  stale?'Decision data is stale'+(lag!=null?' by '+lag+' session(s).':'.'):'Decision data is not marked stale.');

const activeCoverage=n(sourceHealth?.coverage?.activeCoveragePct);
const sourceCoverageStatus=activeCoverage==null?'WAIT':activeCoverage>=95?'PASS':activeCoverage>=80?'PARTIAL':'FAIL';
check('SOURCE_COVERAGE','Active-universe source coverage',activeCoverage==null?0:activeCoverage,0,sourceCoverageStatus,
  activeCoverage==null?'Source-health report unavailable.':activeCoverage+'% of the explicit active denominator is current; stale/failed active symbols remain in the denominator.');
const independentQuorum=sourceHealth?.independentVerification?.quorumMet===true;
check('SOURCE_QUORUM','Independent source quorum',independentQuorum?100:0,0,independentQuorum?'PASS':'INFO',
  independentQuorum?'At least one independent verifier is enabled.':'No independent verifier is enabled; governance must not claim independent source quorum.');

const ledgerRecordCount=ledger.records?.length||0;
const replaySessionCount=(replay.sessions||[]).filter(x=>x.recordedForwardEligible===true).length;
const totalPersistedReplaySessions=n(replay.sessionCount)??(replay.sessions||[]).length;
const trustHistoryExists=ledgerRecordCount>0||totalPersistedReplaySessions>0;
const chainOk=ledgerRecordCount>0&&ledger.chain?.status==='VERIFIED';
check('LEDGER_CHAIN','Prediction ledger chain',chainOk?100:0,12,chainOk?'PASS':trustHistoryExists?'FAIL':'WAIT',
  chainOk?'Prediction ledger hash chain verifies.':trustHistoryExists?'Persisted trust history exists but the current ledger chain is not verified.':'No persisted ledger records yet.');

const replaySessions=replaySessionCount;
const replayScore=clamp(replaySessions/25*100);
check('REPLAY_COVERAGE','Replay archive coverage',replayScore,10,replaySessions>=25?'PASS':replaySessions>0?'BUILDING':'WAIT',
  replaySessions+' persisted no-look-ahead session(s); 25 required for first standard walk-forward fold.');

let wfScore=0,wfStatus='WAIT';
if(wf.status==='ACTIVE')wfScore=100;
else if(wf.status==='PRELIMINARY')wfScore=65;
else if(wf.status==='WAITING_FOR_RESOLVED_TEST_OUTCOMES')wfScore=40;
else wfScore=clamp((n(wf.coverage?.replaySessions)||0)/25*35);
check('WALK_FORWARD','Walk-forward validation',wfScore,16,wf.status||wfStatus,
  (wf.coverage?.validFolds||0)+' valid fold(s), '+(wf.outOfSample?.resolved||0)+' resolved out-of-sample outcome(s).');

const resolved=n(d.probabilityCalibrationEngine?.forwardResolved)??n(evid.counts?.resolved)??0;
const probStatus=d.probabilityCalibrationEngine?.status||'INSUFFICIENT_DATA';
const probScore=probStatus==='VALIDATED'?100:probStatus==='CALIBRATING'?75:probStatus==='PRELIMINARY'?45:clamp(resolved/10*25);
check('PROBABILITY_EVIDENCE','Forward probability evidence',probScore,10,probStatus,
  resolved+' resolved forward outcome(s); probability validation threshold is 90.');

const outcomeResolved=n(d.outcomeAnalyticsEngine?.overall?.resolved)??n(evid.counts?.resolved)??0;
const outcomeScore=outcomeResolved>=90?100:outcomeResolved>=30?75:outcomeResolved>=10?45:clamp(outcomeResolved/10*30);
check('OUTCOME_SAMPLE','Outcome analytics sample',outcomeScore,8,
  outcomeResolved>=90?'MATURE':outcomeResolved>=30?'CALIBRATING':outcomeResolved>=10?'PRELIMINARY':'INSUFFICIENT',
  outcomeResolved+' resolved prospective outcome(s).');

const sectorCoverage=n(d.sectorCorrelationEngine?.taxonomy?.coveragePct);
const sectorScore=sectorCoverage==null?20:clamp(sectorCoverage);
check('SECTOR_COVERAGE','Verified sector taxonomy coverage',sectorScore,5,
  sectorCoverage!=null&&sectorCoverage>=80?'PASS':sectorCoverage!=null?'PARTIAL':'WAIT',
  sectorCoverage!=null?sectorCoverage+'% of current market rows classified by controlled symbol mapping.':'Sector coverage unavailable.');

const monitoringOk=!!d.monitoringAlertsEngine && d.monitoringAlertsEngine.automaticExecution===false;
check('MONITORING_SAFETY','Monitoring safety state',monitoringOk?100:40,4,monitoringOk?'PASS':'WARN',
  monitoringOk?'Monitoring is research-only and automatic execution is OFF.':'Monitoring safety state is incomplete.');

const drift=d.market?.driftGuard===true;
const regimeScore=drift?55:100;
check('MODEL_DRIFT','Drift guard',regimeScore,3,drift?'WARN':'PASS',
  drift?'Drift guard is active; reliability is conservatively reduced.':'No active drift guard flag.');

const totalWeight=checks.reduce((s,x)=>s+x.weight,0);
const reliability=checks.reduce((s,x)=>s+x.score*x.weight,0)/totalWeight;
const hardFail=!atomicOk || (trustHistoryExists && !chainOk);
const capped=hardFail?Math.min(reliability,49):reliability;
const score=r(capped,1);

let tier='LOW';
if(score>=85)tier='HIGH';
else if(score>=70)tier='GOOD';
else if(score>=50)tier='BUILDING';

const blockers=[];
if(!atomicOk)blockers.push('ATOMIC_DATA_INTEGRITY_NOT_VERIFIED');
if(trustHistoryExists&&!chainOk)blockers.push('LEDGER_CHAIN_NOT_VERIFIED');
if(replaySessions<25)blockers.push('REPLAY_COVERAGE_BELOW_FIRST_WALK_FORWARD_FOLD');
if((wf.coverage?.validFolds||0)<3)blockers.push('MULTI_FOLD_WALK_FORWARD_NOT_ESTABLISHED');
if(resolved<30)blockers.push('FORWARD_PROBABILITY_SAMPLE_SMALL');
if(stale)blockers.push('STALE_DATA');
if(drift)blockers.push('DRIFT_GUARD_ACTIVE');
if(activeCoverage!=null&&activeCoverage<80)blockers.push('ACTIVE_SOURCE_COVERAGE_BELOW_80');

const payload={
  schemaVersion:'astra-model-governance/v1',
  generatedAt:new Date().toISOString(),
  modelVersion:'ASTRA_V6.2_GOVERNANCE',
  reliability:{
    score,
    tier,
    meaning:'Operational and evidence reliability index; NOT probability of profit and NOT expected return.',
    hardCapApplied:hardFail,
    hardCapRule:'Atomic data-integrity failure or broken persisted ledger chain caps reliability below 50.'
  },
  checks,
  blockers,
  evidenceState:{
    replaySessions,
    totalPersistedReplaySessions,
    walkForwardStatus:wf.status||null,
    validWalkForwardFolds:wf.coverage?.validFolds||0,
    outOfSampleResolved:wf.outOfSample?.resolved||0,
    prospectiveResolved:outcomeResolved,
    probabilityStatus:probStatus,
    ledgerRecords:ledgerRecordCount,
    ledgerChainStatus:ledger.chain?.status||replay.ledgerChainStatus||'UNKNOWN',
    activeSourceCoveragePct:activeCoverage,
    independentSourceQuorum:independentQuorum
  },
  releaseGate:{
    status:score>=85&&blockers.length===0?'EVIDENCE_STRONG':score>=70?'EVIDENCE_GOOD_WITH_LIMITATIONS':score>=50?'EVIDENCE_BUILDING':'EVIDENCE_LOW',
    canClaimValidatedProbability:!!wf.governance?.calibrationClaimAllowed && probStatus==='VALIDATED',
    canEnableAutomaticExecution:false,
    automaticExecutionReason:'Automatic trading is outside V6.2 governance scope and remains OFF.'
  },
  researchOnly:true,
  automaticExecution:false
};

write(OUT,payload);write(DOC,payload);
d.modelGovernanceEngine=payload;
d.reliabilityScore=payload.reliability;
write(COCKPIT,d);write('docs/data/decision-cockpit.json',d);
console.log(JSON.stringify(payload,null,2));
