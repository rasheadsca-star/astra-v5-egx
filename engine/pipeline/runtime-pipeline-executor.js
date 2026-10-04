// ASTRA V4 Runtime Pipeline Executor
// Connects runtime analyzer, recommender and trade calculator.

const runPipeline = ({ snapshot, analyzer, recommender, calculator }) => {
  const analysis = analyzer(snapshot);
  const recommendation = recommender(analysis, snapshot);
  const trade = calculator(recommendation, snapshot);

  return {
    timestamp: new Date().toISOString(),
    status: 'COMPLETED',
    analysis,
    recommendation: {
      ...recommendation,
      ...trade
    }
  };
};

module.exports = { runPipeline };
