const { runRuntimePipeline } = require('../../engine/runtime-pipeline.js');

async function handler(req, res) {
  const now = new Date().toISOString();

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {
    const pipeline = await runRuntimePipeline();

    const quoteCount = Number(pipeline.liveQuoteCount || 0);
    const freshQuoteCount = Number(pipeline.freshQuoteCount || 0);
    const historyReady = Number(pipeline.historyCount || 0) > 0;

    const engineStatus =
      pipeline.status === 'NO_DATA'
        ? 'NO_DATA'
        : freshQuoteCount > 0
          ? 'LIVE_READY'
          : quoteCount > 0
            ? 'DELAYED_READY'
            : historyReady
              ? 'HISTORICAL_READY'
              : 'NO_DATA';

    const watchlistCount = Array.isArray(pipeline.watchlist)
      ? pipeline.watchlist.length
      : 0;

    const rejectedCount = Array.isArray(pipeline.rejected)
      ? pipeline.rejected.length
      : 0;

    const recommendationCount = Array.isArray(pipeline.recommendations)
      ? pipeline.recommendations.length
      : 0;

    return res.status(200).json({
      success: true,
      market: 'EGX',
      dataEngine: engineStatus,
      engineStatus,
      pipeline: pipeline.status || 'UNKNOWN',
      liveFeed:
        freshQuoteCount > 0
          ? 'FRESH'
          : quoteCount > 0
            ? 'DELAYED_CURRENT_SESSION'
            : 'WAITING_FOR_SOURCE',
      historicalData: historyReady ? 'CONNECTED' : 'EMPTY',
      historicalSymbols: pipeline.historySymbols || [],
      source: pipeline.liveSource || 'NONE',
      marketSessionDate: pipeline.marketSessionDate || null,
      expectedSession: pipeline.expectedSession || null,
      marketSessionAligned: pipeline.marketSessionAligned === true,
      atomicHandoff: pipeline.atomicHandoff === true,
      sourceGeneratedAt: pipeline.sourceGeneratedAt || null,
      sourceSessionDataHash: pipeline.sourceSessionDataHash || null,
      snapshot: engineStatus,
      quoteCount,
      freshQuoteCount,
      historyCount: Number(pipeline.historyCount || 0),
      symbolsAnalyzed: Number(pipeline.symbolsAnalyzed || 0),
      morningConfirmedCount: Number(pipeline.morningConfirmedCount || 0),
      executionReadyCount: Number(pipeline.executionReadyCount || 0),
      recommendationCount,
      watchlistCount,
      rejectedCount,
      checkedAt: now,
      snapshotTime: pipeline.generatedAt,
      marketSessionDate: pipeline.marketSessionDate || null,
      historySessionDate: pipeline.historySessionDate || null,
      sessionAligned: pipeline.sessionAligned === true,
      snapshotMode: pipeline.snapshotMode || null,
      marketSnapshotGeneratedAt: pipeline.marketSnapshotGeneratedAt || null,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      recommendationsReady:
        recommendationCount + watchlistCount + rejectedCount > 0,
      message:
        engineStatus === 'LIVE_READY'
          ? 'ASTRA has fresh market quotes and validated historical context.'
          : engineStatus === 'DELAYED_READY'
            ? 'ASTRA has current-session delayed market data and validated history. Execution remains blocked until fresh price and first-15-minute liquidity evidence are confirmed.'
            : engineStatus === 'HISTORICAL_READY'
              ? 'ASTRA is running from validated historical market data; execution remains blocked until current-session price and morning evidence are confirmed.'
              : 'ASTRA has no usable market data.'
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      market: 'EGX',
      dataEngine: 'ERROR',
      engineStatus: 'ERROR',
      pipeline: 'ERROR',
      liveFeed: 'UNKNOWN',
      historicalData: 'UNKNOWN',
      quoteCount: 0,
      freshQuoteCount: 0,
      historyCount: 0,
      checkedAt: now,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      recommendationsReady: false,
      message: 'ASTRA health check failed safely.',
      error: error?.message || 'Unknown runtime error'
    });
  }
}

module.exports = handler;
