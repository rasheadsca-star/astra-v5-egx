'use strict';

const REMOTE_BASE =
  process.env.ASTRA_ATOMIC_RUNTIME_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-ASTRA-V4/main/data';

const CACHE_TTL_MS = Number(process.env.ASTRA_ATOMIC_RUNTIME_CACHE_MS || 300000);
const REQUEST_TIMEOUT_MS = Number(process.env.ASTRA_ATOMIC_RUNTIME_TIMEOUT_MS || 20000);

let cache = {
  loadedAt: 0,
  pair: null,
  error: null
};

async function fetchJson(name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const bucket = Math.floor(Date.now() / CACHE_TTL_MS);
    const response = await fetch(`${REMOTE_BASE}/${name}?atomic=${bucket}`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'ASTRA-V4-REMOTE-ATOMIC-RUNTIME/1.0'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}:${name}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function sourceIdentity(doc = {}) {
  return {
    schemaVersion: doc.schemaVersion || null,
    expectedSession: doc?.source?.expectedSession || null,
    sourceSessionDataHash: doc?.source?.sourceSessionDataHash || null,
    atomicHandoff: doc?.source?.atomicHandoff === true,
    generatedAt: doc.generatedAt || null
  };
}

function validatePair(market = {}, history = {}) {
  const m = sourceIdentity(market);
  const h = sourceIdentity(history);
  const reasons = [];

  if (m.schemaVersion !== '5.0.0' || h.schemaVersion !== '5.0.0') {
    reasons.push('ATOMIC_SCHEMA_V5_REQUIRED');
  }
  if (m.atomicHandoff !== true || h.atomicHandoff !== true) {
    reasons.push('ATOMIC_HANDOFF_REQUIRED');
  }
  if (!m.expectedSession || m.expectedSession !== h.expectedSession) {
    reasons.push('ATOMIC_SESSION_MISMATCH');
  }
  if (
    !m.sourceSessionDataHash ||
    m.sourceSessionDataHash !== h.sourceSessionDataHash
  ) {
    reasons.push('ATOMIC_FINGERPRINT_MISMATCH');
  }
  if (!Array.isArray(market.rows) || market.rows.length < 80) {
    reasons.push('ATOMIC_MARKET_COVERAGE_LOW');
  }
  if (
    !history.coverage ||
    Number(history.coverage.coveragePct || 0) < 80 ||
    !history.symbols ||
    typeof history.symbols !== 'object'
  ) {
    reasons.push('ATOMIC_HISTORY_COVERAGE_LOW');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    identity: m
  };
}

async function loadRemoteAtomicPair({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.pair && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.pair;
  }

  try {
    const [market, history] = await Promise.all([
      fetchJson('canonical-market.json'),
      fetchJson('history-index.json')
    ]);

    const validation = validatePair(market, history);
    if (!validation.valid) {
      throw new Error(`REMOTE_ATOMIC_PAIR_INVALID:${validation.reasons.join(',')}`);
    }

    const pair = Object.freeze({
      available: true,
      source: 'REMOTE_ATOMIC_GITHUB',
      expectedSession: validation.identity.expectedSession,
      sourceSessionDataHash: validation.identity.sourceSessionDataHash,
      generatedAt: validation.identity.generatedAt,
      market,
      history
    });

    cache = { loadedAt: now, pair, error: null };
    return pair;
  } catch (error) {
    cache = { ...cache, loadedAt: now, error: error?.message || String(error) };
    return Object.freeze({
      available: false,
      source: 'REMOTE_ATOMIC_GITHUB',
      error: error?.message || 'REMOTE_ATOMIC_PAIR_UNAVAILABLE'
    });
  }
}

function resetRemoteAtomicCache() {
  cache = { loadedAt: 0, pair: null, error: null };
}

module.exports = {
  REMOTE_BASE,
  CACHE_TTL_MS,
  sourceIdentity,
  validatePair,
  loadRemoteAtomicPair,
  resetRemoteAtomicCache
};
