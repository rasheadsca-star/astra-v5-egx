'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL_PATH = path.join(process.cwd(), 'data', 'ucp', 'meta-label-model.json');

const META_POLICY = Object.freeze({
  version: 'ucp-morning-meta-label/v1',
  minProspectiveResolvedTrades: 30,
  minForwardSessions: 30,
  minObservedCalendarDays: 90,
  probabilityUsedForSelection: false,
  executionAllowed: false,
  automaticTrainingPromotionAllowed: false
});

const FEATURE_NAMES = Object.freeze([
  'technicalScore',
  'researchScore',
  'liquidityScore',
  'supportResistanceScore',
  'dataQualityScore',
  'structuralNetRR',
  'stopRiskPct',
  'openingGapPct',
  'relativeVolumeRatio',
  'relativeTurnoverRatio',
  'marketBreadthPct',
  'priceAcceptancePass',
  'openingGapPass',
  'marketBreadthPass',
  'regimeScore',
  'regimeRiskMultiplier'
]);

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bool01(value) {
  return typeof value === 'boolean' ? (value ? 1 : 0) : null;
}

function stopRiskPct(candidate = {}) {
  const entry = finite(candidate.entryHigh ?? candidate.entry);
  const stop = finite(candidate.stopLoss);
  if (!(entry > 0) || !(stop > 0) || stop >= entry) return null;
  return Number(((entry - stop) / entry * 100).toFixed(4));
}

function featureVector(candidate = {}, evidence = {}, regime = {}) {
  return Object.freeze({
    technicalScore: finite(candidate.technicalScore ?? candidate.coreScore ?? candidate.frozenAlpha?.technicalScore),
    researchScore: finite(candidate.researchScore ?? candidate.frozenAlpha?.researchScore),
    liquidityScore: finite(candidate.liquidityScore ?? candidate.frozenAlpha?.liquidityScore),
    supportResistanceScore: finite(candidate.supportResistanceScore ?? candidate.frozenAlpha?.supportResistanceScore),
    dataQualityScore: finite(candidate.dataQualityScore ?? candidate.frozenAlpha?.dataQualityScore),
    structuralNetRR: finite(candidate.structuralNetRR ?? candidate.frozenAlpha?.structuralNetRR),
    stopRiskPct: stopRiskPct(candidate.frozenAlpha || candidate),
    openingGapPct: finite(evidence.openingGapPct),
    relativeVolumeRatio: finite(evidence.relativeVolumeRatio),
    relativeTurnoverRatio: finite(evidence.relativeTurnoverRatio),
    marketBreadthPct: finite(evidence.marketBreadthPct),
    priceAcceptancePass: bool01(evidence.priceAcceptancePass),
    openingGapPass: bool01(evidence.openingGapPass),
    marketBreadthPass: bool01(evidence.marketBreadthPass),
    regimeScore: finite(regime.score),
    regimeRiskMultiplier: finite(regime.riskMultiplier)
  });
}

function loadModel(filePath = DEFAULT_MODEL_PATH) {
  try {
    const model = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Object.freeze({ available: true, ...model });
  } catch (error) {
    return Object.freeze({
      available: false,
      schemaVersion: 'rasheed-egx-meta-label-model/v1',
      status: 'MODEL_UNAVAILABLE',
      executionAllowed: false,
      error: error?.message || 'META_LABEL_MODEL_UNAVAILABLE'
    });
  }
}

function sigmoid(x) {
  if (x >= 0) {
    const z = Math.exp(-x);
    return 1 / (1 + z);
  }
  const z = Math.exp(x);
  return z / (1 + z);
}

function predictProbability(model = {}, features = {}) {
  if (model.status !== 'CALIBRATED') return null;
  const coefficients = model.coefficients || {};
  const normalization = model.normalization || {};
  let logit = finite(model.intercept) ?? 0;

  for (const name of model.features || FEATURE_NAMES) {
    const value = finite(features[name]);
    const coefficient = finite(coefficients[name]);
    const mean = finite(normalization[name]?.mean);
    const std = finite(normalization[name]?.std);
    if (value === null || coefficient === null || mean === null || !(std > 0)) return null;
    logit += coefficient * ((value - mean) / std);
  }

  return Number((sigmoid(logit) * 100).toFixed(2));
}

