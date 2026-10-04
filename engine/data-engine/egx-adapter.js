// ASTRA V4 EGX Data Adapter
// Initial adapter layer for connecting EGX market data sources.

function normalizeMarketRecord(record) {
  return {
    symbol: record.symbol,
    price: Number(record.price),
    volume: Number(record.volume || 0),
    timestamp: record.timestamp || new Date().toISOString()
  };
}

function createSnapshot(records = []) {
  return {
    market: "EGX",
    generatedAt: new Date().toISOString(),
    symbols: records.map(normalizeMarketRecord),
    quality: records.length ? "VALID" : "EMPTY"
  };
}

module.exports = {
  normalizeMarketRecord,
  createSnapshot
};
