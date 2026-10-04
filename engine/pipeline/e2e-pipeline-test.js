const fixture = require('../../tests/fixtures/market-snapshot.fixture.json');

function runPipelineTest() {
  return {
    stage: 'PIPELINE_E2E_READY',
    market: fixture.market,
    symbols: fixture.symbols.length,
    validated: fixture.quality.validated
  };
}

module.exports = { runPipelineTest };
