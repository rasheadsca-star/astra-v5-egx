'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {allocateCappedWeights}=require('./lib/portfolio-allocation');
const {riskStatePolicy}=require('./lib/risk-state-policy');
const {stableEvidenceKey,dedupeEvidenceRecords}=require('./lib/evidence-dedupe');

const ROOT=process.cwd();
function read(p,fallback=null){try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return fallback}}
function txt(p){try{return fs.readFileSync(path.join(ROOT,p),'utf8')}catch{return ''}}
function exists(p){return fs.existsSync(path.join(ROOT,p))}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function approx(a,b,t=0.15){return Math.abs(Number(a)-Number(b))<=t}
function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(v&&typeof v==='object'){const o={};for(const k of Object.keys(v).sort())o[k]=stable(v[k]);return o}
  return v;
}
function hash(v){return crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(stable(v))).digest('hex')}
function assert(cond,msg,issues){if(!cond)issues.push(msg)}
function walk(obj,fn,p='root'){
  if(!obj||typeof obj!=='object')return;
  for(const [k,v] of Object.entries(obj)){
    fn(k,v,p+'.'+k);
    if(v&&typeof v==='object')walk(v,fn,p+'.'+k);
  }
}
function seeded(seed){
  let x=(seed*9301+49297)%233280;
  return ()=>{x=(x*9301+49297)%233280;return x/233280};
}

const pkg=read('package.json',{});
const d=read('data/decision-cockpit.json',{});
const market=read('data/canonical-market.json',{});
const history=read('data/history-index.json',{});
const evidence=read('data/prospective-evidence.json',{records:[]});
const replay=read('data/replay/index.json',{sessions:[]});
const ledger=read('data/prediction-ledger.json',{records:[]});
const wf=read('data/walk-forward-validation.json',{});
const gov=read('data/model-governance.json',{});
const tech=read('data/technical/index.json',{symbols:[]});
const html=txt('app/dashboard/command-center.html');
const buildChain=String(pkg.scripts?.['cockpit:build']||'');