function expectedValuePct({ probabilityTarget1Pct, entry, stop, target1, roundTripCostPct = 0.60 } = {}) {
  const pPct = finite(probabilityTarget1Pct);
  const e = finite(entry);
  const s = finite(stop);
  const t = finite(target1);
  const cost = finite(roundTripCostPct) ?? 0.60;
  if (pPct === null || !(e > 0) || !(s > 0) || !(t > e) || !(s < e)) return null;

  const p = Math.max(0, Math.min(1, pPct / 100));
  const rewardPct = ((t - e) / e) * 100 - cost;
  const lossPct = ((e - s) / e) * 100 + cost;
  return Number((p * rewardPct - (1 - p) * lossPct).toFixed(4));
}

function calibrationReady(model = {}, forwardSummary = {}) {
  const sample = model.trainingSample || {};
  return (
    model.status === 'CALIBRATED' &&
    Number(sample.resolvedTrades || 0) >= META_POLICY.minProspectiveResolvedTrades &&
    Number(sample.forwardSessions || 0) >= META_POLICY.minForwardSessions &&
    Number(sample.observedCalendarDays || 0) >= META_POLICY.minObservedCalendarDays &&
    Number(forwardSummary.criticalBreaches || 0) === 0
  );
}

function evaluateMetaLabel({
  candidate = {},
  evidence = {},
  regime = {},
  model = {},
  forwardSummary = {}
} = {}) {
  const ticker = candidate.ticker || candidate.symbol || null;
  const features = featureVector(candidate, evidence, regime);
  const ready = calibrationReady(model, forwardSummary);

  if (!ready) {
    return Object.freeze({
      ticker,
      status: model.available === false ? 'MODEL_UNAVAILABLE' : 'NOT_CALIBRATED',
      calibrated: false,
      probabilityTarget1Pct: null,
      expectedValuePct: null,
      usedForSelection: false,
      executionAllowed: false,
      features,
      policy: META_POLICY,
      reason: 'PROSPECTIVE_CALIBRATION_REQUIREMENTS_NOT_MET'
    });
  }

  const probabilityTarget1Pct = predictProbability(model, features);
  const frozen = candidate.frozenAlpha || candidate;
  const ev = expectedValuePct({
    probabilityTarget1Pct,
    entry: finite(frozen.entryHigh ?? frozen.entry),
    stop: finite(frozen.stopLoss),
    target1: finite(frozen.target1),
    roundTripCostPct: finite(frozen.roundTripCostPct) ?? 0.60
  });

  if (probabilityTarget1Pct === null || ev === null) {
    return Object.freeze({
      ticker,
      status: 'CALIBRATED_MODEL_INPUT_INCOMPLETE',
      calibrated: true,
      probabilityTarget1Pct: null,
      expectedValuePct: null,
      usedForSelection: false,
      executionAllowed: false,
      features,
      policy: META_POLICY,
      reason: 'REQUIRED_FEATURE_OR_TRADE_PLAN_MISSING'
    });
  }

  return Object.freeze({
    ticker,
    status: 'CALIBRATED_OBSERVATION_ONLY',
    calibrated: true,
    probabilityTarget1Pct,
    expectedValuePct: ev,
    usedForSelection: false,
    executionAllowed: false,
    features,
    policy: META_POLICY,
    modelVersion: model.modelVersion || null
  });
}

function evaluateMetaLabelBatch({
  candidates = [],
  evidenceByTicker = {},
  regime = {},
  model = loadModel(),
  forwardSummary = {}
} = {}) {
  const results = (candidates || []).map(candidate => evaluateMetaLabel({
    candidate,
    evidence: evidenceByTicker?.[candidate.ticker] || {},
    regime,
    model,
    forwardSummary
  }));

  return Object.freeze({
    engineId: 'UCP_MORNING_META_LABEL',
    modelAvailable: model.available !== false,
    modelStatus: model.status || 'UNKNOWN',
    calibrated: results.length > 0 && results.every(item => item.calibrated === true),
    usedForSelection: false,
    executionAllowed: false,
    results: Object.freeze(results)
  });
}

module.exports = {
  DEFAULT_MODEL_PATH,
  META_POLICY,
  FEATURE_NAMES,
  finite,
  stopRiskPct,
  featureVector,
  loadModel,
  predictProbability,
  expectedValuePct,
  calibrationReady,
  evaluateMetaLabel,
  evaluateMetaLabelBatch
};
