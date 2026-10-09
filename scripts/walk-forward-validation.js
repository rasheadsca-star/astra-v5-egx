'use strict';

const fs=require('fs'),path=require('path');
const {dedupeEvidenceRecords,stableEvidenceKey}=require('./lib/evidence-dedupe');
const ROOT=process.cwd();
const INDEX='data/replay/index.json';
const EVID='data/prospective-evidence.json';
const COCKPIT='data/decision-cockpit.json';
const OUT='data/walk-forward-validation.json';
const DOC='docs/data/walk-forward-validation.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return fallback}}
function write(p,v){const f=path.join(ROOT,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n')}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function r(v,d=2){return Number.isFinite(v)?+v.toFixed(d):null}
function mean(a){const x=a.filter(Number.isFinite);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null}
function std(a){const x=a.filter(Number.isFinite);if(x.length<2)return null;const m=mean(x);return Math.sqrt(x.reduce((s,v)=>s+(v-m)*(v-m),0)/(x.length-1))}
function maxDrawdown(returns){
  let eq=1,peak=1,maxdd=0;
  for(const x of returns){eq*=1+x/100;peak=Math.max(peak,eq);maxdd=Math.max(maxdd,(peak-eq)/peak)}
  return r(maxdd*100,2);
}
function aggregate(rows){
  const resolved=rows.filter(x=>x.outcome?.status==='RESOLVED');
  const returns=resolved.map(x=>n(x.outcome?.netReturnPct)).filter(Number.isFinite);
  const wins=returns.filter(x=>x>0),losses=returns.filter(x=>x<0);
  const grossWin=wins.reduce((s,x)=>s+x,0),grossLoss=Math.abs(losses.reduce((s,x)=>s+x,0));
  return {
    resolved:resolved.length,
    winRatePct:resolved.length?r(100*wins.length/resolved.length,1):null,
    expectancyPct:returns.length?r(mean(returns),2):null,
    profitFactor:grossLoss>0?r(grossWin/grossLoss,2):(grossWin>0?null:null),
    volatilityPct:returns.length>1?r(std(returns),2):null,
    maxDrawdownPct:returns.length?maxDrawdown(returns):null
  };
}

const idx=read(INDEX,{sessions:[]}),evid=read(EVID,{records:[]}),d=read(COCKPIT,null);
if(!d)throw new Error('decision cockpit missing');

const sessions=(idx.sessions||[]).map(x=>x.session).filter(Boolean).sort();
const sessionSet=new Set(sessions);
const eligibleEvidence=dedupeEvidenceRecords((evid.records||[]).filter(r=>r.excludedFromAnalytics!==true&&sessionSet.has(r.session))).primary;

const trainWindow=20;
const testWindow=5;
const minResolvedPerTest=5;
const folds=[];

for(let start=0;start+trainWindow+testWindow<=sessions.length;start+=testWindow){
  const trainSessions=sessions.slice(start,start+trainWindow);
  const testSessions=sessions.slice(start+trainWindow,start+trainWindow+testWindow);
  const trainRows=eligibleEvidence.filter(r=>trainSessions.includes(r.session));
  const testRows=eligibleEvidence.filter(r=>testSessions.includes(r.session));

  // Freeze descriptive training diagnostics. No thresholds are optimized here yet.
  const trainStats=aggregate(trainRows);
  const testStats=aggregate(testRows);
  folds.push({
    fold:folds.length+1,
    trainStart:trainSessions[0],
    trainEnd:trainSessions.at(-1),
    testStart:testSessions[0],
    testEnd:testSessions.at(-1),
    trainSessions:trainSessions.length,
    testSessions:testSessions.length,
    trainResolved:trainStats.resolved,
    testResolved:testStats.resolved,
    train:trainStats,
    test:testStats,
    valid:testStats.resolved>=minResolvedPerTest
  });
}

const validFolds=folds.filter(x=>x.valid);
const allTestRows=[];
for(const f of validFolds){
  for(const r0 of eligibleEvidence){
    if(r0.session>=f.testStart&&r0.session<=f.testEnd&&r0.outcome?.status==='RESOLVED')allTestRows.push(r0);
  }
}
const unique=new Map(allTestRows.map(x=>[stableEvidenceKey(x),x]));
const oos=aggregate([...unique.values()]);

const status=sessions.length<trainWindow+testWindow
  ?'WAITING_FOR_MINIMUM_SESSIONS'
  :validFolds.length===0
    ?'WAITING_FOR_RESOLVED_TEST_OUTCOMES'
    :validFolds.length<3
      ?'PRELIMINARY'
      :'ACTIVE';

const payload={
  schemaVersion:'astra-walk-forward-validation/v1',
  generatedAt:new Date().toISOString(),
  methodology:{
    noLookAhead:true,
    source:'persisted V6 replay sessions + prospective evidence only',
    trainWindowSessions:trainWindow,
    testWindowSessions:testWindow,
    stepSessions:testWindow,
    minimumResolvedPerTestFold:minResolvedPerTest,
    optimizationPolicy:'NO_PARAMETER_OPTIMIZATION_IN_V6.1; frozen model evaluated forward only',
    note:'This engine intentionally refuses to reconstruct pre-V6 decisions from future-known data.'
  },
  coverage:{
    replaySessions:sessions.length,
    firstSession:sessions[0]||null,
    lastSession:sessions.at(-1)||null,
    requiredForFirstFold:trainWindow+testWindow,
    sessionsRemainingForFirstFold:Math.max(0,trainWindow+testWindow-sessions.length),
    folds:folds.length,
    validFolds:validFolds.length
  },
  status,
  outOfSample:oos,
  folds,
  governance:{
    automaticExecution:false,
    researchOnly:true,
    calibrationClaimAllowed:validFolds.length>=3&&oos.resolved>=30,
    trustClaim:status==='ACTIVE'?'MULTI_FOLD_FORWARD_EVIDENCE_AVAILABLE':'NOT_YET_ESTABLISHED'
  }
};

write(OUT,payload);write(DOC,payload);
d.walkForwardValidationEngine=payload;
write(COCKPIT,d);write('docs/data/decision-cockpit.json',d);
console.log(JSON.stringify(payload,null,2));
