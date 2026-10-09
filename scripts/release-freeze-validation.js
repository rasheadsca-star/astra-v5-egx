'use strict';

const fs=require('fs');
const assert=require('assert');
const crypto=require('crypto');
const {execFileSync}=require('child_process');

function read(p){return JSON.parse(fs.readFileSync(p,'utf8'))}

function gitBlobSha(p){
  const b=fs.readFileSync(p);
  const h=crypto.createHash('sha1');
  h.update(Buffer.from('blob '+b.length));
  h.update(Buffer.from([0]));
  h.update(b);
  return h.digest('hex');
}

const freeze=read('config/release-freeze.json');
const pkg=read('package.json');
const cockpit=read('data/decision-cockpit.json');
const replay=read('data/replay/index.json');
const ledger=read('data/prediction-ledger.json');

assert.strictEqual(freeze.release,'ASTRA V6.11');
assert.strictEqual(freeze.packageVersion,pkg.version);
assert.strictEqual(freeze.codeFreeze,true);
assert.match(freeze.frozenCommit,/^[0-9a-f]{40}$/);
assert.strictEqual(freeze.stableBranch,'release-v6.11-stable');
assert.strictEqual(freeze.freezePolicy.automaticExecution,false);
assert.strictEqual(freeze.freezePolicy.strategyChangesAllowed,false);
assert.strictEqual(freeze.freezePolicy.scoringChangesAllowed,false);
assert.strictEqual(freeze.freezePolicy.executionContractChangesAllowed,false);
assert.strictEqual(freeze.freezePolicy.dataSourceLogicChangesAllowed,false);
assert.strictEqual(freeze.freezePolicy.requireStableBranchPointer,true);

function verifyStableBranchPointer(){
  const shouldCheck=process.env.GITHUB_ACTIONS==='true'||process.env.REQUIRE_RELEASE_BRANCH_POINTER==='1';
  if(!shouldCheck)return {checked:false,reason:'non-ci'};
  let out='';
  try{
    out=execFileSync('git',['ls-remote','--heads','origin',freeze.stableBranch],{
      encoding:'utf8',stdio:['ignore','pipe','pipe']
    }).trim();
  }catch(err){
    assert.fail('unable to verify stable release branch pointer: '+String(err.stderr||err.message||err));
  }
  const ref='refs/heads/'+freeze.stableBranch;
  const line=out.split(/\r?\n/).find(x=>x.trim().endsWith(ref));
  assert.ok(line,'stable release branch missing: '+freeze.stableBranch);
  const remoteSha=line.trim().split(/\s+/)[0];
  assert.strictEqual(remoteSha,freeze.frozenCommit,'stable release branch moved from frozen commit');
  return {checked:true,sha:remoteSha};
}

const branchPointer=verifyStableBranchPointer();
const protectedFiles=freeze.freezePolicy.protectedBlobShas||{};
assert.ok(Object.keys(protectedFiles).length>=20,'protected release file set too small');
for(const [p,expected] of Object.entries(protectedFiles)){
  assert.ok(fs.existsSync(p),'protected file missing: '+p);
  assert.strictEqual(gitBlobSha(p),expected,'protected file changed during freeze: '+p);
}

const b=freeze.baseline;
const replayItem=(replay.sessions||[]).find(x=>x.session===b.session);
const ledgerItem=(ledger.records||[]).find(x=>x.session===b.session);
assert.ok(replayItem,'frozen baseline replay session missing');
assert.ok(ledgerItem,'frozen baseline prediction record missing');
assert.strictEqual(replayItem.snapshotSha256,b.snapshotSha256,'frozen replay snapshot changed');
assert.strictEqual(ledgerItem.recordHash,b.predictionRecordHash,'frozen ledger record changed');

assert.strictEqual(cockpit.safety?.researchOnly,true);
assert.strictEqual(cockpit.safety?.executionAllowed,false);
assert.strictEqual(cockpit.safety?.automaticOrders,false);

console.log(JSON.stringify({
  ok:true,
  release:freeze.release,
  frozenCommit:freeze.frozenCommit,
  baselineSession:b.session,
  execution:'OFF',protectedFiles:Object.keys(protectedFiles).length,stableBranchPointer:branchPointer
},null,2));
