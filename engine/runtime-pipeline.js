// ASTRA V4 Runtime Pipeline
// Canonical delayed market data + compact validated history -> normalized snapshot -> recommendations.

const { getMarketSnapshot } = require('../data-engine/egx-adapter');
const { canonicalMarketProvider } = require('../data-engine/providers/canonical-market-provider');
const { egxLiveProvider } = require('../data-engine/providers/egx-live-provider');
const { analyze } = require('./analysis-engine/runtime-analyzer');
const { generateRecommendation } = require('./recommendation-engine/runtime-recommender');
const { loadLegacyHistory } = require('../data-engine/history/legacy-history-provider');
const {
  buildMorningRecord,
  morningGate,
  getSessionPhase
} = require('./session/morning-liquidity');

const FRESHNESS_LIMIT_SECONDS = 300;

function normalizeLiveQuote(quote = {}, now = new Date()) {
  const price = Number(quote.price || 0);
  const previousClose = Number(quote.previousClose || 0);
  const explicitChangePercent = Number(quote.changePercent);
  const changePercent = Number.isFinite(explicitChangePercent)
    ? explicitChangePercent
    : previousClose > 0
      ? ((price - previousClose) / previousClose) * 100
      : 0;

  const timestampMs = Date.parse(quote.timestamp);
  const ageSeconds = Number.isFinite(timestampMs)
    ? Math.max(0, (now.getTime() - timestampMs) / 1000)
    : Infinity;

  const freshnessStatus =
    ageSeconds <= FRESHNESS_LIMIT_SECONDS ? 'FRESH' : 'STALE';

  const morning = buildMorningRecord({
    candles: quote.intradayCandles || [],
    now,
    sourceUrl: quote.sourceUrl,
    sourceVerified: quote.sourceVerified,
    sourceLatencySeconds: quote.sourceLatencySeconds,
    confidence: quote.confidence,
    baselineFirst15Volume: quote.baselineFirst15Volume
  });

  return {
    symbol: quote.symbol,
    price,
    changePercent,
    volume: Number(quote.volume || 0),
    high: Number(quote.high || 0),
    low: Number(quote.low || 0),
    source: quote.source || 'LIVE',
    sourceUrl: quote.sourceUrl || null,
    sourceSessionDate: quote.sourceSessionDate || null,
    expectedSession: quote.expectedSession || null,
    sessionVerified: quote.sessionVerified === true,
    snapshotGeneratedAt: quote.snapshotGeneratedAt || null,
    snapshotMode: quote.snapshotMode || null,
    sourceVerified: quote.sourceVerified === true,
    sourceLatencySeconds: Number.isFinite(Number(quote.sourceLatencySeconds))
      ? Number(quote.sourceLatencySeconds)
      : null,
    confidence: Number.isFinite(Number(quote.confidence))
      ? Number(quote.confidence)
      : null,
    delayed: Boolean(quote.delayed),
    timestamp: quote.timestamp || null,
    dataFreshness: {
      status: freshnessStatus,
      ageSeconds: Number.isFinite(ageSeconds)
        ? Number(ageSeconds.toFixed(1))
        : null,
      maxAgeSeconds: FRESHNESS_LIMIT_SECONDS
    },
    priceMatched: freshnessStatus === 'FRESH' && price > 0,
    morningGate: morning.gate,
    morningEvidence: morning,
    sessionPhase: getSessionPhase(now)
  };
}

function getLatestHistory(history = []) {
  const valid = history
    .filter((row) => row && Number(row.close) > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!valid.length) return null;

  const latest = valid[valid.length - 1];
  const previous = valid[valid.length - 2] || latest;
  const previousClose = Number(previous.close || 0);
  const close = Number(latest.close || 0);

  return {
    symbol: latest.ticker || null,
    price: close,
    changePercent: previousClose > 0
      ? ((close - previousClose) / previousClose) * 100
      : 0,
    volume: Number(latest.volume || 0),
    high: Number(latest.high || close),
    low: Number(latest.low || close),
    source: latest.source || 'LEGACY_HISTORY',
    sourceUrl: null,
    sourceVerified: false,
    sourceLatencySeconds: null,
    confidence: null,
    delayed: true,
    timestamp: latest.date
      ? new Date(latest.date + 'T23:59:59Z').toISOString()
      : null,
    dataFreshness: {
      status: 'HISTORY_ONLY',
      ageSeconds: null,
      maxAgeSeconds: FRESHNESS_LIMIT_SECONDS
    },
    priceMatched: false,
    morningGate: morningGate(null),
    morningEvidence: null,
    sessionPhase: 'HISTORICAL'
  };
}

function buildNormalizedSymbols(liveQuotes, histories, now = new Date()) {
  const bySymbol = new Map();

  for (const quote of liveQuotes || []) {
    if (quote?.symbol) {
      bySymbol.set(quote.symbol, normalizeLiveQuote(quote, now));
    }
  }

  for (const [symbol, history] of Object.entries(histories || {})) {
    if (!bySymbol.has(symbol)) {
      const latest = getLatestHistory(history);

      if (latest) {
        latest.symbol = symbol;
        bySymbol.set(symbol, latest);
      }
    }
  }

  return Array.from(bySymbol.values());
}

