// ASTRA V4 Atomic Canonical Data Refresh
// Mirrors one fully validated PRO session into local market + history stores.
// Runtime reads these local stores so recommendations are tied to one immutable
// deployed session rather than a moving remote feed.

const fs = require('fs');
const path = require('path');
const { getEGXSymbols } = require('../data-engine/registry/egx-symbol-registry');
const { sanitizeMarketRow } = require('../data-engine/sanitize');

const BASE =
  process.env.ASTRA_CANONICAL_SOURCE_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data';

const HISTORY_BASE = `${BASE}/history`;
const TIMEOUT_MS = 15000;
const FETCH_ATTEMPTS = Number(process.env.ASTRA_REFRESH_FETCH_ATTEMPTS || 3);
const FETCH_RETRY_MS = Number(process.env.ASTRA_REFRESH_FETCH_RETRY_MS || 2500);
const CONCURRENCY = 12;
// 150 جلسة (كانت 60): محرك الكم يحتاج >100 جلسة للتدريب وخصائص 60 يوماً. قابلة للضبط بمتغير بيئة.
const HISTORY_SESSIONS = Number(process.env.ASTRA_HISTORY_SESSIONS || 150);
const MIN_HISTORY_COVERAGE = 0.80;
const MIN_MARKET_ROWS = 80;
const SOURCE_REPO =
  process.env.ASTRA_CANONICAL_SOURCE_REPO ||
  'rasheadsca-star/RAS-EGX-PRO2026-NEXT';

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function fetchGithubSourceJson(relativePath) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://api.github.com/repos/${SOURCE_REPO}/contents/data/${relativePath}?ref=main&fresh=${Date.now()}`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'ASTRA-V5-SOURCE-CONTENTS/1.0'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}:${relativePath}`);
    return JSON.parse(await response.text());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}atomic=${Date.now()}`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'ASTRA-V4-ATOMIC-REFRESH/5.0'
      },
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        results[index] = {
          ok: false,
          symbol: items[index],
          error: error?.message || String(error)
        };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker())
  );

  return results;
}

function normalizeSession(row, symbol) {
  const close = Number(row?.close || 0);
  if (!row?.date || !Number.isFinite(close) || close <= 0) return null;

  return {
    ticker: symbol,
    date: String(row.date).slice(0, 10),
    open: Number(row.open || 0),
    high: Number(row.high || close),
    low: Number(row.low || close),
    close,
    volume: Number(row.volume || 0),
    source: row.primarySource || row.source || 'canonical-history'
  };
}

function time(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxTime(...values) {
  return Math.max(...values.map(time), 0);
}

function assertAtomicSource({
  market,
  sessionCalendar,
  fetchStatus,
  priceTruth,
  primary,
  regime,
  v17,
  rc2,
  expectedSession,
  currentSessionRows
}) {
  const regimeSession = regime?.metrics?.sessionDate || regime?.sessionDate || null;
  const sourceSessionDataHash = primary?.basketPlan?.sourceSessionDataHash || primary?.sourceSessionDataHash || null;
  const v17RequiredFreshAt = maxTime(
    primary?.generatedAt,
    regime?.generatedAt,
    priceTruth?.generatedAt
  );
  const rc2RequiredFreshAt = maxTime(
    fetchStatus?.generatedAt,
    priceTruth?.generatedAt,
    primary?.generatedAt
  );

  const failures = [];

  if (!expectedSession) failures.push('EXPECTED_SESSION_MISSING');
  const fetchSessionMatches = fetchStatus?.expectedSession
    ? fetchStatus.expectedSession === expectedSession
    : market?.marketDate === expectedSession;
  const effectiveCurrentSessionRows = Number(
    fetchStatus?.currentSessionRows ??
    fetchStatus?.marketRows ??
    currentSessionRows.length
  );

  if (!fetchSessionMatches) failures.push('FETCH_SESSION_MISMATCH');
  if (fetchStatus?.executionGrade !== true) failures.push('FETCH_NOT_EXECUTION_GRADE');
  if (effectiveCurrentSessionRows < MIN_MARKET_ROWS) {
    failures.push('CURRENT_SESSION_ROWS_BELOW_POLICY');
  }
  if (priceTruth?.expectedSession !== expectedSession || priceTruth?.executionGrade !== true) {
    failures.push('PRICE_TRUTH_NOT_READY');
  }
  if (
    primary?.sessionDate !== expectedSession ||
    primary?.selectedModel?.id !== 'V16_9_EQUAL_WEIGHT_BASKET'
  ) {
    failures.push('V169_PRIMARY_NOT_READY');
  }
  if (regimeSession !== expectedSession) failures.push('REGIME_SESSION_MISMATCH');
  if (
    v17?.sessionDate !== expectedSession ||
    v17?.systemHealth?.sessionAligned !== true
  ) {
    failures.push('V17_SESSION_NOT_ALIGNED');
  }
  if (sourceSessionDataHash ? v17?.sourceSessionDataHash !== sourceSessionDataHash : time(v17?.generatedAt) < v17RequiredFreshAt) {
    failures.push('V17_STALE_WITHIN_SESSION');
  }
  if (rc2?.sessionDate !== expectedSession || rc2?.sessionAligned !== true) {
    failures.push('RC2_SESSION_NOT_ALIGNED');
  }
  if (sourceSessionDataHash ? rc2?.sourceSessionDataHash !== sourceSessionDataHash : time(rc2?.generatedAt) < rc2RequiredFreshAt) {
    failures.push('RC2_STALE_WITHIN_SESSION');
  }

  if (failures.length) {
    throw new Error(`ATOMIC_SOURCE_NOT_READY:${failures.join(',')}`);
  }

  return {
    v17RequiredFreshAt: v17RequiredFreshAt
      ? new Date(v17RequiredFreshAt).toISOString()
      : null,
    rc2RequiredFreshAt: rc2RequiredFreshAt
      ? new Date(rc2RequiredFreshAt).toISOString()
      : null
  };
}

function readJsonIfExists(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function compareSession(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return String(a).localeCompare(String(b));
}

async function main() {
  let [
    market,
    fetchStatus,
    sessionCalendar,
    sourceHealth,
    sessionEvidence,
    priceTruth,
    primary,
    regime,
    v17,
    rc2
  ] = await Promise.all([
    fetchJson(`${BASE}/market.json`),
    fetchJson(`${BASE}/fetch-status.json`),
    fetchJson(`${BASE}/session-calendar.json`),
    fetchJson(`${BASE}/source-health.json`).catch(() => ({})),
    fetchJson(`${BASE}/stable/v16-source-session-evidence.json`).catch(() => ({})),
    fetchJson(`${BASE}/stable/v15-price-truth.json`),
    fetchJson(`${BASE}/stable/v16-v169-primary-decision.json`),
    fetchJson(`${BASE}/stable/v16-market-regime.json`),
    fetchJson(`${BASE}/v17/ucp-current-session.json`),
    fetchJson(`${BASE}/rc2/current-session.json`)
  ]);

  const marketRows = Array.isArray(market?.rows) ? market.rows : [];
  const existingMarketPath = path.join(__dirname, '..', 'data', 'canonical-market.json');
  const existingMarket = readJsonIfExists(existingMarketPath);
  const existingSession = existingMarket?.source?.expectedSession || null;
  const expectedSession =
    sessionCalendar?.latestMarketSession ||
    market?.marketDate ||
    fetchStatus?.expectedSession ||
    priceTruth?.expectedSession ||
    primary?.sessionDate ||
    marketRows
      .map(row => row?.sourceSessionDate || row?.marketSessionDate)
      .filter(Boolean)
      .sort()
      .pop() ||
    null;

  if (compareSession(expectedSession, existingSession) < 0) {
    throw new Error(`SOURCE_SESSION_REGRESSION_BLOCKED:${expectedSession}<${existingSession}`);
  }

  const sourceFingerprint =
    primary?.basketPlan?.sourceSessionDataHash ||
    primary?.sourceSessionDataHash ||
    null;
  const v17NeedsApi =
    expectedSession &&
    (
      v17?.sessionDate !== expectedSession ||
      (sourceFingerprint && v17?.sourceSessionDataHash !== sourceFingerprint)
    );
  const rc2NeedsApi =
    expectedSession &&
    (
      rc2?.sessionDate !== expectedSession ||
      (sourceFingerprint && rc2?.sourceSessionDataHash !== sourceFingerprint)
    );

  if (v17NeedsApi || rc2NeedsApi) {
    const [freshV17, freshRc2] = await Promise.all([
      v17NeedsApi
        ? fetchGithubSourceJson('v17/ucp-current-session.json').catch(() => null)
        : Promise.resolve(null),
      rc2NeedsApi
        ? fetchGithubSourceJson('rc2/current-session.json').catch(() => null)
        : Promise.resolve(null)
    ]);
    if (freshV17) v17 = freshV17;
    if (freshRc2) rc2 = freshRc2;
  }

  const explicitSessionRows = expectedSession
    ? marketRows.filter(
        row =>
          row?.sourceSessionDate === expectedSession ||
          row?.marketSessionDate === expectedSession
      )
    : marketRows;
  const currentSessionRows =
    explicitSessionRows.length > 0 ||
    market?.marketDate !== expectedSession
      ? explicitSessionRows
      : marketRows;

  if (marketRows.length < MIN_MARKET_ROWS) {
    throw new Error(`Canonical market coverage too low: ${marketRows.length} rows`);
  }

  const freshness = assertAtomicSource({
    market,
    sessionCalendar,
    fetchStatus,
    priceTruth,
    primary,
    regime,
    v17,
    rc2,
    expectedSession,
    currentSessionRows
  });

  const symbols = getEGXSymbols();

  const historyResults = await mapLimit(
    symbols,
    CONCURRENCY,
    async symbol => {
      const payload = await fetchJson(`${HISTORY_BASE}/${symbol}.json`);
      const sessions = Array.isArray(payload?.sessions)
        ? payload.sessions
            .map(row => normalizeSession(row, symbol))
            .filter(Boolean)
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-HISTORY_SESSIONS)
        : [];

      return {
        ok: sessions.length > 0,
        symbol,
        sessions,
        lastSession: sessions.at(-1)?.date || null,
        availableSessions: Number(payload?.availableSessions || sessions.length),
        generatedAt: payload?.generatedAt || null,
        primarySource: payload?.primarySource || null,
        eligibleForDecision: payload?.eligibleForDecision !== false,
        instrumentStatus: payload?.instrumentStatus || null,
        historyStatus: payload?.historyStatus || null,
        staleData: payload?.staleData === true,
        updateFailed: payload?.updateFailed === true,
        warnings: Array.isArray(payload?.warnings) ? payload.warnings : []
      };
    }
  );

  const goodHistory = historyResults.filter(item => item?.ok);
  const coverage = goodHistory.length / Math.max(1, symbols.length);

  if (coverage < MIN_HISTORY_COVERAGE) {
    throw new Error(
      `Historical coverage too low: ${goodHistory.length}/${symbols.length} (${(coverage * 100).toFixed(1)}%)`
    );
  }

  const historyCurrentSymbols = goodHistory.filter(
    item => item.lastSession === expectedSession
  ).length;

  const sourceGeneratedAt =
    fetchStatus?.generatedAt ||
    market?.generatedAt ||
    new Date().toISOString();

  const sourceSessionDataHash =
    primary?.basketPlan?.sourceSessionDataHash ||
    primary?.sourceSessionDataHash ||
    null;

  const sourceMeta = {
    repository: 'rasheadsca-star/RAS-EGX-PRO2026-NEXT',
    branch: 'main',
    expectedSession,
    sourceName: market?.source || fetchStatus?.sourceName || null,
    executionGrade: fetchStatus?.executionGrade === true,
    currentSessionRows: Number(
      fetchStatus?.currentSessionRows || currentSessionRows.length
    ),
    sourceSessionVerifiedRows: Number(
      fetchStatus?.sourceSessionVerifiedRows ||
      sessionEvidence?.matchingRows ||
      0
    ),
    coveragePct: Number(
      fetchStatus?.coveragePct ||
      sourceHealth?.coveragePct ||
      0
    ),
    sourceSessionDataHash,
    marketGeneratedAt: market?.generatedAt || null,
    fetchStatusGeneratedAt: fetchStatus?.generatedAt || null,
    priceTruthGeneratedAt: priceTruth?.generatedAt || null,
    primaryDecisionGeneratedAt: primary?.generatedAt || null,
    regimeGeneratedAt: regime?.generatedAt || null,
    v17GeneratedAt: v17?.generatedAt || null,
    rc2GeneratedAt: rc2?.generatedAt || null,
    v17Session: v17?.sessionDate || null,
    rc2Session: rc2?.sessionDate || null,
    v17FreshRequiredAt: freshness.v17RequiredFreshAt,
    rc2FreshRequiredAt: freshness.rc2RequiredFreshAt,
    delayed: true,
    atomicHandoff: true
  };

  const historyIndex = {
    schemaVersion: '5.0.0',
    generatedAt: sourceGeneratedAt,
    source: { ...sourceMeta },
    coverage: {
      registeredSymbols: symbols.length,
      loadedSymbols: goodHistory.length,
      coveragePct: Number((coverage * 100).toFixed(2)),
      retainedSessionsPerSymbol: HISTORY_SESSIONS,
      currentSessionSymbols: historyCurrentSymbols
    },
    symbols: Object.fromEntries(
      goodHistory.map(item => [
        item.symbol,
        {
          lastSession: item.lastSession,
          availableSessions: item.availableSessions,
          generatedAt: item.generatedAt,
          primarySource: item.primarySource,
          eligibleForDecision: item.eligibleForDecision,
          instrumentStatus: item.instrumentStatus,
          historyStatus: item.historyStatus,
          staleData: item.staleData,
          updateFailed: item.updateFailed,
          warnings: item.warnings,
          sessions: item.sessions
        }
      ])
    )
  };

  const canonicalMarket = {
    schemaVersion: '5.0.0',
    generatedAt: sourceGeneratedAt,
    source: { ...sourceMeta },
    rows: marketRows.filter(row => Number(row?.price) > 0).map(sanitizeMarketRow)
  };

  writeJson(
    path.join(__dirname, '..', 'data', 'canonical-market.json'),
    canonicalMarket
  );

  writeJson(
    path.join(__dirname, '..', 'data', 'history-index.json'),
    historyIndex
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        atomicHandoff: true,
        expectedSession,
        sourceSessionDataHash,
        marketRows: canonicalMarket.rows.length,
        currentSessionRows: currentSessionRows.length,
        historySymbols: goodHistory.length,
        historyCurrentSymbols,
        historyCoveragePct: Number((coverage * 100).toFixed(2)),
        v17Session: v17?.sessionDate || null,
        rc2Session: rc2?.sessionDate || null,
        source: canonicalMarket.source,
        continuity: {
          existingSession,
          sourceSession: expectedSession,
          sessionAdvanced: compareSession(expectedSession, existingSession) > 0,
          atomicMarketHistoryWrite: true,
          fetchAttempts: FETCH_ATTEMPTS
        }
      },
      null,
      2
    )
  );
}

main().catch(error => {
  console.error('ASTRA ATOMIC DAILY REFRESH FAILED');
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
