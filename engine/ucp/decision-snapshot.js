'use strict';

const crypto = require('crypto');
const { REGISTRY } = require('./champion-registry');

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

function stableClone(value) {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = stableClone(value[key]);
      return output;
    }, {});
  }
  return value;
}

function computeDecisionHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(stableClone(payload))).digest('hex');
}

function decisionIdentity(core) {
  // Runtime timestamp and prospective evidence evolve independently of the frozen
  // market decision and therefore must never churn the decision identity hash.
  const { generatedAt, forwardValidation, ...identity } = core;
  return identity;
}

function buildDecisionSnapshot({
  generatedAt = new Date().toISOString(),
  sessionDate = null,
  dataGate,
  alpha = {},
  governance = {},
  morningConfirmation = {},
  forwardValidation = {},
  decision = {},
  provenance = {}
} = {}) {
  if (!dataGate || typeof dataGate.pass !== 'boolean') throw new Error('UCP_DATA_GATE_REQUIRED');

  const core = {
    schema: 'rasheed-egx-ucp-decision-snapshot/v1',
    pipeline: REGISTRY.pipeline,
    generatedAt,
    sessionDate,
    mode: 'SHADOW_PRODUCTION',
    executionAllowed: false,
    dataGate,
    engines: {
      alphaChampionCandidate: REGISTRY.championCandidate,
      governance: REGISTRY.governance,
      morningConfirmation: REGISTRY.morningConfirmation,
      productionReference: REGISTRY.productionReference
    },
    alpha: {
      engineId: alpha.engineId || REGISTRY.championCandidate.id,
      status: alpha.status || 'NOT_WIRED',
      candidates: Array.isArray(alpha.candidates) ? alpha.candidates : [],
      challengers: Array.isArray(alpha.challengers) ? alpha.challengers : []
    },
    governance: {
      engineId: governance.engineId || REGISTRY.governance.id,
      status: governance.status || 'PENDING',
      requiredSession: governance.requiredSession || sessionDate || null,
      referenceSession: governance.referenceSession || null,
      sessionAligned: governance.sessionAligned === true,
      policySafe: governance.policySafe === true,
      executionAllowed: false,
      market: governance.market || null,
      approvedSymbols: Array.isArray(governance.approvedSymbols) ? governance.approvedSymbols : [],
      rejectedSymbols: Array.isArray(governance.rejectedSymbols) ? governance.rejectedSymbols : [],
      blockers: Array.isArray(governance.blockers) ? governance.blockers : []
    },
    morningConfirmation: {
      engineId: morningConfirmation.engineId || REGISTRY.morningConfirmation.id,
      status: morningConfirmation.status || 'PENDING',
      preparedFromSession: morningConfirmation.preparedFromSession || sessionDate || null,
      targetSessionDate: morningConfirmation.targetSessionDate || null,
      executionAllowed: false,
      stateCounts: morningConfirmation.stateCounts || {},
      preparedCandidates: Array.isArray(morningConfirmation.preparedCandidates) ? morningConfirmation.preparedCandidates : [],
      confirmedSymbols: Array.isArray(morningConfirmation.confirmedSymbols) ? morningConfirmation.confirmedSymbols : [],
      waitingSymbols: Array.isArray(morningConfirmation.waitingSymbols) ? morningConfirmation.waitingSymbols : [],
      rejectedSymbols: Array.isArray(morningConfirmation.rejectedSymbols) ? morningConfirmation.rejectedSymbols : [],
      expiredSymbols: Array.isArray(morningConfirmation.expiredSymbols) ? morningConfirmation.expiredSymbols : [],
      evidenceSource: morningConfirmation.evidenceSource || null,
      evidenceComplete: morningConfirmation.evidenceComplete === true
    },
    forwardValidation: {
      status: forwardValidation.status || 'FORWARD_VALIDATION_REQUIRED',
      ledgerAvailable: forwardValidation.ledgerAvailable === true,
      ledgerUpdatedAt: forwardValidation.ledgerUpdatedAt || null,
      promotionEligible: forwardValidation.promotionEligible === true,
      automaticPromotionAllowed: false,
      executionAllowed: false,
      metrics: forwardValidation.metrics || {},
      blockers: Array.isArray(forwardValidation.blockers) ? forwardValidation.blockers : []
    },
    decision: {
      status: decision.status || 'RESEARCH_ONLY',
      finalRecommendations: Array.isArray(decision.finalRecommendations) ? decision.finalRecommendations : [],
      watchlist: Array.isArray(decision.watchlist) ? decision.watchlist : [],
      blockers: Array.isArray(decision.blockers) ? decision.blockers : []
    },
    provenance: {
      sourceCommit: provenance.sourceCommit || null,
      sourceSession: provenance.sourceSession || sessionDate,
      notes: Array.isArray(provenance.notes) ? provenance.notes : []
    }
  };

  const decisionHash = computeDecisionHash(decisionIdentity(core));
  return deepFreeze({ ...core, decisionHash });
}

module.exports = {
  buildDecisionSnapshot,
  computeDecisionHash,
  decisionIdentity,
  deepFreeze
};
