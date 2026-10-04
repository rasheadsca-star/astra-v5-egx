// ASTRA V4 EGX connector pipeline validation

import { describe, it, expect } from 'vitest';
import { validateSnapshot } from '../data-engine/market-snapshot.js';

const sampleSnapshot = {
  timestamp: new Date().toISOString(),
  quotes: [
    {
      symbol: 'COMI',
      price: 70,
      volume: 10000
    }
  ]
};

describe('EGX connector pipeline', () => {
  it('accepts a fresh market snapshot', () => {
    const result = validateSnapshot(sampleSnapshot);
    expect(result.status).toBe('FRESH');
  });

  it('rejects empty snapshots', () => {
    const result = validateSnapshot({ quotes: [] });
    expect(result.status).toBe('INVALID');
  });
});
