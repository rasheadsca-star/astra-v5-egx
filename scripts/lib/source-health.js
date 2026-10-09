'use strict';

function str(v){return String(v??'').trim()}
function lower(v){return str(v).toLowerCase()}
function anyWarning(meta,patterns){
  return (meta?.warnings||[]).some(w=>patterns.some(p=>lower(w).includes(p)));
}
function classifySymbol(meta,expectedSession){
  if(!meta)return {status:'SOURCE_FAILED',reason:'HISTORY_RECORD_MISSING',activeDenominator:true};
  const instrument=lower(meta.instrumentStatus);
  const history=lower(meta.historyStatus);
  const warnings=meta.warnings||[];

  if(instrument==='delisted'||anyWarning(meta,['delist','شطب'])){
    return {status:'DELISTED',reason:'EXPLICIT_DELISTING_EVIDENCE',activeDenominator:false};
  }
  if(instrument==='suspended'||anyWarning(meta,['suspend','موقوف','suspension'])){
    return {status:'SUSPENDED',reason:'EXPLICIT_SUSPENSION_EVIDENCE',activeDenominator:false};
  }
  if(instrument==='inactive'||history.startsWith('inactive')){
    return {status:'DORMANT',reason:'EXPLICIT_INACTIVE_METADATA',activeDenominator:false};
  }
  if(meta.updateFailed===true){
    return {status:'SOURCE_FAILED',reason:'UPSTREAM_HISTORY_UPDATE_FAILED',activeDenominator:true};
  }
  if(meta.lastSession===expectedSession&&meta.staleData!==true){
    return {status:'CURRENT_VERIFIED',reason:'LAST_SESSION_MATCHES_EXPECTED',activeDenominator:true};
  }
  return {
    status:'ACTIVE_STALE',
    reason:meta.staleData===true?'STALE_FLAG':'LAST_SESSION_BEHIND_EXPECTED',
    activeDenominator:true
  };
}

function summarize(historyIndex,canonicalMarket,quantStatus,registry){
  const expected=historyIndex?.source?.expectedSession||canonicalMarket?.source?.expectedSession||quantStatus?.expectedSession||null;
  const symbols=historyIndex?.symbols||{};
  const statuses={};
  const counts={CURRENT_VERIFIED:0,ACTIVE_STALE:0,SOURCE_FAILED:0,DORMANT:0,SUSPENDED:0,DELISTED:0};
  let activeDenominator=0;
  for(const [ticker,meta] of Object.entries(symbols)){
    const x=classifySymbol(meta,expected);
    statuses[ticker]={ticker,lastSession:meta?.lastSession||null,primarySource:meta?.primarySource||null,staleData:meta?.staleData===true,updateFailed:meta?.updateFailed===true,warnings:meta?.warnings||[],...x};
    counts[x.status]=(counts[x.status]||0)+1;
    if(x.activeDenominator)activeDenominator++;
  }

  const current=counts.CURRENT_VERIFIED||0;
  const activeCoveragePct=activeDenominator?+(current/activeDenominator*100).toFixed(2):0;
  const registered=Object.keys(symbols).length;
  const explicitInactive=(counts.DORMANT||0)+(counts.SUSPENDED||0)+(counts.DELISTED||0);
  const enabledIndependent=(registry?.sources||[]).filter(x=>x.enabled===true&&x.independentVerifier===true);
  const quantStale=new Set(quantStatus?.staleSymbols||[]);
  const canonicalCurrentButQuantStale=Object.values(statuses).filter(x=>x.status==='CURRENT_VERIFIED'&&quantStale.has(x.ticker)).map(x=>x.ticker).sort();
  const sourceFailed=Object.values(statuses).filter(x=>x.status==='SOURCE_FAILED').map(x=>x.ticker).sort();
  const activeStale=Object.values(statuses).filter(x=>x.status==='ACTIVE_STALE').map(x=>x.ticker).sort();

  return {
    schemaVersion:'astra-source-health/v1',
    expectedSession:expected,
    generatedAt:new Date().toISOString(),
    researchOnly:true,
    automaticExecution:false,
    coverage:{
      registeredSymbols:registered,
      explicitInactiveSymbols:explicitInactive,
      activeDenominator,
      currentVerifiedSymbols:current,
      activeCoveragePct,
      staleActiveSymbols:activeStale.length,
      sourceFailedSymbols:sourceFailed.length,
      rule:'Only explicit DORMANT/SUSPENDED/DELISTED evidence removes a symbol from the denominator. ACTIVE_STALE and SOURCE_FAILED remain in it.'
    },
    independentVerification:{
      enabledSources:enabledIndependent.map(x=>x.id),
      quorumMet:enabledIndependent.length>0,
      status:enabledIndependent.length>0?'INDEPENDENT_VERIFIER_ENABLED':'SINGLE_SOURCE_NO_INDEPENDENT_QUORUM',
      claimAllowed:enabledIndependent.length>0
    },
    crossStoreConsistency:{
      quantCoveragePct:Number(quantStatus?.coveragePct??0),
      quantStaleCount:(quantStatus?.staleSymbols||[]).length,
      canonicalCurrentButQuantStale
    },
    counts,
    lists:{activeStale,sourceFailed},
    symbols:statuses
  };
}
module.exports={classifySymbol,summarize};