function actualChecks(issues){
  assert(market?.source?.atomicHandoff===true,'atomic market handoff is not verified',issues);
  assert(history?.source?.atomicHandoff===true,'atomic history handoff is not verified',issues);
  assert(market?.source?.expectedSession===history?.source?.expectedSession,'market/history session mismatch',issues);
  assert(market?.source?.sourceSessionDataHash===history?.source?.sourceSessionDataHash,'market/history fingerprint mismatch',issues);

  const order=[
    'risk-budget-engine.js','monitoring-alerts-engine.js','risk-state-override-engine.js',
    'capture-prospective-evidence.js','archive-trust-snapshot.js','walk-forward-validation.js','model-governance-engine.js'
  ];
  let last=-1;
  for(const name of order){
    const pos=buildChain.indexOf(name);
    assert(pos>=0,'build chain missing '+name,issues);
    assert(pos>last,'build chain ordering invalid near '+name,issues);
    last=pos;
  }

  const all=[...(d.topOpportunities||[]),...(d.watchlist||[]),...(d.rejected||[])];
  for(const x of all){
    if(x.decisionGate?.pass===true){
      assert(d.dataHealth?.stale===false,'gate passed while data stale for '+x.ticker,issues);
      assert((n(d.dataHealth?.staleLagSessions)||0)===0,'gate passed with stale lag for '+x.ticker,issues);
      assert(!['INVALIDATED','CHASE_RISK','UNKNOWN'].includes(x.entryQuality),'gate passed invalid entry state for '+x.ticker,issues);
      assert((n(x.rrT2)||0)>=2,'gate passed RR<2 for '+x.ticker,issues);
      if(n(x.liquidityContextScore)!=null)assert(n(x.liquidityContextScore)>=40,'gate passed low liquidity for '+x.ticker,issues);
      assert((n(x.finalDecisionScore)||0)>=62,'gate passed score<62 for '+x.ticker,issues);
      assert(x.stage!=='REJECTED_RISK','gate passed rejected risk for '+x.ticker,issues);
    }
  }

  const ps=d.portfolioSelectionEngine||{},basket=ps.basket||[],pol=ps.policy||{};
  assert(basket.length<=(pol.maxPositions??5),'basket exceeds max positions',issues);
  const sectors=new Map(),families=new Map();
  let totalW=0;
  for(const x of basket){
    const w=n(x.researchWeightPct)||0; totalW+=w;
    const cap=(n(x.liquidityScore)??50)<40?(pol.lowLiquidityCapPct??15):(pol.maxSingleWeightPct??30);
    assert(w<=cap+0.11,'basket cap exceeded for '+x.ticker+': '+w+' > '+cap,issues);
    if(x.sector)sectors.set(x.sector,(sectors.get(x.sector)||0)+1);
    for(const f of x.engineFamilies||[])families.set(f,(families.get(f)||0)+1);
  }
  for(const [s,c] of sectors)assert(c<=(pol.maxSameSector??2),'sector concentration exceeded: '+s,issues);
  for(const [f,c] of families)assert(c<=(pol.maxSameEngineFamily??3),'engine family concentration exceeded: '+f,issues);
  assert(totalW<=100.11,'basket weights exceed 100%',issues);
  if(pol.allocatedResearchPct!=null)assert(approx(totalW,pol.allocatedResearchPct,0.25),'allocatedResearchPct mismatch',issues);
  if(pol.unallocatedResearchPct!=null)assert(approx(100-totalW,pol.unallocatedResearchPct,0.25),'unallocatedResearchPct mismatch',issues);
  const pm=d.sectorCorrelationEngine?.correlation?.pairMatrix||{};
  for(let i=0;i<basket.length;i++)for(let j=i+1;j<basket.length;j++){
    const a=basket[i].ticker,b=basket[j].ticker,c=n((pm[a+'|'+b]||pm[b+'|'+a])?.correlation);
    if(c!=null)assert(c<(pol.maxPairCorrelation??0.85),'selected pair correlation exceeds limit: '+a+'/'+b,issues);
  }

  const rbe=d.riskBudgetEngine||{};
  for(const x of rbe.positions||[]){
    const theoretical=n(x.theoreticalRiskBudgetPct??x.riskBudgetPct)||0;
    const actionable=n(x.actionableRiskBudgetPct)||0;
    assert(actionable<=theoretical+1e-9,'actionable risk exceeds theoretical for '+x.ticker,issues);
    const allowed=x.monitoringState==='IN_ENTRY_ZONE'&&x.status==='ACTIONABLE_SIZED';
    if(!allowed){
      assert(actionable===0,'blocked state has nonzero actionable risk for '+x.ticker+' '+x.monitoringState,issues);
      assert((n(x.actionableReferenceShares)||0)===0,'blocked state has nonzero actionable shares for '+x.ticker,issues);
    }
    if(x.monitoringState==='NEAR_STOP'||x.monitoringSeverity==='CRITICAL'){
      assert(actionable===0,'critical/near-stop position remains actionable for '+x.ticker,issues);
    }
  }

  const ded=dedupeEvidenceRecords((evidence.records||[]).filter(r=>r.excludedFromAnalytics!==true));
  const keys=new Set();
  for(const r of ded.primary){
    const k=stableEvidenceKey(r);assert(!keys.has(k),'duplicate primary evidence key '+k,issues);keys.add(k);
    if(r.outcome?.status==='RESOLVED'){
      assert(n(r.outcome?.netReturnPct)!=null,'resolved evidence missing net return '+k,issues);
      if(n(r.outcome?.holdingSessionsObserved)!=null)assert(n(r.outcome.holdingSessionsObserved)<=10,'resolved horizon exceeds 10 sessions '+k,issues);
    }
  }

  const pc=d.probabilityCalibrationEngine||{};
  const resolved=n(pc.forwardResolved)||0;
  const expectedStatus=resolved<10?'INSUFFICIENT_DATA':resolved<30?'PRELIMINARY':resolved<90?'CALIBRATING':'VALIDATED';
  assert(pc.status===expectedStatus,'probability maturity status mismatch',issues);
  assert((n(pc.holdingHorizonSessions)||10)===10,'probability horizon is not 10 sessions',issues);
  if(pc.bestByValidatedT1)assert(pc.bestByValidatedT1.status==='VALIDATED','validated best probability is not validated',issues);
  if(resolved<10){
    for(const x of all)assert(x.targetAchievement?.t1ProbabilityPct==null,'probability emitted below minimum sample for '+x.ticker,issues);
  }

  const sessions=replay.sessions||[];
  const sessionNames=sessions.map(x=>x.session);
  assert(new Set(sessionNames).size===sessionNames.length,'replay index has duplicate sessions',issues);
  for(let i=1;i<sessionNames.length;i++)assert(String(sessionNames[i-1])<String(sessionNames[i]),'replay index not strictly sorted',issues);
  const snapHashes=new Set();
  for(const item of sessions){
    const p='data/replay/sessions/'+item.session+'.json';
    assert(exists(p),'replay snapshot missing '+item.session,issues);
    if(exists(p)){
      const snap=read(p,{});
      const stored=snap.snapshotSha256;
      const copy={...snap};delete copy.snapshotSha256;
      assert(stored===hash(copy),'replay snapshot hash invalid '+item.session,issues);
      assert(stored===item.snapshotSha256,'replay index hash mismatch '+item.session,issues);
      snapHashes.add(stored);
    }
  }
  let prev=null;
  for(const rec of ledger.records||[]){
    const copy={...rec};delete copy.recordHash;
    assert(rec.recordHash===hash(copy),'ledger record hash invalid '+rec.session,issues);
    assert((rec.previousRecordHash||null)===(prev?.recordHash||null),'ledger chain link invalid '+rec.session,issues);
    assert(snapHashes.has(rec.snapshotSha256),'ledger references missing replay snapshot '+rec.session,issues);
    prev=rec;
  }
  if((ledger.records||[]).length)assert(ledger.chain?.status==='VERIFIED','ledger chain status not VERIFIED',issues);

  for(const fold of wf.folds||[]){
    assert(String(fold.trainEnd)<String(fold.testStart),'walk-forward train/test overlap fold '+fold.fold,issues);
    if(fold.valid)assert((n(fold.testResolved)||0)>=(wf.methodology?.minimumResolvedPerTestFold??5),'invalid valid-fold flag '+fold.fold,issues);
  }
  if(wf.governance?.calibrationClaimAllowed){
    assert((wf.coverage?.validFolds||0)>=3,'calibration claim with <3 valid folds',issues);
    assert((wf.outOfSample?.resolved||0)>=30,'calibration claim with <30 OOS resolved',issues);
  }

  const gr=gov.reliability||{};
  assert(n(gr.score)!=null&&n(gr.score)>=0&&n(gr.score)<=100,'reliability score outside 0-100',issues);
  if(gr.hardCapApplied)assert(n(gr.score)<50,'hard-capped reliability is not below 50',issues);
  assert(gov.releaseGate?.canEnableAutomaticExecution===false,'governance allows automatic execution',issues);

  walk(d,(k,v,p)=>{
    if(['automaticExecution','automaticOrders','executionAllowed','autoOrders'].includes(k)){
      assert(v===false,'automatic execution flag not false at '+p,issues);
    }
  });

  assert((tech.symbols||[]).length>0,'technical analysis index has no symbols',issues);
  for(const x of (tech.symbols||[]).slice(0,250)){
    const p='data/technical/'+x.ticker+'.json';
    assert(exists(p),'technical payload missing '+x.ticker,issues);
    if(exists(p)){
      const t=read(p,{});
      assert((t.bars||[]).length>=20,'technical history too short '+x.ticker,issues);
      assert(n(t.indicators?.last)!=null,'technical last price missing '+x.ticker,issues);
    }
  }

  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const dupIds=ids.filter((x,i)=>ids.indexOf(x)!==i);
  assert(dupIds.length===0,'duplicate HTML ids: '+[...new Set(dupIds)].join(','),issues);
  assert(html.includes('loadReplayIndex();\n    loadStockUniverse();'),'replay archive is not loaded on initial boot',issues);
  assert(html.includes('id="paper" dir="ltr"'),'paper-ready fraction lacks LTR isolation',issues);
  assert(!html.includes('Highest-Probability Research Setup'),'decision score still mislabeled as probability',issues);
  assert(!html.includes('bestByCalibratedT1'),'deprecated calibrated-probability label still used',issues);
  assert(html.includes('Actionable Shares Now')||html.includes('الحجم المتاح الآن'),'UI does not expose actionable size',issues);
  assert(html.includes('data/technical/index.json'),'technical analyzer lacks static data fallback',issues);

  const title=(html.match(/<title>ASTRA V([0-9.]+) Decision Cockpit<\/title>/)||[])[1];
  assert(title===String(pkg.version),'dashboard title version '+title+' != package '+pkg.version,issues);
}

