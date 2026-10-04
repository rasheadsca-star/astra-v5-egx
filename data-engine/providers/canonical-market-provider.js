// ASTRA V4 Atomic Canonical Market Provider
// Runtime prefers the deployed local snapshot created by the atomic data-sync
// workflow. Remote PRO data is fallback-only, preventing a moving market feed
// from drifting away from the deployed history index.

const fs = require('fs');
const path = require('path');
const { loadRemoteAtomicPair } = require('../atomic-remote-store');

const SOURCE_BASE =
  process.env.ASTRA_CANONICAL_SOURCE_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data';

const LOCAL_MARKET_PATH =
  path.join(__dirname, '..', '..', 'data', 'canonical-market.json');

const REQUEST_TIMEOUT_MS = 12000;

async function fetchJson(relativePath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${SOURCE_BASE}/${relativePath}?fallback=${Date.now()}`,
      {
        headers: {
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
          'User-Agent': 'ASTRA-V4-REMOTE-FALLBACK/5.0'
        },
        signal: controller.signal
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status} for ${relativePath}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function loadLocalMarket() {
  try {
    if (!fs.existsSync(LOCAL_MARKET_PATH)) return null;
    const payload = JSON.parse(fs.readFileSync(LOCAL_MARKET_PATH, 'utf8'));
    if (!Array.isArray(payload?.rows) || !payload?.source?.expectedSession) return null;
    return payload;
  } catch (error) {
    console.log('ASTRA LOCAL CANONICAL MARKET ERROR', error?.message || error);
    return null;
  }
}

function ageSeconds(timestamp) {
  const ms = Date.parse(timestamp || '');
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, (Date.now() - ms) / 1000);
}

function latestSession(rows) {
  return rows
    .map(row => row?.sourceSessionDate || row?.marketSessionDate || null)
    .filter(Boolean)
    .sort()
    .pop() || null;
}

function sourceModeToSnapshotMode(sourceMode) {
  if (sourceMode === 'ASTRA_REMOTE_ATOMIC_GITHUB') return 'REMOTE_ATOMIC_SNAPSHOT';
  if (sourceMode === 'ASTRA_ATOMIC_LOCAL') return 'LOCAL_ATOMIC_SNAPSHOT';
  return 'REMOTE_EMERGENCY_FALLBACK';
}

function normalizeRow(row, expectedSession, metadata = {}) {
  const symbol = String(row?.symbol || row?.ticker || '').trim().toUpperCase();
  const price = Number(row?.price ?? row?.last ?? 0);
  if (!symbol || !Number.isFinite(price) || price <= 0) return null;

  const sessionDate = row?.sourceSessionDate || row?.marketSessionDate || null;
  const updatedAt = row?.sourceSessionCheckedAt || row?.updatedAt || null;
  const sourceLatencySeconds = ageSeconds(updatedAt);
  const sessionVerified = Boolean(expectedSession) && sessionDate === expectedSession;

  return {
    symbol,
    price,
    change: Number(row?.change || 0),
    changePercent: Number(row?.changePct ?? row?.changePercent ?? 0),
    previousClose: Number(row?.previousClose || 0),
    volume: Number(row?.volume || 0),
    high: Number(row?.high || price),
    low: Number(row?.low || price),
    timestamp: updatedAt,
    source: metadata.sourceMode || 'ASTRA_ATOMIC_LOCAL',
    sourceUrl: row?.sourceUrl || null,
    sourceVerified: sessionVerified && metadata.executionGrade === true,
    sourceLatencySeconds,
    confidence: sessionVerified ? 90 : 50,
    delayed: true,
    intradayCandles: [],
    sourceSessionDate: sessionDate,
    expectedSession,
    sessionVerified,
    atomicHandoff: metadata.atomicHandoff === true,
    sourceGeneratedAt: metadata.generatedAt || null,
    sourceSessionDataHash: metadata.sourceSessionDataHash || null,
    snapshotGeneratedAt: metadata.generatedAt || null,
    snapshotMode: sourceModeToSnapshotMode(metadata.sourceMode)
  };
}

function quotesFromPayload(payload, sourceMode) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const source = payload?.source || {};
  const expectedSession = source?.expectedSession || latestSession(rows);

  const metadata = {
    sourceMode,
    executionGrade: source?.executionGrade === true,
    atomicHandoff: source?.atomicHandoff === true,
    generatedAt: payload?.generatedAt || source?.fetchStatusGeneratedAt || null,
    sourceSessionDataHash: source?.sourceSessionDataHash || null
  };

  return rows
    .map(row => normalizeRow(row, expectedSession, metadata))
    .filter(Boolean)
    .filter(quote => !expectedSession || quote.sourceSessionDate === expectedSession);
}

const canonicalMarketProvider = {
  name: 'ASTRA_ATOMIC_CANONICAL',

  async fetchQuotes() {
    const remoteAtomic = await loadRemoteAtomicPair();
    if (remoteAtomic.available === true) {
      return quotesFromPayload(remoteAtomic.market, 'ASTRA_REMOTE_ATOMIC_GITHUB');
    }

    const local = loadLocalMarket();
    if (local) return quotesFromPayload(local, 'ASTRA_ATOMIC_LOCAL');

    // Emergency availability fallback only. It is visibly marked non-atomic
    // and remains non-executable through the existing freshness gates.
    const [market, status] = await Promise.all([
      fetchJson('market.json'),
      fetchJson('fetch-status.json').catch(() => ({}))
    ]);

    const payload = {
      generatedAt: status?.generatedAt || market?.generatedAt || null,
      source: {
        expectedSession: status?.expectedSession || latestSession(market?.rows || []),
        executionGrade: status?.executionGrade === true,
        atomicHandoff: false,
        sourceSessionDataHash: null
      },
      rows: Array.isArray(market?.rows) ? market.rows : []
    };

    return quotesFromPayload(payload, 'ASTRA_REMOTE_FALLBACK');
  },

  async getQuotes() {
    return this.fetchQuotes();
  }
};

module.exports = {
  canonicalMarketProvider,
  loadLocalMarket,
  normalizeRow,
  quotesFromPayload,
  sourceModeToSnapshotMode
};
