const fs = require('fs');
const path = require('path');

const { buildRuntimeRecommendations } = require('../engine/runtime-pipeline');

const fixturePath = path.join(__dirname, '..', 'tests', 'fixtures', 'market-snapshot.fixture.json');
const outputPath = path.join(__dirname, '..', 'artifacts', 'astra-result.json');
const fixture = require(fixturePath);

function buildHistory(symbol, start, drift) {
  return Array.from({ length: 25 }, (_, index) => {
    const close = start + index * drift;
    return {
      ticker: symbol,
      date: '2026-08-' + String(index + 1).padStart(2, '0'),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000000 + index * 10000
    };
  });
}

async function main() {
  const profiles = {
    COMI: [100, 1.2],
    SWDY: [80, 0.4],
    FWRY: [60, 0.2],
    TMGH: [50, -0.1],
    HRHO: [40, -0.4]
  };

  const histories = Object.fromEntries(
    Object.entries(profiles).map(([symbol, [start, drift]]) => [
      symbol,
      buildHistory(symbol, start, drift)
    ])
  );

  const result = await buildRuntimeRecommendations({
    liveSnapshot: { quotes: [], source: 'E2E_FIXTURE' },
    histories
  });

  if (result.status !== 'READY' || result.recommendations.length < 1) {
    throw new Error('ASTRA E2E failed to produce at least one entry candidate');
  }

  const invalid = result.recommendations.find((item) => {
    const baseInvalid =
      !fixture.symbols.includes(item.symbol) ||
      item.signal !== 'BUY' ||
      item.entryOpportunity !== true ||
      !Number.isFinite(item.confidence) ||
      !item.riskLevel ||
      !(item.entry > 0);

    if (baseInvalid) return true;

    return !(
      item.stopLoss < item.entry &&
      item.entry < item.target1 &&
      item.target1 < item.target2 &&
      item.target2 < item.target3
    );
  });

  if (invalid) {
    throw new Error('ASTRA E2E produced an invalid long-entry contract');
  }

  if ((result.watchlist || []).some((item) => item.signal === 'SELL')) {
    throw new Error('ASTRA E2E emitted a forbidden SELL entry');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    source: 'ASTRA-RUNTIME-ENGINE',
    market: fixture.market,
    mode: result.mode,
    summary: {
      entryCandidates: result.recommendations.length,
      watchlist: result.watchlist?.length || 0,
      buySignals: result.recommendations.filter((r) => r.signal === 'BUY').length,
      sellSignals: 0
    },
    recommendations: result.recommendations,
    watchlist: result.watchlist || []
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log('ASTRA E2E ENTRY-ONLY REPORT');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('ASTRA E2E FAILED');
  console.error(error);
  process.exit(1);
});
