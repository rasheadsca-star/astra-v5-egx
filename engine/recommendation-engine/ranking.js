// ASTRA V4 Recommendation Ranking Core

function calculateRank({ technicalScore = 0, riskScore = 0, dataQuality = 0 }) {
  return Number((technicalScore * 0.5 + dataQuality * 0.3 + riskScore * 0.2).toFixed(2));
}

module.exports = { calculateRank };
