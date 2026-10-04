// ASTRA V4 EGX Data Adapter
// Normalizes provider output while preserving freshness and morning-evidence metadata.

function normalizeQuote(quote = {}) {
  const price = Number(quote.price || 0);
  const previousClose = Number(quote.previousClose || 0);
  const rawChangePercent = Number(quote.changePercent);
  const changePercent = Number.isFinite(rawChangePercent)
    ? rawChangePercent
    : previousClose > 0
      ? ((price - previousClose) / previousClose) * 100
      : 0;

  return {
    symbol: quote.symbol || null,
    price,
    change: Number(quote.change || 0),
    changePercent,
    previousClose,
    volume: Number(quote.volume || 0),
    high: Number(quote.high || 0),
    low: Number(quote.low || 0),
    timestamp: quote.timestamp || new Date().toISOString(),
    source: quote.source || null,
    sourceUrl: quote.sourceUrl || null,
    sourceVerified: quote.sourceVerified === true,
    sourceLatencySeconds: Number.isFinite(Number(quote.sourceLatencySeconds))
      ? Number(quote.sourceLatencySeconds)
      : null,
    confidence: Number.isFinite(Number(quote.confidence))
      ? Number(quote.confidence)
      : null,
    delayed: Boolean(quote.delayed),
    sourceSessionDate: quote.sourceSessionDate || null,
    expectedSession: quote.expectedSession || null,
    sessionVerified: quote.sessionVerified === true,
    snapshotGeneratedAt: quote.snapshotGeneratedAt || null,
    snapshotMode: quote.snapshotMode || null,
    intradayCandles: Array.isArray(quote.intradayCandles)
      ? quote.intradayCandles
      : [],
    sourceSessionDate: quote.sourceSessionDate || null,
    expectedSession: quote.expectedSession || null,
    sessionVerified: quote.sessionVerified === true,
    atomicHandoff: quote.atomicHandoff === true,
    sourceGeneratedAt: quote.sourceGeneratedAt || null,
    sourceSessionDataHash: quote.sourceSessionDataHash || null
  };
}

async function getMarketSnapshot(provider) {
  if (!provider || typeof provider.fetchQuotes !== 'function') {
    return {
      status: 'OFFLINE',
      source: 'NONE',
      quotes: [],
      timestamp: new Date().toISOString()
    };
  }

  const rawQuotes = await provider.fetchQuotes();
  const quotes = Array.isArray(rawQuotes) ? rawQuotes.map(normalizeQuote) : [];
  const sessions = [...new Set(quotes.map(item => item.sourceSessionDate).filter(Boolean))].sort();
  const expectedSessions = [...new Set(quotes.map(item => item.expectedSession).filter(Boolean))].sort();
  const sourceGeneratedAts = quotes.map(item => item.sourceGeneratedAt).filter(Boolean).sort();
  const fingerprints = [...new Set(quotes.map(item => item.sourceSessionDataHash).filter(Boolean))];

  const sessionDate = sessions.length === 1 ? sessions[0] : sessions.at(-1) || null;
  const expectedSession = expectedSessions.length === 1 ? expectedSessions[0] : expectedSessions.at(-1) || null;
  const sessionAligned = Boolean(
    quotes.length &&
    expectedSession &&
    sessions.length === 1 &&
    sessionDate === expectedSession &&
    quotes.every(item => item.sessionVerified === true)
  );

  return {
    status: quotes.length ? 'CONNECTED' : 'NO_QUOTES',
    source: provider.name || 'EGX_PROVIDER',
    quotes,
    timestamp: new Date().toISOString(),
    sessionDate,
    expectedSession,
    sessionAligned,
    atomicHandoff: quotes.length > 0 && quotes.every(item => item.atomicHandoff === true),
    sourceGeneratedAt: sourceGeneratedAts.at(-1) || null,
    sourceSessionDataHash: fingerprints.length === 1 ? fingerprints[0] : null
  };
}

module.exports = { normalizeQuote, getMarketSnapshot };
