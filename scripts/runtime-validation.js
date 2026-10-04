const assert = require('assert');
const { buildRuntimeRecommendations } = require('../engine/runtime-pipeline');
const { analyze } = require('../engine/analysis-engine/runtime-analyzer');
const { generateSignal } = require('../engine/recommendation-engine/signal-generator');
const { calculateTrade, TARGET_R } = require('../engine/recommendation-engine/trade-calculator-runtime');
const { buildMorningRecord, POLICY } = require('../engine/session/morning-liquidity');

function makeHistory({ symbol, start = 100, drift = 0.4, volume = 1000000 }) {
  return Array.from({ length: 25 }, (_, index) => {
    const close = start + index * drift;
    const day = String(index + 1).padStart(2, '0');

    return {
      ticker: symbol,
      date: '2026-08-' + day,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: volume + index * 10000
    };
  });
}

function makeMorningCandles({
  sessionDate = '2026-09-30',
  startVolume = 100,
  count = 15
} = {}) {
  return Array.from({ length: count }, (_, index) => ({
    timestamp: Date.parse(
      sessionDate + 'T10:' + String(index).padStart(2, '0') + ':00+03:00'
    ),
    close: 100 + index * 0.1,
    volume: startVolume
  }));
}

async function main() {
  const histories = {
    COMI: makeHistory({ symbol: 'COMI', start: 100, drift: 1.2 }),
    SWDY: makeHistory({ symbol: 'SWDY', start: 80, drift: 0.1 })
  };

  const historicalResult = await buildRuntimeRecommendations({
    liveSnapshot: { quotes: [], source: 'TEST' },
    histories
  });

  assert.strictEqual(historicalResult.status, 'READY');
  assert.strictEqual(historicalResult.mode, 'HISTORY_MODE');
  assert.strictEqual(historicalResult.dataSource, 'HISTORICAL');
  assert(historicalResult.recommendations.length >= 1);
  assert(historicalResult.watchlist.length >= 1);

  for (const item of historicalResult.recommendations) {
    assert.strictEqual(item.signal, 'BUY');
    assert.strictEqual(item.entryOpportunity, true);
    assert.ok(Number.isFinite(item.confidence));
    assert.ok(item.riskLevel !== 'HIGH');
    assert.ok(item.entry > 0);
    assert.ok(item.stopLoss < item.entry);
    assert.ok(item.entry < item.target1);
    assert.ok(item.target1 < item.target2);
    assert.ok(item.target2 < item.target3);
    assert.ok(item.historySessions === undefined || item.analysis.historySessions >= 25);
    assert.strictEqual(item.executionReady, false);
    assert.ok(item.executionBlockers.includes('LIVE_DATA_NOT_FRESH'));
  }

  for (const item of historicalResult.watchlist) {
    assert.notStrictEqual(item.signal, 'SELL');
    assert.strictEqual(item.entry, null);
    assert.strictEqual(item.target1, null);
    assert.strictEqual(item.stopLoss, null);
  }

  const validTrade = calculateTrade({
    price: 100,
    confidence: 82,
    direction: 'BUY',
    atr14: 1.5,
    recentLow20: 98
  });

  assert.strictEqual(validTrade.status, 'READY');
  assert(validTrade.stopLoss < validTrade.entry);
  assert(validTrade.entry < validTrade.target1);
  assert(validTrade.target1 < validTrade.target2);
  assert(validTrade.target2 < validTrade.target3);
  assert.deepStrictEqual(
    [validTrade.riskReward1, validTrade.riskReward2, validTrade.riskReward3],
    TARGET_R
  );

  const invalidShort = calculateTrade({
    price: 100,
    direction: 'SELL'
  });
  assert.strictEqual(invalidShort.status, 'INVALID_DIRECTION');

  const validMorning = buildMorningRecord({
    candles: makeMorningCandles({ startVolume: 100 }),
    now: new Date('2026-09-30T10:16:00+03:00'),
    sourceUrl: 'https://verified.example/egx',
    sourceVerified: true,
    sourceLatencySeconds: 60,
    confidence: 90,
    baselineFirst15Volume: 1000
  });

  assert.strictEqual(validMorning.first15Volume, 1500);
  assert.strictEqual(validMorning.relativeVolume15, 1.5);
  assert.strictEqual(validMorning.gate.confirmed, true);

  const weakMorning = buildMorningRecord({
    candles: makeMorningCandles({ startVolume: 50 }),
    now: new Date('2026-09-30T10:16:00+03:00'),
    sourceUrl: 'https://verified.example/egx',
    sourceVerified: true,
    sourceLatencySeconds: 60,
    confidence: 90,
    baselineFirst15Volume: 1000
  });

  assert.strictEqual(weakMorning.relativeVolume15, 0.75);
  assert.ok(weakMorning.gate.reasons.includes('MORNING_LIQUIDITY_WEAK'));

  const delayedMorning = buildMorningRecord({
    candles: makeMorningCandles({ startVolume: 100 }),
    now: new Date('2026-09-30T10:16:00+03:00'),
    sourceUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/COMI.CA',
    sourceVerified: false,
    sourceLatencySeconds: 600,
    confidence: 0,
    baselineFirst15Volume: 1000
  });

  assert.ok(delayedMorning.gate.reasons.includes('MORNING_SOURCE_UNVERIFIED'));
  assert.strictEqual(delayedMorning.gate.confirmed, false);

  const analysis = analyze({
    symbols: [{
      symbol: 'COMI',
      price: 128,
      changePercent: 1.5,
      volume: 1200000,
      dataFreshness: { status: 'FRESH', ageSeconds: 60, maxAgeSeconds: 300 },
      priceMatched: true,
      morningGate: validMorning.gate,
      morningEvidence: validMorning,
      source: 'TEST_LIVE',
      delayed: false,
      sessionPhase: 'POST_MORNING'
    }],
    histories
  });

  assert.strictEqual(analysis.results.length, 1);
  assert.strictEqual(analysis.results[0].morningGate.confirmed, true);
  assert.strictEqual(analysis.results[0].dataFreshness.status, 'FRESH');
  assert.ok(analysis.results[0].atr14 > 0);
  assert.ok(analysis.results[0].recentLow20 > 0);

  const signal = generateSignal({
    symbol: 'TEST',
    analysis: { technicalScore: 82, riskLevel: 'LOW' },
    risk: { level: 'LOW' },
    trade: validTrade,
    execution: {
      liveData: true,
      dataFresh: true,
      priceMatched: true,
      morningGateConfirmed: true
    },
    entryOpportunity: true
  });

  assert.strictEqual(signal.signal, 'BUY');
  assert.strictEqual(signal.entryOpportunity, true);
  assert.strictEqual(signal.executionReady, true);
  assert.strictEqual(signal.executionMode, 'PAPER_ONLY');
  assert(signal.target1 < signal.target2 && signal.target2 < signal.target3);

  const blockedSignal = generateSignal({
    symbol: 'TEST',
    analysis: { technicalScore: 82, riskLevel: 'LOW' },
    risk: { level: 'LOW' },
    trade: validTrade,
    execution: {
      liveData: false,
      dataFresh: false,
      priceMatched: false,
      morningGateConfirmed: false
    },
    entryOpportunity: true
  });

  assert.strictEqual(blockedSignal.signal, 'BUY');
  assert.strictEqual(blockedSignal.executionReady, false);
  assert.ok(blockedSignal.executionBlockers.includes('MORNING_CONFIRMATION_REQUIRED'));

  const watchSignal = generateSignal({
    symbol: 'TEST',
    analysis: { technicalScore: 60, riskLevel: 'MEDIUM' },
    risk: { level: 'MEDIUM' },
    trade: { status: 'NOT_ELIGIBLE' },
    execution: {
      liveData: true,
      dataFresh: true,
      priceMatched: true,
      morningGateConfirmed: true
    },
    entryOpportunity: false
  });

  assert.strictEqual(watchSignal.signal, 'WATCH');
  assert.strictEqual(watchSignal.entryOpportunity, false);
  assert.strictEqual(watchSignal.entry, null);

  const noData = await buildRuntimeRecommendations({
    liveSnapshot: { quotes: [] },
    histories: {}
  });

  assert.strictEqual(noData.status, 'NO_DATA');
  assert.strictEqual(noData.recommendations.length, 0);

  assert.strictEqual(POLICY.minimumMorningRelativeVolume, 1.2);
  assert.strictEqual(POLICY.minimumMorningConfidence, 80);
  assert.strictEqual(POLICY.maximumMorningAgeMinutes, 5);

  console.log('ASTRA entry-only runtime validation passed');
}

main().catch((error) => {
  console.error('ASTRA entry-only runtime validation failed');
  console.error(error);
  process.exit(1);
});
