'use strict';

const REGISTRY = Object.freeze({
  pipeline: Object.freeze({
    name: 'Rasheed EGX Unified Champion Pipeline',
    shortName: 'Rasheed EGX UCP',
    version: '1.0.0',
    hostPlatform: 'ASTRA_V4'
  }),

  championCandidate: Object.freeze({
    id: 'TFE_V20_FUSION_RC2',
    role: 'ALPHA_CHAMPION_CANDIDATE',
    mode: 'SHADOW_ONLY',
    executionAllowed: false,
    evidenceStatus: 'RETROSPECTIVE_STRONGEST_PENDING_FORWARD_VALIDATION'
  }),

  governance: Object.freeze({
    id: 'V17_GOVERNANCE_SPINE',
    role: 'DATA_RISK_GOVERNANCE'
  }),

  morningConfirmation: Object.freeze({
    id: 'V2_4_MORNING_CONFIRMATION',
    role: 'TWO_STAGE_EXECUTION_CONFIRMATION'
  }),

  productionReference: Object.freeze({
    id: 'V16_9_EQUAL_WEIGHT_BASKET',
    role: 'REFERENCE_CHALLENGER',
    mode: 'SHADOW_REFERENCE'
  }),

  challengers: Object.freeze([
    'TFE_V20_FUSION_RC2_RR68_CHALLENGER',
    'GANN_FUSION_X',
    'SEPA_X_QVUA',
    'TRIPLE_ENGINE_CONSENSUS_V1',
    'V18_GLOBAL_STRATEGY_ENSEMBLE',
    'V19_NATIVE_CHALLENGER_V6',
    'V20_FULL_MARKET_NATIVE_SELECTION_V1'
  ])
});

module.exports = { REGISTRY };
