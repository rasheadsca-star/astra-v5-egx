// ASTRA V4 scoring engine
// Combines normalized market signals into a unified score.

function calculateScore({ trend = 0, momentum = 0, volume = 0, risk = 0 }) {
  const technicalScore =
    trend * 0.35 +
    momentum * 0.35 +
    volume * 0.20 -
    risk * 0.10;

  return {
    technicalScore: Math.round(technicalScore * 100) / 100,
    components: {
      trend,
      momentum,
      volume,
      risk
    }
  };
}

module.exports = { calculateScore };
