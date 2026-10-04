'use strict';

const { runUcpShadowPipeline } = require('../../engine/ucp/shadow-pipeline');

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {
    const result = await runUcpShadowPipeline();

    return res.status(200).json({
      ...result,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      status: 'SHADOW_ERROR',
      executionAllowed: false,
      recommendationMutationAllowed: false,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      error: error?.message || 'UCP shadow pipeline failed'
    });
  }
}

module.exports = handler;
