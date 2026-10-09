'use strict';

const fs=require('fs'),path=require('path');
const {evaluateLiveAcceptance}=require('./lib/live-acceptance');

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}

const freeze=read('config/release-freeze.json',null);
if(!freeze)throw new Error('release freeze config missing');

const replay=read('data/replay/index.json',{sessions:[]});
const prediction=read('data/prediction-ledger.json',{records:[]});
const events=read('data/evidence-event-ledger.json',{records:[]});
const evidence=read('data/prospective-evidence.json',{records:[]});
const cockpit=read('data/decision-cockpit.json',{});
const market=read('data/canonical-market.json',{});
const history=read('data/history-index.json',{});
const snapshots={};
for(const item of replay.sessions||[]){
  const p='data/replay/sessions/'+item.session+'.json';
  const s=read(p,null);
  if(s)snapshots[String(item.session)]=s;
}

const payload=evaluateLiveAcceptance({freeze,replay,prediction,events,evidence,snapshots,cockpit,market,history});
write('data/live-acceptance.json',payload);
write('docs/data/live-acceptance.json',payload);

cockpit.liveAcceptanceEngine=payload;
write('data/decision-cockpit.json',cockpit);
write('docs/data/decision-cockpit.json',cockpit);

if(process.argv.includes('--summary')){
  console.log('## ASTRA V6.11 Live Acceptance');
  console.log('');
  console.log('- Status: **'+payload.status+'**');
  console.log('- Baseline session: '+payload.baselineSession);
  console.log('- Accepted sessions: '+(payload.acceptedSessions.length?payload.acceptedSessions.join(', '):'none yet'));
  console.log('- Remaining sessions: **'+payload.remainingSessions+'**');
  console.log('- Automatic execution: **OFF**');
  console.log('');
  console.log('| Session | Result | Timing | Evidence events | Prospective records |');
  console.log('|---|---|---|---:|---:|');
  for(const s of payload.sessionReports){
    console.log('| '+s.session+' | '+(s.passed?'PASS':'FAIL')+' | '+(s.captureTiming||'-')+' | '+s.evidenceCaptureEvents+' | '+s.prospectiveEvidenceRecords+' |');
  }
  if(payload.issues.length){
    console.log('');
    console.log('### Issues');
    for(const x of payload.issues)console.log('- '+x.code+' ('+x.scope+'): '+String(x.detail??''));
  }
}else{
  console.log(JSON.stringify({
    release:payload.release,status:payload.status,acceptedSessions:payload.acceptedSessions,
    remainingSessions:payload.remainingSessions,issues:payload.issues
  },null,2));
}

if(process.argv.includes('--require-complete')&&payload.status!=='ACCEPTANCE_COMPLETE'){
  process.exitCode=2;
}
if(process.argv.includes('--fail-on-acceptance-error')&&payload.status==='ACCEPTANCE_FAILED'){
  process.exitCode=1;
}
