'use strict';

// Versioned shadow accounting only. Never places orders.
function resolveRealistic(entry, candidate, rows, previous, policy) {
  const ref = Number(candidate.entry), stop = Number(candidate.stopLoss), target = Number(candidate.target1);
  const base = { ticker: candidate.ticker, policyVersion: policy.version, executionAllowed: false,
    sourceLastSession: rows.at(-1)?.date || null, entryPrice: Number.isFinite(ref) ? ref : null };
  const start = String(entry.targetSessionDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !(stop > 0 && stop < ref && target > ref))
    return { ...base, outcome: 'UNRESOLVABLE', entered: false, resolutionReason: 'TRADE_PLAN_INCOMPLETE' };
  const future = rows.filter(r => r.date >= start);
  const valid = r => ['open','high','low','close'].every(k => Number.isFinite(r[k]) && r[k] > 0)
    && r.low <= Math.min(r.open,r.close) && r.high >= Math.max(r.open,r.close);
  // Missing bars prevent a claim about whether an entry or exit happened.
  if (future.some(r => !valid(r))) return { ...previous, ...base, outcome:'OPEN', resolutionReason:'WAITING_OHLC', entered:previous.entered === true };
  const index = future.slice(0, policy.entryExpirySessions).findIndex(r => r.open >= ref * .99 && r.open <= ref * 1.01);
  if (index < 0) return { ...base, outcome: future.length >= policy.entryExpirySessions ? 'NOT_ENTERED' : 'OPEN', entered:false,
    netReturnPct: future.length >= policy.entryExpirySessions ? 0 : null };
  const first = future[index], price = first.open;
  const open = { ...base, entryPrice:price, entrySession:first.date, entered:true, outcome:'OPEN' };
  const close = (r, exit, outcome, ambiguity=null, locked=false) => ({ ...open, outcome, exitSession:r.date, exitPrice:exit,
    netReturnPct: Math.round(((exit / price - 1) * 100 - policy.roundTripCostPct) * 1e4) / 1e4,
    sameBarAmbiguity:ambiguity, limitDownDeferred:locked, resolvedAt:new Date().toISOString() });
  let pendingStop = false;
  for (let i=index;i<future.length;i++) {
    const r=future[i], prior=rows.filter(x=>x.date<r.date).at(-1);
    // A whole session locked at -10% has no evidenced sell-side liquidity.
    const locked=prior && r.high <= prior.close * .9 + 1e-8;
    if (pendingStop) { if (!locked) return close(r,r.open,'STOP',null,true); continue; }
    if (r.open >= target) return close(r,r.open,'TARGET1');
    const stopHit=r.low<=stop, targetHit=r.high>=target;
    if (stopHit) {
      if (locked) { pendingStop=true; continue; }
      return close(r,r.open<=stop ? r.open : stop,'STOP',targetHit && !(r.open<=stop) ? 'STOP_FIRST' : null);
    }
    if (targetHit) return close(r,target,'TARGET1');
    if (i-index+1 >= policy.maxHoldSessions) return close(r,r.close,'TIME_EXIT');
  }
  return {...open,limitDownDeferred:pendingStop,resolutionReason:pendingStop?'WAITING_LIMIT_DOWN_EXIT':null};
}
module.exports={resolveRealistic};
