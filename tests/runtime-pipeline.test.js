// ASTRA V4 Runtime Pipeline Test

const { buildRuntimeRecommendations } = require('../engine/runtime-pipeline');

const snapshot = {
  quotes: [
    {
      symbol: 'COMI',
      price: 100,
      change: 2,
      volume: 50000
    }
  ]
};

const result = buildRuntimeRecommendations(snapshot);

if (result.status !== 'READY') {
  throw new Error('Pipeline did not reach READY state');
}

if (!result.recommendations.length) {
  throw new Error('No recommendation generated');
}

console.log('ASTRA runtime pipeline test passed');
