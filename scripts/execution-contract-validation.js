'use strict';

const fs=require('fs');
const assert=require('assert');
const {evaluatePlan,DEFAULT_SPEC}=require('./lib/execution-contract');

const golden=JSON.parse(fs.readFileSync('config/execution-golden-vectors.json','utf8'));
assert.strictEqual(golden.specVersion,DEFAULT_SPEC.version);
assert.ok(golden.vectors.length>=30);

function near(a,b,t=1e-10){return a==null&&b==null || (Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=t)}

let passed=0;
for(const v of golden.vectors){
  const got=evaluatePlan(v);
  const exp=v.expected;
  assert.strictEqual(got.status,exp.status,v.id+' status');
  assert.strictEqual(got.hit1,exp.hit1,v.id+' hit1');
  assert.strictEqual(got.hit2,exp.hit2,v.id+' hit2');
  assert.strictEqual(got.locked,exp.locked,v.id+' locked');
  assert.ok(near(got.ret,exp.netReturnRate,1e-9),v.id+' ret got='+got.ret+' expected='+exp.netReturnRate);
  passed++;
}
console.log(JSON.stringify({ok:true,engine:'node',spec:DEFAULT_SPEC.version,goldenVectors:passed},null,2));
