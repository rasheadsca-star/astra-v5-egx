// ASTRA V4 Market Snapshot Validator

export function validateSnapshot(snapshot = {}) {
  const now = Date.now();
  const timestamp = new Date(snapshot.timestamp || 0).getTime();

  if (!timestamp) {
    return { status: 'INVALID', reason: 'MISSING_TIMESTAMP' };
  }

  const ageSeconds = Math.floor((now - timestamp) / 1000);

  return {
    status: ageSeconds <= 300 ? 'FRESH' : 'STALE',
    ageSeconds,
    quoteCount: snapshot.quotes?.length || 0,
    timestamp: snapshot.timestamp
  };
}
