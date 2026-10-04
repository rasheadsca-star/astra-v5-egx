'use strict';

const assert = require('assert');
const {
  META_POLICY,
  featureVector,
  loadModel,
  predictProbability,
  expectedValuePct,
  calibrationReady,
  evaluateMetaLabel,
  evaluateMetaLabelBatch
} = require('../engine/ucp/morning-meta-label');

const candidate = {
  ticker: 'BINV',
  frozenAlpha: {
    technicalScore: 75.3,
    researchScore: 73.5,
    liquidityScore: 98,
    supportResistanceScore: 69.9,
    dataQualityScore: 78,
    structuralNetRR: 0.685,
    entryLow: 57.52,
    entryHigh: 59.0013,
    stopLoss: 54.7913,
    target1: 62.48,
    roundTripCostPct: 0.6
  }
};

const evidence = {
  openingGapPct: 1.2,
  relativeVolumeRatio: 1.1,
  relativeTurnoverRatio: 1.05,
  marketBreadthPct: 58,
  priceAcceptancePass: true,
  openingGapPass: true,
  marketBreadthPass: true
};

const regime = { score: 8, riskMultiplier: 0.35 };
const features = featureVector(candidate, evidence, regime);
assert.strictEqual(features.researchScore, 73.5);
assert.strictEqual(features.structuralNetRR, 0.685);
assert.strictEqual(features.priceAcceptancePass, 1);
assert.strictEqual(features.regimeRiskMultiplier, 0.35);

const bootstrap = loadModel();
assert.strictEqual(bootstrap.status, 'NOT_CALIBRATED');
assert.strictEqual(calibrationReady(bootstrap, { criticalBreaches: 0 }), false);
assert.strictEqual(predictProbability(bootstrap, features), null);

const result = evaluateMetaLabel({
  candidate,
  evidence,
  regime,
  model: bootstrap,
  forwardSummary: { criticalBreaches: 0 }
});
assert.strictEqual(result.status, 'NOT_CALIBRATED');
assert.strictEqual(result.calibrated, false);
assert.strictEqual(result.probabilityTarget1Pct, null);
assert.strictEqual(result.expectedValuePct, null);
assert.strictEqual(result.usedForSelection, false);
assert.strictEqual(result.executionAllowed, false);

const batch = evaluateMetaLabelBatch({
  candidates: [candidate],
  evidenceByTicker: { BINV: evidence },
  regime,
  model: bootstrap,
  forwardSummary: { criticalBreaches: 0 }
});
assert.strictEqual(batch.results.length, 1);
assert.strictEqual(batch.usedForSelection, false);
assert.strictEqual(batch.executionAllowed, false);

const ev = expectedValuePct({
  probabilityTarget1Pct: 60,
  entry: 59,
  stop: 55,
  target1: 64,
  roundTripCostPct: 0.6
});
assert(Number.isFinite(ev));

const syntheticCalibrated = {
  available: true,
  status: 'CALIBRATED',
  modelVersion: 'synthetic-test-only',
  trainingSample: {
    resolvedTrades: META_POLICY.minProspectiveResolvedTrades,
    forwardSessions: META_POLICY.minForwardSessions,
    observedCalendarDays: META_POLICY.minObservedCalendarDays
  },
  features: ['researchScore'],
  intercept: 0,
  coefficients: { researchScore: 1 },
  normalization: { researchScore: { mean: 70, std: 10 } }
};
assert.strictEqual(calibrationReady(syntheticCalibrated, { criticalBreaches: 0 }), true);
const p = predictProbability(syntheticCalibrated, { researchScore: 75 });
assert(p > 50 && p < 100);

console.log('Rasheed EGX UCP meta-label calibration guard validation passed');
