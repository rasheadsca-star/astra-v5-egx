'use strict';

const fs=require('fs'),path=require('path');
const IN='data/decision-cockpit.json';
const OUT='data/prospective-evidence.json';
const DOC='docs/data/prospective-evidence.json';

function read(p,fallback){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return fallback}}
function write(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')}
function finite(v){return Number.isFinite(Number(v))?Number(v):null}

const cockpit=read(IN,null);
if(!cockpit) throw new Error('decision cockpit missing');

const prior=read(OUT,{schemaVersion:'astra-prospective-evidence/v1',records:[]});
const map=new Map((prior.records||[]).map(r=>[r.id,r]));

for(const x of [...(cockpit.topOpportunities||[]),...(cockpit.watchlist||[]),...(cockpit.rejected||[])]){
  const id=[cockpit.session,x.ticker,x.stage].join('|');
  if(map.has(id)) continue;
  map.set(id,{
    id,
    capturedAt:cockpit.generatedAt,
    session:cockpit.session,
    ticker:x.ticker,
    stage:x.stage,
    rank:x.rank??null,
    conviction:finite(x.conviction),
    qualityScore:finite(x.qualityScore),
    agreementCount:x.agreementCount??0,
    engineFamilies:x.engineFamilies||[],
    entryLow:finite(x.entryLow),
    entryHigh:finite(x.entryHigh),
    stop:finite(x.stop),
    target1:finite(x.target1),
    target2:finite(x.target2),
    riskPct:finite(x.riskPct),
    rrT2:finite(x.rrT2),
    currentPrice:finite(x.currentPrice),
    entryQuality:x.entryQuality??null,
    entryQualityScore:finite(x.entryQualityScore),
    entryDistancePct:finite(x.entryDistancePct),
    chaseDistancePct:finite(x.chaseDistancePct),
    contextScore:finite(x.contextScore),
    contextAdjustment:finite(x.contextAdjustment),
    adjustedConviction:finite(x.adjustedConviction),
    marketContextScore:finite(x.marketContextScore),
    sectorContextScore:finite(x.sectorContextScore),
    sectorContextStatus:x.sectorContextStatus??null,
    liquidityContextScore:finite(x.liquidityContextScore),
    finalDecisionScore:finite(x.finalDecisionScore),
    finalDecisionGrade:x.finalDecisionGrade??null,
    finalDecisionLabel:x.finalDecisionLabel??null,
    portfolioSelected:x.portfolioSelected===true,
    portfolioRank:x.portfolioRank??null,
    portfolioResearchWeightPct:finite(x.portfolioResearchWeightPct),
    riskBudgetPct:finite(x.riskBudgetPct),
    referenceShares100k:finite(x.referenceShares100k),
    referencePositionValue100k:finite(x.referencePositionValue100k),
    referenceMaxLoss100k:finite(x.referenceMaxLoss100k),
    regime:cockpit.market?.regime??null,
    breadthPct:finite(cockpit.market?.breadthPct),
    exposureScale:finite(cockpit.market?.exposureScale),
    warnings:x.warnings||[],
    evidence:x.evidence||[],
    outcome:{status:'PENDING',resolvedAt:null,fillPrice:null,exitPrice:null,netReturnPct:null,maxFavorablePct:null,maxAdversePct:null}
  });
}
const records=[...map.values()].sort((a,b)=>String(a.session).localeCompare(String(b.session))||String(a.ticker).localeCompare(String(b.ticker)));
const payload={
  schemaVersion:'astra-prospective-evidence/v1',
  generatedAt:new Date().toISOString(),
  researchOnly:true,
  automaticExecution:false,
  records,
  counts:{
    total:records.length,
    pending:records.filter(r=>r.outcome?.status==='PENDING').length,
    resolved:records.filter(r=>r.outcome?.status==='RESOLVED').length
  }
};
write(OUT,payload);write(DOC,payload);
console.log(JSON.stringify(payload.counts));
