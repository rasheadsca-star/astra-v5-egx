// ASTRA V4 EGX Data Provider
// Unified provider layer for live feed, snapshot mode, and future APIs.

function normalizeQuotes(source = []) {
  if (!Array.isArray(source)) return [];

  return source
    .filter(item => item && item.symbol)
    .map(item => ({
      symbol: item.symbol,
      price: Number(item.price ?? 0),
      change: Number(item.change ?? item.changePercent ?? 0),
      volume: Number(item.volume ?? 0),
      updatedAt: item.updatedAt || new Date().toISOString()
    }));
}

export function createSnapshot(source = []) {
  const quotes = normalizeQuotes(source);

  return {
    market: 'EGX',
    mode: quotes.length ? 'SNAPSHOT_MODE' : 'WAITING_FOR_DATA',
    quotes,
    count: quotes.length,
    generatedAt: new Date().toISOString()
  };
}

export async function getEGXSnapshot(source = []) {
  return createSnapshot(source);
}

export default { getEGXSnapshot, createSnapshot };
