'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const ROOT=process.cwd();
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'config/node-validation-suite.json'),'utf8'));
const protectedFiles=[
  'data/decision-cockpit.json','data/prospective-evidence.json','data/prediction-ledger.json',
  'data/evidence-event-ledger.json','data/replay/index.json','data/walk-forward-validation.json',
  'data/model-governance.json','data/canonical-market.json','data/history-index.json'
];
function hash(p){
  const f=path.join(ROOT,p);
  return fs.existsSync(f)?crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'):null;
}
const before=Object.fromEntries(protectedFiles.map(p=>[p,hash(p)]));
const results=[];
for(const rel of cfg.validations){
  const started=Date.now();
  const r=cp.spawnSync(process.execPath,[rel],{cwd:ROOT,encoding:'utf8',stdio:'pipe'});
  const item={file:rel,ok:r.status===0,durationMs:Date.now()-started};
  results.push(item);
  process.stdout.write('\n=== '+rel+' ===\n');
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.stderr)process.stderr.write(r.stderr);
  if(r.status!==0){
    console.error(JSON.stringify({ok:false,failed:rel,results},null,2));
    process.exit(r.status||1);
  }
}
const after=Object.fromEntries(protectedFiles.map(p=>[p,hash(p)]));
const mutated=protectedFiles.filter(p=>before[p]!==after[p]);
if(mutated.length){
  console.error('NON_MUTATING_TEST_SUITE_CHANGED_PROTECTED_FILES',mutated);
  process.exit(1);
}
console.log(JSON.stringify({ok:true,count:results.length,totalMs:results.reduce((s,x)=>s+x.durationMs,0),mutatedProtectedFiles:[],results},null,2));
