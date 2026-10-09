'use strict';

const fs=require('fs');
const assert=require('assert');
const {
  weightedAvailable,scoreWithWeights,sensitivity,BASE_WEIGHTS,grade
}=require('./lib/final-score-policy');

const registry=JSON.parse(fs.readFileSync('config/engine-family-registry.json','utf8'));
const comparison=JSON.parse(fs.readFileSync('docs/data/engine-comparison.json','utf8'));

const familyIds=new Set(registry.families.map(x=>x.id));
assert.strictEqual(familyIds.size,registry.families.length,'duplicate engine family IDs');
const nq=registry.families.find(x=>x.id==='NEXT_QUANT');
assert.ok(nq.members.includes('V2.1')&&nq.members.includes('V5'));
assert.strictEqual(nq.maxAgreementVotes,1);
const cf=registry.families.find(x=>x.id==='CONFLUENCE');
assert.ok(cf.members.includes('CONFLUENCE_V1')&&cf.members.includes('CONFLUENCE_V2'));
assert.strictEqual(cf.maxAgreementVotes,1);
assert.strictEqual(registry.families.some(x=>x.statisticalIndependenceClaim===true),false);

if(comparison.independence?.v2AndV5IndependentToday===false){
  assert.strictEqual(nq.relationship,'SAME_PUBLISHED_RANKING_PAYLOAD');
}

const full={technical:80,entryQuality:90,context:70,riskReward:80,riskControl:85,evidence:65};
const fullRow={entryQuality:'IDEAL',stage:'WATCHLIST',warnings:[]};
const fullScore=scoreWithWeights(full,fullRow,BASE_WEIGHTS);
assert.ok(fullScore.score>0&&fullScore.coveragePct===100);
assert.deepStrictEqual(fullScore.missing,[]);

const missingRisk={...full,riskControl:null};
const mr=scoreWithWeights(missingRisk,fullRow,BASE_WEIGHTS);
assert.ok(mr.missing.includes('riskControl'));
assert.ok(mr.score<=61.9,'critical missing input must cap score below B threshold');
assert.ok(mr.coveragePct<100);

const missingContext={...full,context:null};
const mc=scoreWithWeights(missingContext,fullRow,BASE_WEIGHTS);
assert.ok(mc.score<=74.9,'missing context cap failed');

const noNeutral=weightedAvailable({technical:100,entryQuality:null},{technical:.5,entryQuality:.5});
assert.strictEqual(noNeutral.score,100,'missing entry must not be imputed to neutral 50');
assert.strictEqual(noNeutral.coveragePct,50);

const sens=sensitivity(full,fullRow,BASE_WEIGHTS);
assert.strictEqual(sens.cases.length,12);
assert.ok(sens.cases.every(x=>x.factor===0.8||x.factor===1.2));
assert.ok(Number.isFinite(sens.maxAbsDelta));

const g=grade(fullScore.score,fullRow);
assert.ok(['A+','A','B','C','REJECT'].includes(g));

console.log(JSON.stringify({
  ok:true,
  engineFamilies:registry.families.map(x=>({id:x.id,members:x.members,maxAgreementVotes:x.maxAgreementVotes})),
  fullScore:fullScore.score,
  missingRiskScore:mr.score,
  missingContextScore:mc.score,
  sensitivity:{status:sens.status,min:sens.min,max:sens.max,maxAbsDelta:sens.maxAbsDelta}
},null,2));
