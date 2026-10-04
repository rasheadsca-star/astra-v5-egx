'use strict';

const { loadQuantBoard } = require('../../engine/ucp/quant-adapter');

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  try {
    const board = loadQuantBoard();
    return res.status(200).json({
      success: board.status === 'READY',
      ...board,
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null
    });
  } catch (error) {
    return res.status(200).json({
      success: false,
      schemaVersion: 'rasheed-egx-quant-board/v1',
      status: 'ERROR',
      executionAllowed: false,
      candidates: [],
      error: error?.message || 'QUANT_BOARD_ERROR',
      deploymentCommit: process.env.VERCEL_GIT_COMMIT_SHA || null
    });
  }
}

module.exports = handler;
