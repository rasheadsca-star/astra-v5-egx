'use strict';

const DEFAULT_QUALITY_STATUS_URL =
  process.env.UCP_QUALITY_STATUS_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/fetch-status.json';

const REQUEST_TIMEOUT_MS = Number(process.env.UCP_QUALITY_TIMEOUT_MS || 12000);

function asNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function loadUpstreamQuality({
  fetchImpl = global.fetch,
  url = DEFAULT_QUALITY_STATUS_URL
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return Object.freeze({
      available: false,
      error: 'FETCH_NOT_AVAILABLE'
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Rasheed-EGX-UCP/1.0-Quality'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`QUALITY_HTTP_${response.status}`);
    }

    const payload = await response.json();

    const expectedUniverseSize = asNumber(payload.inputRows, 0);
    const acceptedRows = asNumber(
      payload.currentSessionRows ?? payload.marketRows,
      0
    );
    const verifiedRows = asNumber(payload.sourceSessionVerifiedRows, 0);

    return Object.freeze({
      available: true,
      sourceReady: payload.ok === true && payload.realFetch === true,
      currentSessionReady:
        acceptedRows > 0 && Boolean(payload.expectedSession),
      executionGrade: payload.executionGrade === true,
      expectedSession: payload.expectedSession || null,
      generatedAt: payload.generatedAt || null,
      sourceName: payload.sourceName || null,
      sourceUrl: payload.sourceUrl || null,
      expectedUniverseSize,
      acceptedRows,
      verifiedRows,
      coveragePct: asNumber(payload.coveragePct),
      verifiedCoveragePct: asNumber(
        payload.sourceSessionEvidenceCoveragePct
      ),
      rejectedRows: asNumber(payload.rejectedCurrentSessionRows, 0),
      droppedRows: asNumber(payload.droppedCurrentSessionRows, 0),
      criticalErrors: Object.freeze(
        payload.ok === false || payload.executionGrade === false
          ? ['UPSTREAM_QUALITY_NOT_EXECUTION_GRADE']
          : []
      )
    });
  } catch (error) {
    return Object.freeze({
      available: false,
      sourceReady: false,
      currentSessionReady: false,
      executionGrade: false,
      expectedUniverseSize: 0,
      acceptedRows: 0,
      verifiedRows: 0,
      coveragePct: null,
      verifiedCoveragePct: null,
      criticalErrors: Object.freeze(['UPSTREAM_QUALITY_UNAVAILABLE']),
      error: error?.name === 'AbortError'
        ? 'QUALITY_TIMEOUT'
        : error?.message || 'QUALITY_SOURCE_ERROR'
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  DEFAULT_QUALITY_STATUS_URL,
  loadUpstreamQuality
};