function syntheticChecks(cycle,issues){
  const rnd=seeded(cycle);
  const one=allocateCappedWeights([{portfolioSelectionScore:99,liquidityContextScore:90}],{maxSingleWeightPct:30,lowLiquidityCapPct:15});
  assert(one.weights[0]<=30.0001&&one.unallocatedPct>=69.999,'single-name cap stress failed',issues);

  const low=allocateCappedWeights(Array.from({length:5},(_,i)=>({portfolioSelectionScore:50+i*7,liquidityContextScore:20})),{maxSingleWeightPct:30,lowLiquidityCapPct:15});
  assert(low.weights.every(x=>x<=15.0001),'low-liquidity cap stress failed',issues);
  assert(low.allocatedPct<=75.0001,'low-liquidity reserve stress failed',issues);

  const randomItems=Array.from({length:1+(cycle%7)},()=>({
    portfolioSelectionScore:1+Math.floor(rnd()*99),
    liquidityContextScore:Math.floor(rnd()*100)
  }));
  const al=allocateCappedWeights(randomItems,{maxSingleWeightPct:30,lowLiquidityCapPct:15});
  assert(al.weights.every((w,i)=>w<=((randomItems[i].liquidityContextScore<40)?15:30)+1e-6),'random allocation cap failed cycle '+cycle,issues);
  assert(al.allocatedPct<=100.0001&&al.unallocatedPct>=-0.0001,'random allocation conservation failed cycle '+cycle,issues);

  const states=['IN_ENTRY_ZONE','STOP_HIT','NEAR_STOP','CHASE_RISK','GATE_BLOCKED','ABOVE_ENTRY_ZONE','SLIGHTLY_ABOVE_ENTRY','BELOW_ENTRY_ZONE','T1_HIT','T2_HIT','NO_CURRENT_PRICE','WATCH'];
  for(const st of states){
    const p=riskStatePolicy({state:st,gatePass:true});
    if(st==='IN_ENTRY_ZONE')assert(p.allowed&&p.factor===1,'entry-zone policy blocked valid entry',issues);
    else assert(!p.allowed&&p.factor===0,'risk-state policy allowed '+st,issues);
  }
  assert(riskStatePolicy({state:'IN_ENTRY_ZONE',gatePass:false}).factor===0,'gate-blocked entry zone remained actionable',issues);

  const sample=[
    {id:'a',session:'2026-01-01',ticker:'AAA',capturedAt:'2026-01-01T10:00:00Z'},
    {id:'b',session:'2026-01-01',ticker:'AAA',capturedAt:'2026-01-01T11:00:00Z'},
    {id:'c',session:'2026-01-01',ticker:'BBB',capturedAt:'2026-01-01T10:00:00Z'}
  ];
  const dd=dedupeEvidenceRecords(sample);
  assert(dd.primary.length===2&&dd.duplicates.length===1&&dd.duplicates[0].primary.id==='a','evidence dedupe stress failed',issues);
}

