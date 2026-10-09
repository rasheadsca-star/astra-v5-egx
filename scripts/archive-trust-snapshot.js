'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=process.cwd();
const COCKPIT='data/decision-cockpit.json';
const MARKET='data/canonical-market.json';
const HISTORY='data/history-index.json';
const PACKAGE='package.json';
const LEDGER='data/prediction-ledger.json';
const DOC_LEDGER='docs/data/prediction-ledger.json';
const INDEX='data/replay/index.json';
const DOC_INDEX='docs/data/replay/index.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return fallback}}
function write(p,v){const f=path.join(ROOT,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n')}
function hashText(s){return crypto.createHash('sha256').update(s).digest('hex')}
function fileHash(p){try{return hashText(fs.readFileSync(path.join(ROOT,p)))}catch{return null}}
function stable(v){
  if(Array.isArray(v)) return v.map(stable);
  if(v&&typeof v==='object'){
    const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o;
  }
  return v;
}
function objectHash(v){return hashText(JSON.stringify(stable(v)))}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}

const d=read(COCKPIT,null), market=read(MARKET,null), hist=read(HISTORY,null);
if(!d||!market||!hist)throw new Error('V6 trust archive inputs missing');
const session=d.session||market.source?.expectedSession||hist.source?.expectedSession;
if(!session)throw new Error('Session missing');

const pkg=read(PACKAGE,{version:'unknown'});
const modelVersion='ASTRA_'+String(pkg.version||'unknown');
const buildCommit=process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA||process.env.COMMIT_SHA||null;
const inputFingerprint={
  canonicalMarketSha256:fileHash(MARKET),
  historyIndexSha256:fileHash(HISTORY),
  sourceSessionDataHash:market.source?.sourceSessionDataHash||hist.source?.sourceSessionDataHash||null,
  expectedSession:market.source?.expectedSession||hist.source?.expectedSession||null,
  atomicHandoff:market.source?.atomicHandoff===true&&hist.source?.atomicHandoff===true
};

const opportunities=[...(d.topOpportunities||[]),...(d.watchlist||[]),...(d.rejected||[])];
const frozenPredictions=opportunities.map(x=>({
  ticker:x.ticker,
  stage:x.stage||null,
  rank:x.rank??null,
  currentPrice:n(x.currentPrice??x.close),
  finalDecisionScore:n(x.finalDecisionScore),
  finalDecisionGrade:x.finalDecisionGrade||null,
  entryQuality:x.entryQuality||null,
  entryLow:n(x.entryLow),
  entryHigh:n(x.entryHigh),
  stop:n(x.stop),
  target1:n(x.target1),
  target2:n(x.target2),
  rrT2:n(x.rrT2),
  decisionGatePass:x.decisionGate?.pass===true,
  decisionGateStatus:x.decisionGate?.status||null,
  decisionGateReasons:x.decisionGate?.reasons||[],
  portfolioSelected:x.portfolioSelected===true,
  portfolioRank:x.portfolioRank??null,
  researchWeightPct:n(x.portfolioResearchWeightPct),
  riskBudgetPct:n(x.riskBudgetPct),
  theoreticalRiskBudgetPct:n(x.theoreticalRiskBudgetPct),
  actionableRiskBudgetPct:n(x.actionableRiskBudgetPct),
  theoreticalShares100k:n(x.theoreticalShares100k),
  actionableShares100k:n(x.actionableShares100k),
  actionableNow:x.actionableNow===true,
  riskStateOverrideReason:x.riskStateOverrideReason||null,
  sector:x.sector||null,
  monitoringState:x.monitoringState||null,
  t1ProbabilityPct:n(x.targetAchievement?.t1ProbabilityPct),
  t2ProbabilityPct:n(x.targetAchievement?.t2ProbabilityPct),
  probabilityStatus:x.targetAchievement?.status||null
}));

const currentDecisionFingerprint=objectHash({inputFingerprint,predictions:frozenPredictions});
let snapshot={
  schemaVersion:'astra-replay-snapshot/v1',
  session,
  archivedAt:new Date().toISOString(),
  modelVersion,
  buildCommit,
  decisionFingerprint:currentDecisionFingerprint,
  researchOnly:true,
  automaticExecution:false,
  inputFingerprint,
  market:d.market||null,
  dataHealth:d.dataHealth||null,
  dailyDecisionBrief:d.dailyDecisionBrief||null,
  portfolioSelectionEngine:d.portfolioSelectionEngine||null,
  riskBudgetEngine:d.riskBudgetEngine||null,
  monitoringAlertsEngine:d.monitoringAlertsEngine||null,
  outcomeAnalyticsEngine:d.outcomeAnalyticsEngine||null,
  probabilityCalibrationEngine:d.probabilityCalibrationEngine||null,
  sectorCorrelationEngine:d.sectorCorrelationEngine||null,
  changeAttributionEngine:d.changeAttributionEngine||null,
  predictions:frozenPredictions
};
snapshot.snapshotSha256=objectHash({...snapshot,snapshotSha256:undefined});

const replayPath='data/replay/sessions/'+session+'.json';
const docReplayPath='docs/data/replay/sessions/'+session+'.json';
const priorReplay=read(replayPath,null);
let currentBuildDiffersFromFrozen=false;

if(priorReplay){
  const priorHash=priorReplay.snapshotSha256;
  const recomputed=objectHash({...priorReplay,snapshotSha256:undefined});
  if(!priorHash||priorHash!==recomputed){
    throw new Error('REPLAY_STORED_HASH_INVALID: '+session);
  }
  const priorDecisionFingerprint=priorReplay.decisionFingerprint||
    objectHash({inputFingerprint:priorReplay.inputFingerprint,predictions:priorReplay.predictions||[]});
  currentBuildDiffersFromFrozen=priorDecisionFingerprint!==currentDecisionFingerprint;
  // First persisted snapshot wins for the session. Never rewrite history during same-session code changes.
  snapshot=priorReplay;
}else{
  snapshot.snapshotSha256=objectHash({...snapshot,snapshotSha256:undefined});
  write(replayPath,snapshot);write(docReplayPath,snapshot);
}

const ledger=read(LEDGER,{schemaVersion:'astra-prediction-ledger/v1',records:[]});
const existing=(ledger.records||[]).find(x=>x.session===session);
let recordHash=null;

if(existing){
  const core={...existing};delete core.recordHash;
  if(objectHash(core)!==existing.recordHash){
    throw new Error('LEDGER_EXISTING_RECORD_HASH_INVALID: '+session);
  }
  if(existing.snapshotSha256!==snapshot.snapshotSha256){
    throw new Error('LEDGER_SNAPSHOT_LINK_MISMATCH: '+session);
  }
  recordHash=existing.recordHash;
}else{
  const prior=(ledger.records||[]).at(-1)||null;
  if(prior&&String(session)<=String(prior.session)){
    throw new Error('LEDGER_OUT_OF_ORDER_APPEND: '+session+' after '+prior.session);
  }
  const recordCore={
    session,
    archivedAt:snapshot.archivedAt,
    modelVersion:snapshot.modelVersion||modelVersion,
    buildCommit:snapshot.buildCommit||buildCommit,
    previousRecordHash:prior?.recordHash||null,
    snapshotSha256:snapshot.snapshotSha256,
    sourceSessionDataHash:snapshot.inputFingerprint?.sourceSessionDataHash||null,
    predictionCount:(snapshot.predictions||[]).length,
    gatePassedCount:(snapshot.predictions||[]).filter(x=>x.decisionGatePass).length,
    basketTickers:(snapshot.predictions||[]).filter(x=>x.portfolioSelected).sort((a,b)=>(a.portfolioRank??999)-(b.portfolioRank??999)).map(x=>x.ticker),
    headline:snapshot.dailyDecisionBrief?.headline||null
  };
  recordHash=objectHash(recordCore);
  ledger.records.push({...recordCore,recordHash});
}

let chainOk=true,chainErrors=[];
for(let i=0;i<ledger.records.length;i++){
  const rec=ledger.records[i],prev=i?ledger.records[i-1]:null;
  if((rec.previousRecordHash||null)!==(prev?.recordHash||null)){chainOk=false;chainErrors.push({session:rec.session,error:'PREVIOUS_HASH_MISMATCH'})}
  const core={...rec};delete core.recordHash;
  if(objectHash(core)!==rec.recordHash){chainOk=false;chainErrors.push({session:rec.session,error:'RECORD_HASH_MISMATCH'})}
}
ledger.generatedAt=new Date().toISOString();
ledger.chain={status:chainOk?'VERIFIED':'BROKEN',records:ledger.records.length,errors:chainErrors};
ledger.note='Tamper-evident hash-chained research ledger committed to Git. It is not a blockchain and does not claim legal immutability.';
write(LEDGER,ledger);write(DOC_LEDGER,ledger);

const index=read(INDEX,{schemaVersion:'astra-replay-index/v1',sessions:[]});
const item={
  session,
  archivedAt:snapshot.archivedAt,
  modelVersion:snapshot.modelVersion||modelVersion,
  buildCommit:snapshot.buildCommit||buildCommit,
  snapshotSha256:snapshot.snapshotSha256,
  predictionCount:(snapshot.predictions||[]).length,
  gatePassedCount:(snapshot.predictions||[]).filter(x=>x.decisionGatePass).length,
  basketTickers:(snapshot.predictions||[]).filter(x=>x.portfolioSelected).sort((a,b)=>(a.portfolioRank??999)-(b.portfolioRank??999)).map(x=>x.ticker),
  marketRegime:snapshot.market?.regime||null,
  breadthPct:n(snapshot.market?.breadthPct),
  dataStale:snapshot.dataHealth?.stale===true
};
const idxSessions=(index.sessions||[]).filter(x=>x.session!==session);
idxSessions.push(item);idxSessions.sort((a,b)=>String(a.session).localeCompare(String(b.session)));
const newIndex={
  schemaVersion:'astra-replay-index/v1',
  generatedAt:new Date().toISOString(),
  coverageStart:idxSessions[0]?.session||null,
  coverageEnd:idxSessions.at(-1)?.session||null,
  sessionCount:idxSessions.length,
  ledgerChainStatus:ledger.chain.status,
  currentBuildDiffersFromFrozenSession:currentBuildDiffersFromFrozen,
  frozenModelVersion:snapshot.modelVersion||modelVersion,
  frozenBuildCommit:snapshot.buildCommit||null,
  sessions:idxSessions,
  note:'True no-look-ahead replay is available only for sessions persisted after V6 Trust Archive activation. Earlier dates are not reconstructed from future-known data.'
};
write(INDEX,newIndex);write(DOC_INDEX,newIndex);

d.trustArchitecture={
  version:'trust-architecture/v1',
  generatedAt:new Date().toISOString(),
  session,
  replaySnapshotSha256:snapshot.snapshotSha256,
  ledgerRecordHash:recordHash,
  ledgerChainStatus:ledger.chain.status,
  persistedReplaySessions:newIndex.sessionCount,
  replayCoverageStart:newIndex.coverageStart,
  researchOnly:true,
  automaticExecution:false,
  note:newIndex.note+(currentBuildDiffersFromFrozen?' Current same-session build differs from the already-frozen snapshot; the frozen record was preserved unchanged.':'')
};
write(COCKPIT,d);write('docs/data/decision-cockpit.json',d);
console.log(JSON.stringify(d.trustArchitecture,null,2));
