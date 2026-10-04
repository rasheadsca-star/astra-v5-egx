// ASTRA V4 Final Recommendation Schema

export function createRecommendation({ symbol, trade, signal, confidence = 0 }) {
  return {
    symbol,
    signal,
    entry: trade.entry,
    target1: trade.target1,
    target2: trade.target2,
    stopLoss: trade.stopLoss,
    confidence,
    generatedAt: new Date().toISOString()
  };
}
