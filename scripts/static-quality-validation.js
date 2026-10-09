'use strict';

const fs=require('fs'),path=require('path'),cp=require('child_process');
const ROOT=process.cwd();
const SKIP_DIRS=new Set(['.git','node_modules','.next']);
function walk(dir,out=[]){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(SKIP_DIRS.has(ent.name))continue;
    const p=path.join(dir,ent.name);
    if(ent.isDirectory())walk(p,out); else out.push(p);
  }
  return out;
}
const files=walk(ROOT);
const jsonFiles=files.filter(p=>p.endsWith('.json'));
for(const f of jsonFiles){
  try{JSON.parse(fs.readFileSync(f,'utf8'))}
  catch(e){console.error('INVALID_JSON',path.relative(ROOT,f),e.message);process.exit(1)}
}
const jsFiles=files.filter(p=>{
  const rel=path.relative(ROOT,p).replaceAll('\\','/');
  return p.endsWith('.js')&&(rel.startsWith('scripts/')||rel.startsWith('app/api/')||rel.startsWith('engine/'));
});
for(const f of jsFiles){
  const rel=path.relative(ROOT,f);
  const r=cp.spawnSync(process.execPath,['--check',f],{encoding:'utf8'});
  if(r.status!==0){
    console.error('JS_SYNTAX_FAILED',rel,'\n',r.stderr||r.stdout);
    process.exit(1);
  }
}
const ignored=fs.readFileSync('.gitignore','utf8');
for(const required of ['data/technical/','docs/data/technical/','data/release-hardening-report.json','docs/data/release-hardening-report.json']){
  if(!ignored.includes(required)){
    console.error('GENERATED_OUTPUT_NOT_IGNORED',required);process.exit(1);
  }
}
console.log(JSON.stringify({ok:true,jsonParsed:jsonFiles.length,jsSyntaxChecked:jsFiles.length,generatedOutputPolicy:'PASS'},null,2));
