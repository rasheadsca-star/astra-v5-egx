// ASTRA V4 Signal Generator
// Entry-only signal contract. SELL is intentionally not emitted.
// A bearish setup is WATCH/NO_ENTRY, not a short-entry recommendation.

function generateSignal({
  symbol,
  analysis = {},
  risk = {},
  trade = {},
  execution = {},
  entryOpportunity = false
}) {
  const score = Number(analysis.technicalScore ?? 0);
  const riskLevel = risk.level || analysis.riskLevel || 'UNKNOWN';
  const validTrade = trade?.status === 'READY' && Number(trade?.entry) > 0;

  const blockers = [];

  if (!entryOpportunity) blockers.push('ENTRY_SCORE_BELOW_THRESHOLD');
  if (!execution.liveData) blockers.push('LIVE_DATA_NOT_FRESH');
  if (!execution.dataFresh) blockers.push('STALE_OR_NONLIVE_DATA');
  if (!execution.priceMatched) blockers.push('PRICE_NOT_MATCHED');
  if (!execution.morningGateConfirmed) blockers.push('MORNING_CONFIRMATION_REQUIRED');

  const signal = entryOpportunity && validTrade ? 'BUY' : 'WATCH';

  const executionReady =
    signal === 'BUY' &&
    riskLevel !== 'UNKNOWN' &&
    execution.liveData === true &&
    execution.dataFresh === true &&
    execution.priceMatched === true &&
    execution.morningGateConfirmed === true;

  return {
    symbol,
    signal,
    entryOpportunity: signal === 'BUY',
    entry: signal === 'BUY' ? trade?.entry ?? null : null,
    target1: signal === 'BUY' ? trade?.target1 ?? null : null,
    target2: signal === 'BUY' ? trade?.target2 ?? null : null,
    target3: signal === 'BUY' ? trade?.target3 ?? null : null,
    stopLoss: signal === 'BUY' ? trade?.stopLoss ?? null : null,
    riskPerShare: signal === 'BUY' ? trade?.riskPerShare ?? null : null,
    riskPercent: signal === 'BUY' ? trade?.riskPercent ?? null : null,
    riskReward1: signal === 'BUY' ? trade?.riskReward1 ?? null : null,
    riskReward2: signal === 'BUY' ? trade?.riskReward2 ?? null : null,
    riskReward3: signal === 'BUY' ? trade?.riskReward3 ?? null : null,
    confidence: Math.round(score),
    riskLevel,
    executionReady,
    executionMode: 'PAPER_ONLY',
    executionBlockers: executionReady ? [] : blockers,
    generatedAt: new Date().toISOString()
  };
}

module.exports = { generateSignal };
