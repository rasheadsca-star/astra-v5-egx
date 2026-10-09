'use strict';

const assert=require('assert');
const {evaluateLiveAcceptance,objectHash}=require('./lib/live-acceptance');

function snapshot(session){
  const s={
    schemaVersion:'astra-replay-snapshot/v1',
    session,
    archivedAt:session+'T13:00:00.000Z',
    captureTiming:'ON_SESSION_AFTER_CLOSE',
    recordedForwardEligible:true,
    modelVersion:'ASTRA_6.11.0',
    buildCommit:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    decisionFingerprint:'x'+session,
    researchOnly:true,
    automaticExecution:false,
    inputFingerprint:{sourceSessionDataHash:'src-'+session,expectedSession:session,atomicHandoff:true},
    predictions:[{ticker:'AAA'}]
  };
  s.snapshotSha256=objectHash(s);
  return s;
}

function fixture(count,failSecond){
  const baselineSession='2026-10-07';
  const baselineHash='base-snapshot';
  const baselineRecord='base-record';
  const allSessions=['2026-10-11','2026-10-12'];
  const sessions=allSessions.slice(0,count);
  const replaySessions=[{session:baselineSession,snapshotSha256:baselineHash,captureTiming:'LATE_CAPTURE',recordedForwardEligible:false}];
  const ledgerRecords=[{session:baselineSession,recordHash:baselineRecord,snapshotSha256:baselineHash,previousRecordHash:null}];
  const snapshots={};
  const events=[];
  const evidence=[];
  let prev=baselineRecord;
  for(const session of sessions){
    const snap=snapshot(session);
    snapshots[session]=snap;
    const broken=failSecond===true&&session==='2026-10-12';
    const replayRow={session,snapshotSha256:snap.snapshotSha256,captureTiming:broken?'LATE_CAPTURE':'ON_SESSION_AFTER_CLOSE',recordedForwardEligible:!broken,predictionCount:1};
    replaySessions.push(replayRow);
    const lr={session,snapshotSha256:snap.snapshotSha256,sourceSessionDataHash:'src-'+session,captureTiming:replayRow.captureTiming,recordedForwardEligible:replayRow.recordedForwardEligible,previousRecordHash:prev};
    lr.recordHash=objectHash({...lr});
    prev=lr.recordHash;
    ledgerRecords.push(lr);
    events.push({eventId:session+'|AAA|CAPTURE',session,ticker:'AAA',type:'PREDICTION_CAPTURED',captureTiming:replayRow.captureTiming,recordedForwardEligible:replayRow.recordedForwardEligible});
    evidence.push({id:session+'|AAA',session,ticker:'AAA',captureTiming:replayRow.captureTiming,recordedForwardEligible:replayRow.recordedForwardEligible});
  }
  const current=sessions.length?sessions[sessions.length-1]:baselineSession;
  return {
    freeze:{release:'ASTRA V6.11',packageVersion:'6.11.0',frozenCommit:'ffffffffffffffffffffffffffffffffffffffff',stableBranch:'release-v6.11-stable',baseline:{session:baselineSession,snapshotSha256:baselineHash,predictionRecordHash:baselineRecord},liveAcceptance:{requiredDistinctSessions:2,requireCaptureTiming:'ON_SESSION_AFTER_CLOSE'}},
    replay:{sessionCount:replaySessions.length,ledgerChainStatus:'VERIFIED',sessions:replaySessions},
    prediction:{chain:{status:'VERIFIED'},records:ledgerRecords},
    events:{chain:{status:'VERIFIED'},records:events},
    evidence:{records:evidence},
    snapshots,
    cockpit:{session:current,safety:{researchOnly:true,executionAllowed:false,automaticOrders:false}},
    market:{source:{expectedSession:current,sourceSessionDataHash:'src-'+current,atomicHandoff:true}},
    history:{source:{expectedSession:current,sourceSessionDataHash:'src-'+current,atomicHandoff:true}}
  };
}

const zero=evaluateLiveAcceptance(fixture(0,false));
assert.strictEqual(zero.status,'WAITING_FOR_FIRST_SESSION');
const one=evaluateLiveAcceptance(fixture(1,false));
assert.strictEqual(one.status,'ONE_SESSION_ACCEPTED');
const two=evaluateLiveAcceptance(fixture(2,false));
assert.strictEqual(two.status,'ACCEPTANCE_COMPLETE');
const bad=evaluateLiveAcceptance(fixture(2,true));
assert.strictEqual(bad.status,'ACCEPTANCE_FAILED');
assert.ok(bad.issues.some(x=>x.scope==='2026-10-12'&&x.code==='RECORDED_FORWARD_ELIGIBLE'));
const dup=fixture(2,false);
dup.replay.sessions.push({...dup.replay.sessions[dup.replay.sessions.length-1]});
const badDup=evaluateLiveAcceptance(dup);
assert.strictEqual(badDup.status,'ACCEPTANCE_FAILED');
assert.ok(badDup.issues.some(x=>x.code==='DUPLICATE_REPLAY_SESSION'));

console.log(JSON.stringify({ok:true,cases:5},null,2));
