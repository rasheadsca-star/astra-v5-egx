// ASTRA V4 recommendation card component contract

export function createRecommendationCard(recommendation = {}) {
  return {
    symbol: recommendation.symbol || 'N/A',
    signal: recommendation.signal || 'WATCH',
    entry: recommendation.entry ?? null,
    target1: recommendation.target1 ?? null,
    target2: recommendation.target2 ?? null,
    stopLoss: recommendation.stopLoss ?? null,
    confidence: recommendation.confidence ?? 0,
    risk: recommendation.risk ?? recommendation.riskLevel ?? 'N/A',
    timestamp: recommendation.timestamp ?? null
  };
}
