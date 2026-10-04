// ASTRA V4 Trade Calculator
// Calculates entry, targets and stop-loss from validated analysis signals.

export function calculateTrade({ price, score = 0, risk = "MEDIUM" }) {
  if (!Number.isFinite(price) || price <= 0) {
    return { status: "INVALID_PRICE" };
  }

  const riskFactor = risk === "LOW" ? 0.03 : risk === "HIGH" ? 0.015 : 0.02;

  return {
    entry: Number(price.toFixed(2)),
    target1: Number((price * (1 + riskFactor)).toFixed(2)),
    target2: Number((price * (1 + riskFactor * 2)).toFixed(2)),
    stopLoss: Number((price * (1 - riskFactor)).toFixed(2)),
    score,
    risk
  };
}
