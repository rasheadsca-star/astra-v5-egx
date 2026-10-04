// ASTRA V4 Data Collector
// Clean input layer - source adapters will be added here.

export function collectMarketData(sourcePayload = []) {
  const timestamp = new Date().toISOString();

  return {
    timestamp,
    rows: Array.isArray(sourcePayload) ? sourcePayload : [],
    sourceStatus: 'READY'
  };
}
