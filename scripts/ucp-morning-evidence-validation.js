'use strict';

const assert = require('assert');
const { buildEvidence, cairoClock, rowTiming } = require('./ucp-morning-evidence-collector');

function baseline(sessionDate, volume = 1000, turnover = 10000) {
  return {
    sessionDate,
    capturedAt: `${sessionDate}T07:30:00.000Z`,
    minuteOfDay: 630,
    rows: {
      COPR: { volume, turnover, price: 10 }
    }
  };
}

function marketRows(nowIso) {
  const rows = [];
  for (let i = 0; i < 10; i += 1) {
    rows.push({
      symbol: i === 0 ? 'COPR' : `T${i}`,
      sourceSessionDate: '2026-10-04',
      updatedAt: nowIso,
      price: i === 0 ? 10 : 20 + i,
      open: i === 0 ? 10.1 : 20 + i,
      previousClose: i === 0 ? 10 : 19 + i,
      volume: i === 0 ? 800 : 900,
      valueTraded: i === 0 ? 8000 : 9000,
      changePct: i < 6 ? 1 : -1
    });
  }
  return rows;
}

function ucpFixture() {
  return {
    snapshot: {
      dataGate: { metrics: { expectedUniverseSize: 10 } },
      morningConfirmation: {
        preparedCandidates: [{
          ticker: 'COPR',
          frozenAlpha: {
            entryLow: 9.8,
            entryHigh: 10.2,
            stopLoss: 9,
            target1: 11
          }
        }]
      }
    }
  };
}

function main() {
  const now = new Date('2026-10-04T07:45:00.000Z');
  const clock = cairoClock(now);
  assert.strictEqual(clock.sessionDate, '2026-10-04');
  assert.strictEqual(clock.minuteOfDay, 645, JSON.stringify(clock));

  const inferred = rowTiming({ updatedAt: now.toISOString() }, now);
  assert.strictEqual(inferred.timingMode, 'RECEIPT_MINUS_EXPECTED_DELAY');
  assert.strictEqual(inferred.effectiveSourceMinute, 630);
  assert.strictEqual(inferred.inferredDelayMinutes, 15);

  const explicit = rowTiming({ sourceMarketTime: '10:32', updatedAt: now.toISOString() }, now);
  assert.strictEqual(explicit.timingMode, 'EXPLICIT_MARKET_TIME');
  assert.strictEqual(explicit.effectiveSourceMinute, 632);

  const existing = {
    baselineSessions: [
      baseline('2026-09-27'),
      baseline('2026-09-28', 1050, 10250),
      baseline('2026-09-29', 950, 9750),
      baseline('2026-09-30', 1100, 10500),
      baseline('2026-10-01', 1000, 10000)
    ]
  };

  const complete = buildEvidence({
    market: { rows: marketRows(now.toISOString()), generatedAt: now.toISOString(), source: 'TEST_CURRENT_MARKET' },
    ucp: ucpFixture(),
    existing,
    now
  });
  assert.strictEqual(complete.schemaVersion, 'rasheed-egx-ucp-morning-evidence/v2');
  assert.strictEqual(complete.completeSource, true, JSON.stringify(complete));
  assert.strictEqual(complete.marketCoveragePct, 100);
  assert.strictEqual(complete.collectorMinute, 645);
  assert.strictEqual(complete.latestSourceMinute, 630);
  assert.strictEqual(complete.policy.expectedFeedDelayMinutes, 15);
  assert.strictEqual(complete.resilience.appAvailabilityIndependentOfMorningEvidence, true);
  assert.strictEqual(complete.evidenceByTicker.COPR.candidatePresent, true);
  assert.strictEqual(complete.evidenceByTicker.COPR.latestSourceMinute, 630);
  assert.strictEqual(complete.evidenceByTicker.COPR.timingMode, 'RECEIPT_MINUS_EXPECTED_DELAY');
  assert.strictEqual(complete.evidenceByTicker.COPR.volumeBaselineAvailable, true);
  assert.strictEqual(complete.evidenceByTicker.COPR.openingGapPass, true);
  assert.strictEqual(complete.evidenceByTicker.COPR.priceAcceptancePass, true);
  assert.strictEqual(complete.evidenceByTicker.COPR.relativeVolumePass, true);
  assert.strictEqual(complete.evidenceByTicker.COPR.relativeTurnoverPass, true);
  assert.strictEqual(complete.evidenceByTicker.COPR.marketBreadthPass, true);

  const tooEarlyReceipt = new Date('2026-10-04T07:30:00.000Z');
  const tooEarlyDelayed = buildEvidence({
    market: {
      rows: marketRows(tooEarlyReceipt.toISOString()),
      generatedAt: tooEarlyReceipt.toISOString(),
      source: 'TEST_DELAYED_MARKET'
    },
    ucp: ucpFixture(),
    existing,
    now: tooEarlyReceipt
  });
  assert.strictEqual(tooEarlyDelayed.completeSource, false);
  assert.strictEqual(tooEarlyDelayed.marketCoveragePct, 0);
  assert.strictEqual(tooEarlyDelayed.evidenceByTicker.COPR.candidatePresent, false);

  const insufficientBaseline = buildEvidence({
    market: { rows: marketRows(now.toISOString()), generatedAt: now.toISOString(), source: 'TEST_CURRENT_MARKET' },
    ucp: ucpFixture(),
    existing: { baselineSessions: existing.baselineSessions.slice(0, 4) },
    now
  });
  assert.strictEqual(insufficientBaseline.completeSource, false);
  assert.strictEqual(insufficientBaseline.evidenceByTicker.COPR.volumeBaselineAvailable, false);

  const staleRows = marketRows('2026-10-04T06:00:00.000Z');
  const stale = buildEvidence({
    market: { rows: staleRows, generatedAt: now.toISOString(), source: 'TEST_CURRENT_MARKET' },
    ucp: ucpFixture(),
    existing,
    now
  });
  assert.strictEqual(stale.completeSource, false);
  assert.strictEqual(stale.marketCoveragePct, 0);
  assert.strictEqual(stale.evidenceByTicker.COPR.candidatePresent, false);

  console.log('Rasheed EGX UCP real morning evidence validation passed');
}

main();
