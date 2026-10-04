'use strict';

const DEFAULT_V17_URL = process.env.UCP_V17_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/v17/ucp-current-session.json';
const DEFAULT_CANONICAL_V17_URL = process.env.UCP_CANONICAL_V17_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/v17/current.json';
const DEFAULT_CONSENSUS_URL = process.env.UCP_V17_CONSENSUS_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/stable/v16-main-app-consensus.json';
const TIMEOUT_MS = Number(process.env.UCP_V17_TIMEOUT_MS || 12000);
const CURRENT_STATUSES = new Set(['READY_FOR_NEXT_SESSION_REVIEW', 'RESEARCH_READY_EXECUTION_BLOCKED']);

async function fetchJson(url, fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_NOT_AVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}ucp=${Date.now()}`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Rasheed-EGX-UCP/1.1-V17-Governance'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`V17_HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOptional(url, fetchImpl = global.fetch) {
  try { return await fetchJson(url, fetchImpl); }
  catch (_) { return {}; }
}

function uniqueSymbols(items = []) {
  return [...new Set(items.map((item) => item?.ticker || item?.symbol).filter(Boolean))];
}

function evaluateV17Governance({ v17 = {}, consensus = {}, requiredSession = null, candidates = [], sourceType = 'UCP_CURRENT_SESSION' } = {}) {
  const referenceSession = v17.sessionDate || null;
  const sessionAligned = Boolean(requiredSession && referenceSession === requiredSession);
  const sourceStatus = v17.status || null;
  const sourceCurrent = CURRENT_STATUSES.has(sourceStatus);

  const automaticOrders = v17?.portfolioPolicy?.automaticOrders ?? v17?.permissions?.automaticOrders;
  const promotionAllowed = v17?.championChallenger?.promotionAllowed ?? v17?.permissions?.automaticChampionPromotion;
  const sourceExecutionAllowed = v17?.permissions?.executionAllowed ?? v17?.engine?.executionAllowed;
  const policySafe = automaticOrders !== true && promotionAllowed !== true && sourceExecutionAllowed !== true;
  const symbols = uniqueSymbols(candidates);

  const blockers = [];
  if (!requiredSession) blockers.push('V17_REQUIRED_SESSION_UNKNOWN');
  if (!referenceSession) blockers.push('V17_REFERENCE_SESSION_UNKNOWN');
  if (!sessionAligned) blockers.push('V17_SESSION_MISMATCH');
  if (!sourceCurrent) blockers.push('V17_SOURCE_STATUS_NOT_CURRENT');
  if (!policySafe) blockers.push('V17_POLICY_UNSAFE');

  const governanceReady = sessionAligned && sourceCurrent && policySafe;
  const approvedSymbols = governanceReady ? symbols : [];
  const rejectedSymbols = governanceReady ? [] : symbols.map((symbol) => ({
    symbol,
    reason: !sessionAligned
      ? 'V17_SESSION_MISMATCH'
      : !sourceCurrent
        ? 'V17_SOURCE_STATUS_NOT_CURRENT'
        : 'V17_POLICY_UNSAFE'
  }));

  return Object.freeze({
    available: true,
    id: 'V17_GOVERNANCE_SPINE',
    status: governanceReady ? 'GOVERNANCE_READY' : 'GOVERNANCE_BLOCKED',
    requiredSession,
    referenceSession,
    sessionAligned,
    sourceCurrent,
    policySafe,
    executionAllowed: false,
    automaticOrdersAllowed: false,
    automaticChampionPromotionAllowed: false,
    sourceStatus,
    sourceType,
    releaseStage: v17?.readiness?.releaseStage || null,
    professionalEvidenceReady: v17?.readiness?.professionalEvidenceReady === true,
    zeroRecommendationStateValid: v17?.systemHealth?.zeroRecommendationStateValid === true,
    market: sessionAligned ? Object.freeze({
      regime: v17?.market?.regime || null,
      score: Number.isFinite(Number(v17?.market?.score)) ? Number(v17.market.score) : null,
      riskMultiplier: Number.isFinite(Number(v17?.market?.riskMultiplier)) ? Number(v17.market.riskMultiplier) : null,
      maxTradeRiskPct: Number.isFinite(Number(v17?.market?.maxTradeRiskPct)) ? Number(v17.market.maxTradeRiskPct) : null
    }) : null,
    approvedSymbols: Object.freeze(approvedSymbols),
    rejectedSymbols: Object.freeze(rejectedSymbols.map(Object.freeze)),
    blockers: Object.freeze(blockers),
    provenance: Object.freeze({
      v17SchemaVersion: v17.schemaVersion || null,
      v17GeneratedAt: v17.generatedAt || null,
      sourceType,
      consensusGeneratedAt: consensus.generatedAt || null,
      consensusMainSession: consensus?.sourceHealth?.mainSession || consensus.sessionDate || null,
      consensusV17Session: consensus?.sourceHealth?.v17Session || null,
      consensusV17SessionAligned: consensus?.sourceHealth?.v17SessionAligned === true,
      consensusUsedAsBlockingGate: false
    })
  });
}

async function loadV17Governance({
  requiredSession = null,
  candidates = [],
  fetchImpl = global.fetch,
  v17Url = DEFAULT_V17_URL,
  canonicalV17Url = DEFAULT_CANONICAL_V17_URL,
  consensusUrl = DEFAULT_CONSENSUS_URL
} = {}) {
  try {
    let v17;
    let sourceType = 'UCP_CURRENT_SESSION';
    try {
      v17 = await fetchJson(v17Url, fetchImpl);
    } catch (_) {
      v17 = await fetchJson(canonicalV17Url, fetchImpl);
      sourceType = 'CANONICAL_FALLBACK';
    }
    const consensus = await fetchOptional(consensusUrl, fetchImpl);
    return evaluateV17Governance({ v17, consensus, requiredSession, candidates, sourceType });
  } catch (error) {
    return Object.freeze({
      available: false,
      id: 'V17_GOVERNANCE_SPINE',
      status: 'GOVERNANCE_UNAVAILABLE',
      requiredSession,
      referenceSession: null,
      sessionAligned: false,
      sourceCurrent: false,
      policySafe: false,
      executionAllowed: false,
      automaticOrdersAllowed: false,
      automaticChampionPromotionAllowed: false,
      approvedSymbols: Object.freeze([]),
      rejectedSymbols: Object.freeze(uniqueSymbols(candidates).map((symbol) => Object.freeze({
        symbol,
        reason: 'V17_GOVERNANCE_UNAVAILABLE'
      }))),
      blockers: Object.freeze(['V17_GOVERNANCE_UNAVAILABLE']),
      error: error?.name === 'AbortError' ? 'V17_TIMEOUT' : error?.message || 'V17_LOAD_ERROR'
    });
  }
}

module.exports = {
  DEFAULT_V17_URL,
  DEFAULT_CANONICAL_V17_URL,
  DEFAULT_CONSENSUS_URL,
  CURRENT_STATUSES,
  evaluateV17Governance,
  loadV17Governance
};
