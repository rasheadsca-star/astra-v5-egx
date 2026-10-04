// ASTRA V4 Recommendation Runtime
// Opportunity ranking engine.
// Separates execution-ready opportunities from watchlist candidates.

const { generateSignal } = require('./signal-generator');
const { calculateTrade } = require('./trade-calculator-runtime');

const EXECUTION_SCORE_MINIMUM = 70;
const WATCH_SCORE_MINIMUM = 45;

function qualifiesForEntry(analysis = {}) {
  const score = Number(analysis.technicalScore || 0);

  return (
    score >= EXECUTION_SCORE_MINIMUM &&
    analysis.riskLevel !== 'HIGH' &&
    Number(analysis.momentum || 0) >= 55 &&
    Number(analysis.trend || 0) >= 50 &&
    Number(analysis.liquidity || 0) >= 40 &&
    Number(analysis.volatility || 0) >= 35
  );
}

function classifyOpportunity(analysis = {}) {
  const score = Number(analysis.technicalScore || 0);

  if (qualifiesForEntry(analysis)) {
    return 'EXECUTION_READY';
  }

  if (score >= WATCH_SCORE_MINIMUM) {
    return 'WATCH';
  }

  return 'REJECT';
}

function buildItem(item) {
  const technicalScore = Number(item.technicalScore || 0);
  const riskLevel = item.riskLevel || 'MEDIUM';
  const opportunityStatus = classifyOpportunity(item);
  const entryOpportunity = opportunityStatus === 'EXECUTION_READY';

  const tradePlan = entryOpportunity
    ? calculateTrade({
        price: Number(item.price || 0),
        confidence: technicalScore,
        direction: 'BUY',
        atr14: Number(item.atr14 || 0),
        recentLow20: Number(item.recentLow20 || 0)
      })
    : {
        status: 'WATCH_ONLY',
        reason: 'Waiting for execution confirmation'
      };

  const execution = {
    dataFresh: item.dataFreshness?.status === 'FRESH',
    priceMatched: item.priceMatched === true,
    morningGateConfirmed: item.morningGate?.confirmed === true,
    liveData: item.dataFreshness?.status === 'FRESH'
  };

  const signal = generateSignal({
    symbol: item.symbol,
    analysis: item,
    risk: { level: riskLevel },
    trade: tradePlan,
    execution,
    entryOpportunity
  });

  return {
    ...signal,
    opportunityStatus,
    analysis: {
      technicalScore,
      momentum: item.momentum,
      trend: item.trend,
      liquidity: item.liquidity,
      volatility: item.volatility,
      fiveDayChangePct: item.fiveDayChangePct,
      twentyDayChangePct: item.twentyDayChangePct,
      historySessions: item.historySessions,
      latestVolume: item.latestVolume,
      averageVolume20: item.averageVolume20,
      atr14: item.atr14,
      recentLow20: item.recentLow20,
      recentHigh20: item.recentHigh20
    },
    dataFreshness: item.dataFreshness,
    priceMatched: item.priceMatched,
    morningGate: item.morningGate,
    sessionPhase: item.sessionPhase,
    execution
  };
}

function generateRecommendation(analysis) {
  const evaluated = (analysis?.results || [])
    .map(buildItem)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));

  return {
    generatedAt: new Date().toISOString(),
    recommendations: evaluated.filter(
      (item) => item.opportunityStatus === 'EXECUTION_READY'
    ),
    watchlist: evaluated.filter(
      (item) => item.opportunityStatus === 'WATCH'
    ),
    rejected: evaluated.filter(
      (item) => item.opportunityStatus === 'REJECT'
    )
  };
}

module.exports = {
  EXECUTION_SCORE_MINIMUM,
  WATCH_SCORE_MINIMUM,
  qualifiesForEntry,
  classifyOpportunity,
  generateRecommendation
};
