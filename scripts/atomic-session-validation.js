'use strict';

const assert = require('assert');
const { quotesFromPayload, sourceModeToSnapshotMode } = require('../data-engine/providers/canonical-market-provider');
const { validatePair } = require('../data-engine/atomic-remote-store');
const { normalizeQuote, getMarketSnapshot } = require('../data-engine/egx-adapter');

async function main() {
  const payload = {
    schemaVersion: '5.0.0',
    generatedAt: '2026-10-01T20:00:00.000Z',
    source: {
      expectedSession: '2026-10-01',
      executionGrade: true,
      atomicHandoff: true,
      sourceSessionDataHash: 'abc123'
    },
    rows: [
      {
        symbol: 'AAA',
        price: 10,
        previousClose: 9.8,
        volume: 1000,
        sourceSessionDate: '2026-10-01',
        updatedAt: '2026-10-01T13:00:00.000Z'
      },
      {
        symbol: 'OLD',
        price: 5,
        previousClose: 5.1,
        volume: 500,
        sourceSessionDate: '2026-09-30',
        updatedAt: '2026-09-30T13:00:00.000Z'
      }
    ]
  };

  const marketCoverageFixture = {
    ...payload,
    rows: Array.from({ length: 80 }, (_, i) => ({
      symbol: i === 0 ? 'AAA' : `T${i}`,
      price: 10 + i / 10,
      previousClose: 9.8 + i / 10,
      volume: 1000 + i,
      sourceSessionDate: '2026-10-01',
      updatedAt: '2026-10-01T13:00:00.000Z'
    }))
  };

  const pairValidation = validatePair(marketCoverageFixture, {
    schemaVersion: '5.0.0',
    generatedAt: payload.generatedAt,
    source: { ...payload.source },
    coverage: { coveragePct: 95 },
    symbols: { AAA: { sessions: [{ date: '2026-10-01', close: 10 }] } }
  });
  assert.strictEqual(pairValidation.valid, true, JSON.stringify(pairValidation));
  assert.strictEqual(sourceModeToSnapshotMode('ASTRA_REMOTE_ATOMIC_GITHUB'), 'REMOTE_ATOMIC_SNAPSHOT');
  assert.strictEqual(sourceModeToSnapshotMode('ASTRA_ATOMIC_LOCAL'), 'LOCAL_ATOMIC_SNAPSHOT');

  const quotes = quotesFromPayload(payload, 'ASTRA_ATOMIC_LOCAL');
  assert.strictEqual(quotes.length, 1);
  assert.strictEqual(quotes[0].symbol, 'AAA');
  assert.strictEqual(quotes[0].sourceSessionDate, '2026-10-01');
  assert.strictEqual(quotes[0].expectedSession, '2026-10-01');
  assert.strictEqual(quotes[0].sessionVerified, true);
  assert.strictEqual(quotes[0].atomicHandoff, true);
  assert.strictEqual(quotes[0].sourceSessionDataHash, 'abc123');

  const normalized = normalizeQuote(quotes[0]);
  assert.strictEqual(normalized.sourceSessionDate, '2026-10-01');
  assert.strictEqual(normalized.expectedSession, '2026-10-01');
  assert.strictEqual(normalized.atomicHandoff, true);

  const snapshot = await getMarketSnapshot({
    name: 'TEST_ATOMIC_PROVIDER',
    async fetchQuotes() { return quotes; }
  });

  assert.strictEqual(snapshot.status, 'CONNECTED');
  assert.strictEqual(snapshot.sessionDate, '2026-10-01');
  assert.strictEqual(snapshot.expectedSession, '2026-10-01');
  assert.strictEqual(snapshot.sessionAligned, true);
  assert.strictEqual(snapshot.atomicHandoff, true);
  assert.strictEqual(snapshot.sourceSessionDataHash, 'abc123');

  const mixed = await getMarketSnapshot({
    name: 'TEST_MIXED_PROVIDER',
    async fetchQuotes() {
      return [
        quotes[0],
        { ...quotes[0], symbol: 'BBB', sourceSessionDate: '2026-09-30', sessionVerified: false }
      ];
    }
  });

  assert.strictEqual(mixed.sessionAligned, false);

  console.log('ASTRA atomic session handoff validation passed');
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
