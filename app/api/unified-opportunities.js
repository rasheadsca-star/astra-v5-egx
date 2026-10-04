'use strict';

const { runRuntimePipeline } = require('../../engine/runtime-pipeline');
const { runUcpShadowPipeline } = require('../../engine/ucp/shadow-pipeline');
const { buildUnifiedOpportunityBoard } = require('../../engine/ucp/unified-opportunity');

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {
    const [runtime, ucp] = await Promise.all([
      runRuntimePipeline(),
      runUcpShadowPipeline()
    ]);

    const board = buildUnifiedOpportunityBoard({ runtime, ucp });

    return res.status(200).json({
      success: true,
      ...board,
      ucpStatus: ucp.status || null,
      runtimeStatus: runtime.status || null,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      schemaVersion: 'rasheed-egx-unified-opportunity-board/v1',
      executionAllowed: false,
      rows: [],
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      error: error?.message || 'UNIFIED_OPPORTUNITY_BOARD_ERROR'
    });
  }
}

module.exports = handler;
