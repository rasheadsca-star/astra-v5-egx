'use strict';

const fs = require('fs');
const path = require('path');

const V4_REPO = 'rasheadsca-star/RAS-EGX-PRO2026-NEXT';
const LEDGER_PATH = 'astra-prod/app/intelligence/recommendation-ledger.json';
const OUTCOMES_PATH = 'astra-prod/app/intelligence/recommendation-outcomes.json';

function readJson(file){
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function writeJson(file,value){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n','utf8');
}
async function githubJson(repo,file){
  const url='https://api.github.com/repos/'+repo+'/contents/'+file+'?ref=main&fresh='+Date.now();
  const headers={
    Accept:'application/vnd.github.raw+json',
    'Cache-Control':'no-cache',
    'User-Agent':'ASTRA-V5-COMPARISON/1.0'
  };
  if(process.env.GITHUB_TOKEN) headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
  const r=await fetch(url,{headers});
  if(!r.ok) throw new Error('GITHUB_'+r.status+':'+file);
  return JSON.parse(await r.text());
}
function tickerOf(x){ return x?.ticker || x?.symbol || null; }
function sessionOf(x){
  return x?.sessionDate || x?.decisionSession || x?.signalDate ||
    x?.outcomeSession || x?.evaluationSession || x?.asOfSession || null;
}
function v2Rows(payload){
  return (payload.recommendations||[]).map(x=>({
    ticker:x.ticker, rank:x.rank, tier:x.tier,
    entryLow:Array.isArray(x.entry_zone)?x.entry_zone[0]:null,
    entryHigh:Array.isArray(x.entry_zone)?x.entry_zone[1]:null,
    stop:x.stop, target1:x.target1, target2:x.target2,
    score:x.score ?? null, state:'PREPARED'
  }));
}
function v5Rows(payload){
  return (payload.candidates||[]).map(x=>({
    ticker:x.ticker, rank:x.rank, tier:x.tier,
    entryLow:x.entryLow, entryHigh:x.entryHigh,
    stop:x.stop, target1:x.target1, target2:x.target2,
    score:x.score ?? null, state:'PREPARED'
  }));
}
function v4Rows(ledger,outcomes,session){
  const om=new Map((outcomes.records||[])
    .filter(x=>sessionOf(x)===session)
    .map(x=>[tickerOf(x),x]));
  return (ledger.records||[])
    .filter(x=>sessionOf(x)===session)
    .map(x=>{
      const o=om.get(tickerOf(x))||{};
      return {
        ticker:tickerOf(x), rank:x.rank ?? null, tier:null,
        entryLow:x.entryPlan?.low ?? null,
        entryHigh:x.entryPlan?.high ?? null,
        stop:x.stopLoss ?? null,
        target1:Array.isArray(x.targets)?x.targets[0]??null:null,
        target2:Array.isArray(x.targets)?x.targets[1]??null:null,
        score:x.score ?? null,
        state:o.state || o.status || o.outcome || x.initialState || 'ISSUED',
        returnPct:o.returnPct ?? o.netReturnPct ?? o.pnlPct ?? null
      };
    });
}
function metrics(rows){
  const resolved=rows.filter(x=>['TARGET1','TARGET2','STOP','WIN','LOSS','CLOSED','RESOLVED'].includes(String(x.state||'').toUpperCase()) || Number.isFinite(Number(x.returnPct)));
  const wins=resolved.filter(x=>Number(x.returnPct)>0 || /TARGET|WIN/.test(String(x.state||'').toUpperCase())).length;
  const losses=resolved.filter(x=>Number(x.returnPct)<0 || /STOP|LOSS/.test(String(x.state||'').toUpperCase())).length;
  const returns=resolved.map(x=>Number(x.returnPct)).filter(Number.isFinite);
  return {
    recommendations:rows.length,
    resolved:resolved.length,
    wins, losses,
    open:rows.filter(x=>/WAITING|OPEN|ISSUED|PREPARED/.test(String(x.state||'').toUpperCase())).length,
    hitRatePct:resolved.length?Number((wins/resolved.length*100).toFixed(1)):null,
    avgReturnPct:returns.length?Number((returns.reduce((a,b)=>a+b,0)/returns.length).toFixed(3)):null
  };
}
function overlap(a,b){
  const bs=new Set(b.map(x=>x.ticker));
  return a.map(x=>x.ticker).filter(Boolean).filter(x=>bs.has(x));
}

(async()=>{
  const v5=readJson('data/quant/signals.json');
  const v2=readJson('docs/data/signals.json');
  const session=v5.session || v2.session;
  if(!session) throw new Error('COMPARISON_SESSION_MISSING');

  const [ledger,outcomes]=await Promise.all([
    githubJson(V4_REPO,LEDGER_PATH),
    githubJson(V4_REPO,OUTCOMES_PATH)
  ]);

  const engines={
    v2:{id:'EGX-NEXT-V2.1',session,rows:v2Rows(v2)},
    v4:{id:'ASTRA-V4',session,rows:v4Rows(ledger,outcomes,session)},
    v5:{id:'EGX-NEXT-QUANT-V5',session,rows:v5Rows(v5)}
  };
  for(const e of Object.values(engines)) e.metrics=metrics(e.rows);

  const v2v5=overlap(engines.v2.rows,engines.v5.rows);
  const current={
    schemaVersion:'astra-engine-comparison/v1',
    generatedAt:new Date().toISOString(),
    session,
    engines,
    overlap:{
      v2_v4:overlap(engines.v2.rows,engines.v4.rows),
      v2_v5:v2v5,
      v4_v5:overlap(engines.v4.rows,engines.v5.rows)
    },
    independence:{
      v2AndV5IndependentToday:false,
      reason:v2v5.length===engines.v2.rows.length && v2v5.length===engines.v5.rows.length
        ? 'V2.1 published page and V5 quant lane currently render the same astra-quant/v1 ranking payload for this session.'
        : 'V2.1 and V5 recommendation sets differ for this session.'
    },
    safety:{
      executionAllowed:false,
      winnerDeclared:false,
      note:'No winner is declared from unresolved same-session recommendations.'
    }
  };

  writeJson('docs/data/engine-comparison.json',current);

  const historyFile='data/comparison/daily.json';
  let history={schemaVersion:'astra-engine-comparison-history/v1',sessions:[]};
  if(fs.existsSync(historyFile)){
    try{ history=readJson(historyFile); }catch{}
  }
  history.sessions=Array.isArray(history.sessions)?history.sessions:[];
  const idx=history.sessions.findIndex(x=>x.session===session);
  const compact={
    session,
    generatedAt:current.generatedAt,
    metrics:Object.fromEntries(Object.entries(engines).map(([k,e])=>[k,e.metrics])),
    tickers:Object.fromEntries(Object.entries(engines).map(([k,e])=>[k,e.rows.map(x=>x.ticker)])),
    overlap:current.overlap,
    independence:current.independence
  };
  if(idx>=0) history.sessions[idx]=compact; else history.sessions.push(compact);
  history.sessions.sort((a,b)=>String(a.session).localeCompare(String(b.session)));
  writeJson(historyFile,history);

  console.log(JSON.stringify({
    session,
    v2:engines.v2.metrics,
    v4:engines.v4.metrics,
    v5:engines.v5.metrics,
    overlap:current.overlap,
    independence:current.independence
  },null,2));
})().catch(err=>{console.error(err);process.exit(1);});
