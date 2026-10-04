export function buildRiskInput(stock) {
  const volatility = Number(stock.volatility ?? 0);
  const liquidity = Number(stock.liquidity ?? 0);
  const quality = Number(stock.dataQuality ?? 0);

  let riskLevel = 'MEDIUM';

  if (volatility > 0.7 || liquidity < 0.3 || quality < 0.8) {
    riskLevel = 'HIGH';
  }

  if (volatility < 0.25 && liquidity > 0.7 && quality >= 0.9) {
    riskLevel = 'LOW';
  }

  return {
    symbol: stock.symbol,
    riskLevel,
    volatility,
    liquidity,
    dataQuality: quality
  };
}
