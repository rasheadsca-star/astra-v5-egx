const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  const checkedAt = new Date().toISOString();

  try {
    const pipeline = await runRuntimePipeline();
    const quoteCount = Number(pipeline.liveQuoteCount || 0);
    const freshQuoteCount = Number(pipeline.freshQuoteCount || 0);
    const historyReady = Number(pipeline.historyCount || 0) > 0;

    return res.status(200).json({
      success: true,
      system: 'ASTRA_V4',
      checkedAt,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      dataEngine:
        freshQuoteCount > 0 || quoteCount > 0 || historyReady
          ? 'READY'
          : 'NO_DATA',
      liveFeed:
        freshQuoteCount > 0
          ? 'FRESH'
          : quoteCount > 0
            ? 'DELAYED_CURRENT_SESSION'
            : 'WAITING_FOR_SOURCE',
      historicalData: historyReady ? 'CONNECTED' : 'EMPTY',
      pipeline: pipeline.status || 'UNKNOWN',
      mode: pipeline.mode || 'NO_DATA',
      source: pipeline.liveSource || 'NONE',
      marketSessionDate: pipeline.marketSessionDate || null,
      expectedSession: pipeline.expectedSession || null,
      marketSessionAligned: pipeline.marketSessionAligned === true,
      atomicHandoff: pipeline.atomicHandoff === true,
      sourceGeneratedAt: pipeline.sourceGeneratedAt || null,
      sourceSessionDataHash: pipeline.sourceSessionDataHash || null,
      quotes: quoteCount,
      freshQuotes: freshQuoteCount,
      recommendations: pipeline.recommendations?.length || 0,
      watchlist: pipeline.watchlist?.length || 0,
      rejected: pipeline.rejected?.length || 0,
      morningConfirmed: Number(pipeline.morningConfirmedCount || 0),
      executionReady: Number(pipeline.executionReadyCount || 0),
      resilience: {
        morningEvidenceCriticalToAppAvailability: false,
        expectedMorningFeedDelayMinutes: 15,
        morningDataGapBehavior: 'PRESERVE_AFTER_CLOSE_CANDIDATES_AND_FAIL_CLOSED_ON_EXECUTION'
      },
      healthy: pipeline.status !== 'NO_DATA'
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      system: 'ASTRA_V4',
      checkedAt,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      healthy: false,
      resilience: {
        morningEvidenceCriticalToAppAvailability: false,
        expectedMorningFeedDelayMinutes: 15
      },
      error: error?.message || 'Unknown runtime error'
    });
  }
}

module.exports = handler;
