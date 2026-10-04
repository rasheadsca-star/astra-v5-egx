'use strict';

// ASTRA V5 — Quant adapter (research / shadow lane).
// يستهلك حمولة محرك الكم (astra-quant/v1) ويتحقق منها قبل أن تصل لأي واجهة.
// Fail-closed: عدم محاذاة الجلسة أو تقادم البيانات أو حمولة غير صالحة => لا مرشحين، مع بقاء الأسباب ظاهرة.
// التنفيذ الآلي ممنوع دائماً؛ حقل promotion معلوماتي فقط.

const fs = require('fs');
const path = require('path');

const SCHEMA = 'astra-quant/v1';
const BOARD_SCHEMA = 'rasheed-egx-quant-board/v1';
const DEFAULT_PATH = path.join(__dirname, '..', '..', 'data', 'quant', 'signals.json');
const CANONICAL_PATH = path.join(__dirname, '..', '..', 'data', 'canonical-market.json');

function finite(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function expectedSessionFromCanonical(file = CANONICAL_PATH) {
  const doc = readJson(file);
  return doc?.source?.expectedSession || null;
}

function validateCandidate(c = {}) {
  const lo = finite(c.entryLow);
  const hi = finite(c.entryHigh);
  const stop = finite(c.stop);
  const t1 = finite(c.target1);
  const t2 = finite(c.target2);
  const errors = [];
  if (!c.ticker || !/^[A-Z0-9]{2,10}$/.test(String(c.ticker))) errors.push('TICKER_INVALID');
  if (!(lo > 0 && hi >= lo)) errors.push('ENTRY_ZONE_INVALID');
  if (!(stop > 0 && stop < lo)) errors.push('STOP_NOT_BELOW_ENTRY');
  if (!(t1 > hi)) errors.push('TARGET1_NOT_ABOVE_ENTRY');
  if (!(t2 > t1)) errors.push('TARGET2_NOT_ABOVE_TARGET1');
  const lt = c.liquidity || {};
  if (!['منخفضة', 'متوسطة', 'عالية'].includes(lt.tier)) errors.push('LIQUIDITY_TIER_MISSING');
  return errors;
}

function normalizeCandidate(c) {
  return Object.freeze({
    ticker: c.ticker,
    rank: finite(c.rank),
    tier: c.tier || 'C',
    entryLow: finite(c.entryLow),
    entryHigh: finite(c.entryHigh),
    stopLoss: finite(c.stop),
    target1: finite(c.target1),
    target2: finite(c.target2),
    stopRiskPct: finite(c.stopPct),
    target1Pct: finite(c.target1Pct),
    target2Pct: finite(c.target2Pct),
    rr1: finite(c.rr1),
    rr2: finite(c.rr2),
    sizePct: finite(c.sizePct),
    horizonSessions: finite(c.horizonSessions),
    manage: c.manage || null,
    setups: Array.isArray(c.setups) ? [...c.setups] : [],
    liquidityTier: c.liquidity?.tier || null,
    turnoverM: finite(c.liquidity?.turnoverM),
    maxPositionEgp: finite(c.liquidity?.maxPositionEgp),
    notes: Array.isArray(c.notes) ? [...c.notes] : [],
    executionAllowed: false
  });
}

function emptyBoard(status, reasons, payload = null, expectedSession = null) {
  return {
    schemaVersion: BOARD_SCHEMA,
    status,
    reasons,
    executionAllowed: false,
    researchOnly: true,
    sessionDate: payload?.session || null,
    expectedSession,
    sessionAligned: false,
    candidates: [],
    withheldCount: Array.isArray(payload?.candidates) ? payload.candidates.length : 0,
    regime: payload?.regime || null,
    plan: payload?.plan || null,
    evidence: payload?.evidence || null,
    promotion: payload?.promotion || null,
    forward: payload?.forward || null,
    dataStatus: payload?.dataStatus || null,
    generatedAt: payload?.generatedAt || null
  };
}

function buildQuantBoard({ payload, expectedSession = null } = {}) {
  if (!payload || typeof payload !== 'object') return emptyBoard('UNAVAILABLE', ['QUANT_PAYLOAD_MISSING'], null, expectedSession);
  if (payload.schemaVersion !== SCHEMA) return emptyBoard('INVALID', ['QUANT_SCHEMA_MISMATCH'], payload, expectedSession);

  const perm = payload.permissions || {};
  if (perm.executionAllowed !== false || perm.automaticOrders !== false || perm.productionAllocation !== false) {
    return emptyBoard('INVALID', ['QUANT_PERMISSION_BREACH'], payload, expectedSession);
  }

  const reasons = [];
  const expected = expectedSession || payload.expectedSession || null;
  const aligned = Boolean(payload.session && expected && payload.session === expected);
  if (!expected) reasons.push('EXPECTED_SESSION_MISSING');
  else if (!aligned) reasons.push('QUANT_SESSION_NOT_ALIGNED');
  if (payload.expectedSession && expectedSession && payload.expectedSession !== expectedSession) reasons.push('QUANT_EXPECTED_SESSION_DIFFERS_FROM_ASTRA');
  if (payload.stale === true) reasons.push('QUANT_DATA_STALE');

  if (reasons.length) {
    const status = reasons.includes('QUANT_DATA_STALE') ? 'STALE' : 'MISALIGNED';
    const board = emptyBoard(status, reasons, payload, expected);
    board.sessionAligned = aligned;
    return board;
  }

  const candidates = [];
  const rejected = [];
  for (const raw of Array.isArray(payload.candidates) ? payload.candidates : []) {
    const errors = validateCandidate(raw);
    if (errors.length) rejected.push({ ticker: raw?.ticker || null, errors });
    else candidates.push(normalizeCandidate(raw));
  }

  return {
    schemaVersion: BOARD_SCHEMA,
    status: 'READY',
    reasons: [],
    executionAllowed: false,
    researchOnly: true,
    sessionDate: payload.session,
    expectedSession: expected,
    sessionAligned: true,
    regime: payload.regime || null,
    breadthPct: finite(payload.breadthPct),
    exposureScale: finite(payload.exposureScale),
    driftGuard: payload.driftGuard === true,
    candidates,
    rejectedCandidates: rejected,
    withheldCount: 0,
    plan: payload.plan || null,
    liquidity: payload.liquidity || null,
    evidence: payload.evidence || null,
    promotion: payload.promotion || null,
    forward: payload.forward || null,
    dataStatus: payload.dataStatus || null,
    generatedAt: payload.generatedAt || null
  };
}

function loadQuantBoard({ file = DEFAULT_PATH, canonicalFile = CANONICAL_PATH } = {}) {
  return buildQuantBoard({
    payload: readJson(file),
    expectedSession: expectedSessionFromCanonical(canonicalFile)
  });
}

module.exports = {
  SCHEMA,
  BOARD_SCHEMA,
  validateCandidate,
  buildQuantBoard,
  loadQuantBoard,
  expectedSessionFromCanonical
};
