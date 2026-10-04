export function calculateTechnicalScore(snapshot) {
  const rows = Array.isArray(snapshot?.symbols) ? snapshot.symbols : [];

  return rows.map((item) => {
    const momentum = Number(item.momentum ?? 0);
    const trend = Number(item.trend ?? 0);
    const liquidity = Number(item.liquidity ?? 0);

    const score = Math.round((momentum * 0.4 + trend * 0.4 + liquidity * 0.2) * 100) / 100;

    return {
      symbol: item.symbol,
      technicalScore: score,
      factors: {
        momentum,
        trend,
        liquidity
      }
    };
  });
}