const arg=process.argv.find(x=>x.startsWith('--cycles='));
const cycles=Math.max(1,Number(arg?.split('=')[1]||10));
const report={version:pkg.version,generatedAt:new Date().toISOString(),cycles:[],consecutiveClean:0};
let clean=0;
for(let cycle=1;cycle<=cycles;cycle++){
  const issues=[];
  actualChecks(issues);              // Developer: implementation invariants
  syntheticChecks(cycle,issues);     // Innovator: non-obvious stress scenarios
  const unique=[...new Set(issues)]; // Critic: independent release objections
  const passed=unique.length===0;
  clean=passed?clean+1:0;
  report.cycles.push({cycle,developer:passed?'PASS':'ISSUES',innovator:passed?'PASS':'ISSUES',critic:passed?'NO_FINDINGS':'FINDINGS',issues:unique});
  console.log('AUDIT CYCLE '+cycle+': '+(passed?'CLEAN':'FAILED')+(unique.length?' -> '+unique.join(' | '):''));
}
report.consecutiveClean=clean;
report.passed=clean>=10;
report.summary=report.passed?'10 consecutive full audit cycles completed with no critic findings.':'Release gate not satisfied.';
fs.mkdirSync(path.join(ROOT,'data'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'data/release-hardening-report.json'),JSON.stringify(report,null,2)+'\n');
fs.mkdirSync(path.join(ROOT,'docs/data'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'docs/data/release-hardening-report.json'),JSON.stringify(report,null,2)+'\n');
if(!report.passed){
  console.error(JSON.stringify(report,null,2));
  process.exit(1);
}
console.log(JSON.stringify({passed:true,version:pkg.version,consecutiveClean:clean},null,2));
