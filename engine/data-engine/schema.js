// ASTRA V4 market data schema

export const marketSnapshotSchema = {
  generatedAt: null,
  marketStatus: 'UNKNOWN',
  rows: [],
  quality: {
    coverage: 0,
    validPrices: false,
    validationStatus: 'NOT_READY'
  }
};

export function createEmptySnapshot() {
  return structuredClone(marketSnapshotSchema);
}