async function loadLiveSnapshot() {
  try {
    const canonical = await getMarketSnapshot(canonicalMarketProvider);

    if (Array.isArray(canonical?.quotes) && canonical.quotes.length) {
      return canonical;
    }
  } catch (error) {
    console.log(
      'ASTRA CANONICAL MARKET PROVIDER FAILED',
      error?.message || error
    );
  }

  try {
    return await getMarketSnapshot(egxLiveProvider);
  } catch (error) {
    return {
      status: 'ERROR',
      source: 'NO_MARKET_SOURCE',
      quotes: [],
      timestamp: new Date().toISOString(),
      error: error?.message || 'Market providers failed'
    };
  }
}

function latestHistorySession(histories = {}) {
  return Object.values(histories)
    .flatMap((rows) => Array.isArray(rows) && rows.length ? [rows.at(-1)?.date] : [])
    .filter(Boolean)
    .sort()
    .pop() || null;
}

function latestMarketSession(quotes = []) {
  return quotes
    .map((item) => item?.sourceSessionDate || item?.expectedSession || null)
    .filter(Boolean)
    .sort()
    .pop() || null;
}

async function buildRuntimeRecommendations(snapshot = {}) {
  const now = new Date();
  const liveSnapshot = snapshot?.liveSnapshot || snapshot;

  const liveQuotes = Array.isArray(liveSnapshot?.quotes)
    ? liveSnapshot.quotes.filter((quote) => Number(quote?.price) > 0)
    : [];

  const histories =
    snapshot?.histories ||
    await loadLegacyHistory();

  const normalizedSymbols =
    buildNormalizedSymbols(liveQuotes, histories, now);

  if (!normalizedSymbols.length) {
    return {
      generatedAt: now.toISOString(),
      recommendations: [],
      watchlist: [],
      status: 'NO_DATA',
      mode: 'NO_DATA',
      dataSource: 'NONE',
      liveQuoteCount: 0,
      freshQuoteCount: 0,
      historyCount: 0,
      morningConfirmedCount: 0,
      watchlistCount: 0,
      executionReadyCount: 0,
      marketSessionDate: liveSnapshot?.sessionDate || null,
      expectedSession: liveSnapshot?.expectedSession || null,
      marketSessionAligned: liveSnapshot?.sessionAligned === true,
      atomicHandoff: liveSnapshot?.atomicHandoff === true,
      sourceGeneratedAt: liveSnapshot?.sourceGeneratedAt || null,
      sourceSessionDataHash: liveSnapshot?.sourceSessionDataHash || null
    };
  }

  const marketSessionDate = latestMarketSession(liveQuotes);
  const historySessionDate = latestHistorySession(histories);
  const sessionAligned = Boolean(
    marketSessionDate &&
    historySessionDate &&
    marketSessionDate === historySessionDate
  );

  const analysis = analyze({
    symbols: normalizedSymbols,
    histories
  });

  const recommendationBundle =
    generateRecommendation(analysis);

  const recommendationList =
    recommendationBundle.recommendations || [];

  const historyAvailable =
    Object.values(histories).some(
      (rows) => Array.isArray(rows) && rows.length > 0
    );

  const hasLive = liveQuotes.length > 0;
  const freshQuoteCount = normalizedSymbols.filter(
    (item) => item.dataFreshness?.status === 'FRESH'
  ).length;

  return {
    status: 'READY',
    generatedAt: now.toISOString(),

    mode:
      hasLive && historyAvailable
        ? 'MIXED_MODE'
        : hasLive
          ? 'LIVE_MODE'
          : 'HISTORY_MODE',

    dataSource:
      hasLive
        ? historyAvailable
          ? `${liveSnapshot?.source || 'LIVE'}_PLUS_HISTORY`
          : liveSnapshot?.source || 'LIVE'
        : 'HISTORICAL',

    symbolsAnalyzed: normalizedSymbols.length,
    liveQuoteCount: liveQuotes.length,
    freshQuoteCount,

    historyCount:
      Object.values(histories).filter(
        (rows) => Array.isArray(rows) && rows.length > 0
      ).length,

    historySymbols:
      Object.entries(histories)
        .filter(
          ([, rows]) =>
            Array.isArray(rows) && rows.length > 0
        )
        .map(([symbol]) => symbol),

    morningConfirmedCount:
      analysis.results.filter(
        (item) => item.morningGate?.confirmed === true
      ).length,

    watchlistCount:
      recommendationBundle.watchlist?.length || 0,

    executionReadyCount:
      recommendationList.filter(
        (item) => item.executionReady === true
      ).length,

    liveSource:
      liveSnapshot?.source || 'NONE',

    marketSessionDate: liveSnapshot?.sessionDate || null,
    expectedSession: liveSnapshot?.expectedSession || null,
    marketSessionAligned: liveSnapshot?.sessionAligned === true,
    atomicHandoff: liveSnapshot?.atomicHandoff === true,
    sourceGeneratedAt: liveSnapshot?.sourceGeneratedAt || null,
    sourceSessionDataHash: liveSnapshot?.sourceSessionDataHash || null,

    ...recommendationBundle
  };
}

async function runRuntimePipeline() {
  const liveSnapshot = await loadLiveSnapshot();
  const histories = await loadLegacyHistory();

  return buildRuntimeRecommendations({
    liveSnapshot,
    histories
  });
}

module.exports = {
  buildRuntimeRecommendations,
  runRuntimePipeline,
  buildNormalizedSymbols,
  getLatestHistory,
  normalizeLiveQuote,
  latestHistorySession,
  latestMarketSession
};
