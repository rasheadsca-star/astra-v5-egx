'use strict';

const DEFAULT_INTRADAY_URL = process.env.UCP_INTRADAY_HISTORY_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/intraday/history.json';
const FULL_EVIDENCE_URL = process.env.UCP_MORNING_EVIDENCE_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-ASTRA-V4/main/data/ucp/morning-evidence.json';
const TIMEOUT_MS = Number(process.env.UCP_MORNING_EVIDENCE_TIMEOUT_MS || 12000);

async function fetchJson(url, fetchImpl = global.fetch) {
  if (!url) throw new Error('MORNING_EVIDENCE_URL_NOT_CONFIGURED');
  if (typeof fetchImpl !== 'function') throw new Error('FETCH_NOT_AVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}ucp=${Date.now()}`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Rasheed-EGX-UCP/1.1-V2.4-Morning'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`MORNING_EVIDENCE_HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function parseCairoTime(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})/);
  if (!match) return null;
  return {
    sessionDate: match[1],
    minuteOfDay: Number(match[2]) * 60 + Number(match[3])
  };
}

function normalizeFullEvidence(payload = {}, candidates = []) {
  const byTicker = payload.evidenceByTicker || payload.candidates || {};
  const output = {};
  for (const candidate of candidates || []) {
    const ticker = String(candidate.ticker || candidate.symbol || '').toUpperCase();
    if (!ticker) continue;
    const item = Array.isArray(byTicker)
      ? byTicker.find((row) => String(row?.ticker || row?.symbol || '').toUpperCase() === ticker)
      : byTicker[ticker];
    if (item) output[ticker] = Object.freeze({ ...item, candidatePresent: item.candidatePresent !== false });
  }
  return Object.freeze({
    available: Boolean(payload.sessionDate || payload.generatedAt),
    completeSource: payload.completeSource === true,
    source: payload.source || 'UCP_CURRENT_MARKET_MORNING_COLLECTOR',
    sessionDate: payload.sessionDate || null,
    generatedAt: payload.generatedAt || null,
    latestSourceMinute: Number.isFinite(Number(payload.latestSourceMinute)) ? Number(payload.latestSourceMinute) : null,
    marketCoveragePct: Number.isFinite(Number(payload.marketCoveragePct)) ? Number(payload.marketCoveragePct) : null,
    evidenceByTicker: Object.freeze(output),
    policy: Object.freeze({ ...(payload.policy || {}) }),
    resilience: Object.freeze({ ...(payload.resilience || {}) }),
    collectorMinute: Number.isFinite(Number(payload.collectorMinute)) ? Number(payload.collectorMinute) : null,
    sourceTimingModes: Object.freeze(Array.isArray(payload.sourceTimingModes) ? [...payload.sourceTimingModes] : []),
    reason: payload.completeSource === true ? null : 'REAL_MORNING_EVIDENCE_INCOMPLETE'
  });
}

function legacyEvidenceFromHistory(payload = {}, {
  targetSessionDate = null,
  candidates = [],
  expectedUniverseSize = null
} = {}) {
  const snapshots = Array.isArray(payload.snapshots) ? payload.snapshots : [];
  const eligible = snapshots
    .map((snapshot) => ({ snapshot, clock: parseCairoTime(snapshot.cairoTime) }))
    .filter((item) => item.clock && item.clock.sessionDate === targetSessionDate)
    .filter((item) => item.clock.minuteOfDay >= 620 && item.clock.minuteOfDay <= 645)
    .sort((a, b) => b.clock.minuteOfDay - a.clock.minuteOfDay);

  if (!eligible.length) {
    return Object.freeze({
      available: false,
      completeSource: false,
      source: 'LEGACY_INTRADAY_HISTORY',
      sessionDate: targetSessionDate,
      generatedAt: payload.updatedAt || null,
      reason: 'NO_ELIGIBLE_10_20_TO_10_45_SNAPSHOT',
      evidenceByTicker: Object.freeze({})
    });
  }

  const selected = eligible[0];
  const rows = Array.isArray(selected.snapshot.rows) ? selected.snapshot.rows : [];
  const marketCoveragePct = Number.isFinite(Number(expectedUniverseSize)) && Number(expectedUniverseSize) > 0
    ? Number(((rows.length / Number(expectedUniverseSize)) * 100).toFixed(2))
    : null;
  const rowMap = new Map(rows.map((row) => [String(row.ticker || row.symbol || '').toUpperCase(), row]));
  const evidenceByTicker = {};

  for (const candidate of candidates || []) {
    const ticker = String(candidate.ticker || candidate.symbol || '').toUpperCase();
    if (!ticker) continue;
    const row = rowMap.get(ticker);
    evidenceByTicker[ticker] = Object.freeze({
      sourceSessionDate: selected.clock.sessionDate,
      latestSourceMinute: selected.clock.minuteOfDay,
      marketCoveragePct,
      candidatePresent: Boolean(row),
      volumeBaselineAvailable: false,
      currentPrice: row && Number.isFinite(Number(row.price)) ? Number(row.price) : null,
      turnover: row && Number.isFinite(Number(row.turnover)) ? Number(row.turnover) : null,
      changePct: row && Number.isFinite(Number(row.changePct)) ? Number(row.changePct) : null,
      sourceTimestamp: selected.snapshot.generatedAt || null,
      source: 'LEGACY_INTRADAY_HISTORY',
      limitations: Object.freeze([
        'NO_FIRST_20M_VOLUME_BASELINE',
        'NO_OPENING_GAP_EVIDENCE',
        'NO_PRICE_ACCEPTANCE_EVIDENCE',
        'NO_BREADTH_CONFIRMATION'
      ])
    });
  }

  return Object.freeze({
    available: true,
    completeSource: false,
    source: 'LEGACY_INTRADAY_HISTORY',
    sessionDate: selected.clock.sessionDate,
    generatedAt: selected.snapshot.generatedAt || payload.updatedAt || null,
    latestSourceMinute: selected.clock.minuteOfDay,
    marketCoveragePct,
    evidenceByTicker: Object.freeze(evidenceByTicker)
  });
}

async function loadMorningEvidence({
  targetSessionDate = null,
  candidates = [],
  expectedUniverseSize = null,
  fetchImpl = global.fetch,
  fullEvidenceUrl = FULL_EVIDENCE_URL,
  intradayUrl = DEFAULT_INTRADAY_URL
} = {}) {
  if (fullEvidenceUrl) {
    try {
      const payload = await fetchJson(fullEvidenceUrl, fetchImpl);
      if (!targetSessionDate || payload.sessionDate === targetSessionDate) {
        return normalizeFullEvidence(payload, candidates);
      }
    } catch (_) {
      // Network failure only: fail closed to the observation-only legacy source.
    }
  }

  try {
    const legacy = await fetchJson(intradayUrl, fetchImpl);
    return legacyEvidenceFromHistory(legacy, { targetSessionDate, candidates, expectedUniverseSize });
  } catch (error) {
    return Object.freeze({
      available: false,
      completeSource: false,
      source: 'NONE',
      sessionDate: targetSessionDate,
      reason: error?.name === 'AbortError' ? 'MORNING_EVIDENCE_TIMEOUT' : error?.message || 'MORNING_EVIDENCE_UNAVAILABLE',
      evidenceByTicker: Object.freeze({})
    });
  }
}

module.exports = {
  DEFAULT_INTRADAY_URL,
  FULL_EVIDENCE_URL,
  parseCairoTime,
  normalizeFullEvidence,
  legacyEvidenceFromHistory,
  loadMorningEvidence
};
