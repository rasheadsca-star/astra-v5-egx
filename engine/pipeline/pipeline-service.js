// ASTRA V4 Pipeline Service
// Connects pipeline stages into an executable flow.

const { runPipeline } = require('./pipeline-runner');

function executePipeline(input = {}) {
  const pipeline = runPipeline(input);

  pipeline.stages = pipeline.stages.map((stage) => ({
    ...stage,
    status: stage.name === 'DATA_COLLECTION' ? 'CONNECTED' : stage.status
  }));

  pipeline.status = 'PIPELINE_CONNECTED';
  pipeline.updatedAt = new Date().toISOString();

  return pipeline;
}

module.exports = { executePipeline };
