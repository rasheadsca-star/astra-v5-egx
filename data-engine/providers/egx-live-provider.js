// ASTRA V4 EGX Live Provider
// Free public-market-data fallback using Yahoo Finance chart data.
// Yahoo is delayed and is never treated as authoritative live EGX data.

const WATCHLIST = ['COMI', 'SWDY', 'FWRY', 'TMGH', 'HRHO'];
const YAHOO_SYMBOLS = Object.fromEntries(
  WATCHLIST.map((symbol) => [symbol, symbol + '.CA'])
);
const REQUEST_TIMEOUT_MS = 8000;

function emptyQuote(symbol, sourceUrl = null) {
  return {
    symbol,
    price: 0,
    change: 0,
    changePercent: 0,
    previousClose: 0,
    volume: 0,
    high: 0,
    low: 0,
    timestamp: new Date().toISOString(),
    source: 'YAHOO_FINANCE_DELAYED',
    sourceUrl,
    sourceVerified: false,
    sourceLatencySeconds: null,
    confidence: 0,
    delayed: true,
    intradayCandles: []
  };
}

async function fetchYahooQuote(symbol) {
  const yahooSymbol = YAHOO_SYMBOLS[symbol] || symbol + '.CA';
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(yahooSymbol) +
    '?range=1d&interval=1m&includePrePost=false';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ASTRA-V4/1.0' },
      signal: controller.signal
    });

    if (!response.ok) return emptyQuote(symbol, url);

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const meta = result?.meta || {};
    const timestamps = result?.timestamp || [];
    const quote = result?.indicators?.quote?.[0] || {};
    const closes = quote.close || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const volumes = quote.volume || [];

    let lastIndex = -1;
    for (let i = closes.length - 1; i >= 0; i -= 1) {
      if (Number.isFinite(Number(closes[i]))) {
        lastIndex = i;
        break;
      }
    }

    if (lastIndex < 0) return emptyQuote(symbol, url);

    const price = Number(closes[lastIndex]);
    const previousClose = Number(
      meta.previousClose ?? meta.chartPreviousClose ?? 0
    );
    const change = previousClose > 0 ? price - previousClose : 0;
    const changePercent = previousClose > 0
      ? (change / previousClose) * 100
      : 0;

    const intradayCandles = timestamps
      .map((timestamp, index) => ({
        timestamp: Number(timestamp) * 1000,
        close: Number(closes[index] || 0),
        high: Number(highs[index] || 0),
        low: Number(lows[index] || 0),
        volume: Number(volumes[index] || 0)
      }))
      .filter((row) => row.close > 0);

    const latestTimestamp = timestamps[lastIndex]
      ? Number(timestamps[lastIndex]) * 1000
      : Date.now();

    const sourceLatencySeconds = Math.max(
      0,
      (Date.now() - latestTimestamp) / 1000
    );

    return {
      symbol,
      price,
      change,
      changePercent,
      previousClose,
      volume: Number(volumes[lastIndex] || 0),
      high: Number(highs[lastIndex] || price),
      low: Number(lows[lastIndex] || price),
      timestamp: new Date(latestTimestamp).toISOString(),
      source: 'YAHOO_FINANCE_DELAYED',
      sourceUrl: url,
      sourceVerified: false,
      sourceLatencySeconds,
      confidence: 0,
      delayed: true,
      intradayCandles
    };
  } catch (_) {
    return emptyQuote(symbol, url);
  } finally {
    clearTimeout(timeout);
  }
}

const egxLiveProvider = {
  name: 'YAHOO_FINANCE_DELAYED',

  async fetchQuotes() {
    const quotes = await Promise.all(WATCHLIST.map(fetchYahooQuote));
    return quotes.filter((quote) => quote.price > 0);
  },

  async getQuotes() {
    return this.fetchQuotes();
  }
};

module.exports = { egxLiveProvider };
