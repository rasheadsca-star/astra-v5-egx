// ASTRA V4 Snapshot Generator

export function generateSnapshot(validatedData = []) {
  const rows = Array.isArray(validatedData) ? validatedData : [];

  return {
    market: 'EGX',
    generatedAt: new Date().toISOString(),
    rows,
    rowCount: rows.length,
    freshness: 'LIVE_REQUEST',
    status: rows.length ? 'GENERATED' : 'EMPTY'
  };
}

export function isSnapshotStale(snapshot, maxAgeMinutes = 15) {
  if (!snapshot?.generatedAt) return true;

  const age = Date.now() - new Date(snapshot.generatedAt).getTime();
  return age > maxAgeMinutes * 60 * 1000;
}
