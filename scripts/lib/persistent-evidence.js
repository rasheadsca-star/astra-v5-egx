'use strict';
const crypto=require('crypto');

function stable(v){
  if(Array.isArray(v)) return v.map(stable);
  if(v&&typeof v==='object'){
    const o={};
    for(const k of Object.keys(v).sort()) o[k]=stable(v[k]);
    return o;
  }
  return v;
}
function objectHash(v){
  return crypto.createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
}
function cairoDate(iso){
  if(!iso)return null;
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year&&p.month&&p.day?[p.year,p.month,p.day].join('-'):null;
}
function classifyCaptureTiming(session,capturedAt){
  const cd=cairoDate(capturedAt);
  if(!session||!cd)return 'UNKNOWN';
  if(cd===String(session))return 'ON_SESSION_AFTER_CLOSE';
  if(cd>String(session))return 'LATE_CAPTURE';
  return 'PRE_SESSION_INVALID';
}
const IMMUTABLE_FIELDS=[
  'id','evidenceKeyVersion','session','ticker','stage','rank','conviction','qualityScore','agreementCount','engineFamilies',
  'entryLow','entryHigh','stop','target1','target2','riskPct','rrT2','currentPrice','entryQuality','entryQualityScore',
  'entryDistancePct','chaseDistancePct','contextScore','contextAdjustment','adjustedConviction','marketContextScore',
  'sector','sectorStrengthScore','sectorSource','sectorContextScore','sectorContextStatus','liquidityContextScore',
  'finalDecisionScore','finalDecisionGrade','finalDecisionLabel','portfolioSelected','portfolioRank',
  'portfolioResearchWeightPct','riskBudgetPct','theoreticalRiskBudgetPct','actionableRiskBudgetPct',
  'theoreticalShares100k','actionableShares100k','actionableNow','riskStateOverrideReason','referenceShares100k',
  'referencePositionValue100k','referenceMaxLoss100k','monitoringState','monitoringSeverity','monitoringAction',
  'regime','breadthPct','exposureScale','warnings','evidence','capturedAt','captureTiming','recordedForwardEligible',
  'modelVersion','buildCommit'
];
const V3_CALIBRATION_FIELDS=[
  'exAnteT1ProbabilityPct','exAnteT2ProbabilityPct','exAnteStopProbabilityPct',
  'probabilityStatusAtCapture','probabilitySourceAtCapture','probabilitySampleSizeAtCapture',
  'probabilityDistinctSessionsAtCapture','probabilityPoolLevelAtCapture'
];
function immutableEvidencePayload(r){
  const o={};
  for(const k of IMMUTABLE_FIELDS)o[k]=r?.[k]??null;
  if(r?.evidenceKeyVersion==='session+ticker/v3'){
    for(const k of V3_CALIBRATION_FIELDS)o[k]=r?.[k]??null;
  }
  return o;
}
function captureHash(r){return objectHash(immutableEvidencePayload(r))}
function outcomePayload(r){return r?.outcome??null}
function outcomeHash(r){return objectHash(outcomePayload(r))}
function verifyCaptureHash(r){
  if(!r?.captureHash)return {ok:false,reason:'CAPTURE_HASH_MISSING'};
  const actual=captureHash(r);
  return {ok:actual===r.captureHash,reason:actual===r.captureHash?null:'CAPTURE_HASH_MISMATCH',actual,expected:r.captureHash};
}
module.exports={stable,objectHash,cairoDate,classifyCaptureTiming,immutableEvidencePayload,captureHash,outcomePayload,outcomeHash,verifyCaptureHash,IMMUTABLE_FIELDS,V3_CALIBRATION_FIELDS};
