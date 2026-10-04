// ASTRA V4 scoring integration layer
// Connects analysis scores and risk model outputs into recommendation flow.

function buildSignalContext({ analysis = {}, risk = {} } = {}) {
  const technicalScore = Number(analysis.technicalScore || 0);
  const riskLevel = risk.level || 'UNKNOWN';

  let signal = 'WATCH';
  if (technicalScore >= 80 && riskLevel !== 'HIGH') signal = 'BUY';
  if (technicalScore < 50 || riskLevel === 'HIGH') signal = 'NO_SIGNAL';

  return {
    signal,
    technicalScore,
    riskLevel,
    confidence: Math.max(0, Math.min(100, technicalScore - (riskLevel === 'HIGH' ? 20 : 0)))
  };
}

module.exports = { buildSignalContext };
