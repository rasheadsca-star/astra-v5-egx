// ASTRA V4 Runtime Trade Calculator
// Entry-only long trade plan with a volatility/support stop and staggered profit targets.
// ASTRA does not emit short-entry plans.

const MIN_STOP_PCT = 0.01;
const MAX_STOP_PCT = 0.06;
const ATR_MULTIPLIER = 1.5;
const TARGET_R = Object.freeze([1.5, 2.5, 4.0]);

function roundPrice(value) {
  return Number(Number(value).toFixed(2));
}

function calculateTrade({
  price,
  confidence = 0,
  direction = 'BUY',
  atr14 = 0,
  recentLow20 = 0
}) {
  const entry = Number(price);

  if (!Number.isFinite(entry) || entry <= 0) {
    return {
      status: 'INVALID',
      reason: 'Invalid price input'
    };
  }

  if (direction !== 'BUY') {
    return {
      status: 'INVALID_DIRECTION',
      reason: 'ASTRA entry engine is long-only'
    };
  }

  const atr = Number(atr14);
  const recentLow = Number(recentLow20);

  const volatilityRiskDistance =
    Number.isFinite(atr) && atr > 0
      ? atr * ATR_MULTIPLIER
      : entry * MIN_STOP_PCT;

  const volatilityStop = entry - volatilityRiskDistance;

  const minimumRisk = entry * MIN_STOP_PCT;
  const maximumRisk = entry * MAX_STOP_PCT;

  const supportStop =
    Number.isFinite(recentLow) && recentLow > 0 && recentLow < entry
      ? recentLow * 0.995
      : null;

  let stopLoss = volatilityStop;

  // Use recent support only when it does not push the trade beyond the
  // maximum allowed risk. Otherwise keep the volatility-based stop.
  if (
    Number.isFinite(supportStop) &&
    entry - supportStop >= minimumRisk &&
    entry - supportStop <= maximumRisk
  ) {
    stopLoss = supportStop;
  }

  let riskPerShare = entry - stopLoss;

  if (riskPerShare < minimumRisk) {
    stopLoss = entry - minimumRisk;
    riskPerShare = minimumRisk;
  }

  if (riskPerShare > maximumRisk) {
    return {
      status: 'INVALID_RISK',
      reason: 'Stop distance exceeds maximum allowed risk',
      direction: 'BUY',
      entry: roundPrice(entry),
      stopLoss: roundPrice(entry - maximumRisk),
      riskPerShare: roundPrice(maximumRisk)
    };
  }

  const riskPercent = riskPerShare / entry;

  const target1 = entry + riskPerShare * TARGET_R[0];
  const target2 = entry + riskPerShare * TARGET_R[1];
  const target3 = entry + riskPerShare * TARGET_R[2];

  if (!(stopLoss < entry && entry < target1 && target1 < target2 && target2 < target3)) {
    return {
      status: 'INVALID_LEVELS',
      reason: 'Trade levels failed directional validation'
    };
  }

  return {
    status: 'READY',
    direction: 'BUY',
    entry: roundPrice(entry),
    stopLoss: roundPrice(stopLoss),
    target1: roundPrice(target1),
    target2: roundPrice(target2),
    target3: roundPrice(target3),
    riskPerShare: roundPrice(riskPerShare),
    riskPercent: Number((riskPercent * 100).toFixed(2)),
    riskReward1: TARGET_R[0],
    riskReward2: TARGET_R[1],
    riskReward3: TARGET_R[2],
    confidence: Number(confidence)
  };
}

module.exports = {
  MIN_STOP_PCT,
  MAX_STOP_PCT,
  ATR_MULTIPLIER,
  TARGET_R,
  calculateTrade
};
