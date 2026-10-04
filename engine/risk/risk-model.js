// ASTRA V4 risk model

function calculateRisk({ volatility = 0, liquidity = 0 }) {
  const risk = (volatility * 0.6) + ((100 - liquidity) * 0.4);

  return {
    riskScore: Math.round(risk * 100) / 100,
    level: risk > 60 ? 'HIGH' : risk > 30 ? 'MEDIUM' : 'LOW'
  };
}

module.exports = { calculateRisk };
