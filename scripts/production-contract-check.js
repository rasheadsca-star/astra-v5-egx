const assert = require('assert');

const baseUrl = process.env.ASTRA_PROD_URL || 'https://ras-egx-astra-v4.vercel.app';
const expectedCommit = process.env.GITHUB_SHA;
const retryAttempts = Number(process.env.ASTRA_PROD_RETRY_ATTEMPTS || 12);
const retryDelayMs = Number(process.env.ASTRA_PROD_RETRY_DELAY_MS || 10000);
const READY_STATUSES = new Set(['LIVE_READY', 'DELAYED_READY', 'HISTORICAL_READY']);
const V24_STATUSES = new Set([
  'NO_CANDIDATES', 'WAITING_NEXT_SESSION', 'WAITING_DATA', 'DEGRADED_EVIDENCE', 'WATCH',
  'CONFIRMED_RESEARCH_ONLY', 'REJECTED_PRESENT', 'EXPIRED'
]);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function getJson(path) {
  const url = baseUrl.replace(/\/$/, '') + path;
  const response = await fetch(url, {
    headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'ASTRA-Production-Contract-Check/1.7' }
  });
  const text = await response.text();
  if (!response.ok) throw new Error('Production API HTTP ' + response.status + ': ' + text.slice(0, 1000));
  try { return JSON.parse(text); }
  catch (_) { throw new Error('Production API did not return JSON: ' + text.slice(0, 1000)); }
}

async function waitForExpectedDeployment() {
  let lastError = null;
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    try {
      const recommendations = await getJson('/api/recommendations?ci=' + encodeURIComponent(expectedCommit) + '&attempt=' + attempt);
      if (recommendations?.deploymentCommit === expectedCommit) return recommendations;
      lastError = new Error('Production deployment commit mismatch: expected ' + expectedCommit + ', received ' + (recommendations?.deploymentCommit || 'missing'));
    } catch (error) { lastError = error; }
    if (attempt < retryAttempts) await sleep(retryDelayMs);
  }
  throw lastError || new Error('Production deployment did not become ready');
}

function assertNonExecutableWhenNotFresh(payload, label) {
  if (payload.status === 'DELAYED_READY' || payload.status === 'HISTORICAL_READY') {
    assert.strictEqual(Number(payload.executionReadyCount || 0), 0, label + ' must not expose execution-ready signals without fresh market data');
  }
}

function assertUcpShadowContract(ucp) {
  assert.strictEqual(ucp.success, true, JSON.stringify(ucp));
  assert(ucp.status === 'SHADOW_READY' || ucp.status === 'SHADOW_DEGRADED', JSON.stringify(ucp));
  assert.strictEqual(ucp.executionAllowed, false, JSON.stringify(ucp));
  assert.strictEqual(ucp.recommendationMutationAllowed, false, JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot?.schema, 'rasheed-egx-ucp-decision-snapshot/v1', JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot?.pipeline?.name, 'Rasheed EGX Unified Champion Pipeline', JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot?.executionAllowed, false, JSON.stringify(ucp));
  assert(Array.isArray(ucp.snapshot?.decision?.finalRecommendations), JSON.stringify(ucp));
  assert.strictEqual(ucp.snapshot.decision.finalRecommendations.length, 0, 'UCP shadow stage must not publish final recommendations');

  const snapshotSession = ucp.snapshot?.sessionDate || null;
  const rc2 = ucp.diagnostics?.rc2;
  const rr68 = rc2?.challenger;
  const v17 = ucp.diagnostics?.v17;
  assert(rc2 && typeof rc2 === 'object', JSON.stringify(ucp));
  assert(rr68 && typeof rr68 === 'object', JSON.stringify(ucp));
  assert(v17 && typeof v17 === 'object', JSON.stringify(ucp));
  assert(Array.isArray(ucp.snapshot?.alpha?.challengers), JSON.stringify(ucp));

  if (ucp.status === 'SHADOW_READY') {
    assert.strictEqual(rc2.engineId, 'TFE_V20_FUSION_RC2', JSON.stringify(ucp));
    assert.strictEqual(rc2.mode, 'RESEARCH_ONLY', JSON.stringify(ucp));
    assert.strictEqual(rc2.available, true, JSON.stringify(rc2));
    assert.strictEqual(rc2.sessionAligned, true, JSON.stringify(rc2));
    assert.strictEqual(rc2.sessionDate, snapshotSession, JSON.stringify({ snapshotSession, rc2 }));
    assert.strictEqual(v17.available, true, JSON.stringify(v17));
    assert.strictEqual(v17.policySafe, true, JSON.stringify(v17));
    assert.strictEqual(v17.sessionAligned, true, JSON.stringify(v17));
    assert.strictEqual(v17.sourceCurrent, true, JSON.stringify(v17));
    assert.strictEqual(v17.referenceSession, snapshotSession, JSON.stringify({ snapshotSession, v17 }));
    assert(!ucp.snapshot.decision.blockers.includes('RC2_SESSION_ALIGNMENT_REQUIRED'), JSON.stringify(ucp));
    assert(!ucp.snapshot.decision.blockers.includes('V17_SESSION_ALIGNMENT_REQUIRED'), JSON.stringify(ucp));
    assert(!ucp.snapshot.decision.blockers.includes('V17_SOURCE_STATUS_NOT_CURRENT'), JSON.stringify(ucp));
  }

  if (rr68.published === true) {
    assert.strictEqual(rr68.id, 'TFE_V20_FUSION_RC2_RR68_CHALLENGER', JSON.stringify(rr68));
    assert.strictEqual(rr68.baseEngine, 'TFE_V20_FUSION_RC2', JSON.stringify(rr68));
    assert.strictEqual(rr68.available, true, JSON.stringify(rr68));
    assert.strictEqual(rr68.sessionAligned, true, JSON.stringify(rr68));
    assert.strictEqual(rr68.sessionDate, snapshotSession, JSON.stringify({ snapshotSession, rr68 }));
    assert.strictEqual(rr68.researchOnly, true, JSON.stringify(rr68));
    assert.strictEqual(rr68.executionAllowed, false, JSON.stringify(rr68));
    assert.strictEqual(rr68.automaticPromotionAllowed, false, JSON.stringify(rr68));
    assert.strictEqual(Number(rr68.policyDiff?.minStructuralNetRR?.frozenChampion), 0.70, JSON.stringify(rr68));
    assert.strictEqual(Number(rr68.policyDiff?.minStructuralNetRR?.challenger), 0.68, JSON.stringify(rr68));

    const alphaRr68 = ucp.snapshot.alpha.challengers.find((item) => item.id === rr68.id);
    assert(alphaRr68, JSON.stringify(ucp.snapshot.alpha));
    assert.strictEqual(alphaRr68.executionAllowed, false, JSON.stringify(alphaRr68));
    assert.strictEqual(alphaRr68.candidates.length, Number(rr68.candidateCount || 0), JSON.stringify({ alphaRr68, rr68 }));

    for (const item of rr68.candidates || []) {
      assert.strictEqual(item.candidateSource, 'TFE_V20_FUSION_RC2_RR68_CHALLENGER', JSON.stringify(item));
      assert.strictEqual(item.challengerResearchOnly, true, JSON.stringify(item));
      assert(Number(item.structuralNetRR) >= 0.68, JSON.stringify(item));
      assert.strictEqual(item.publicationHold, false, JSON.stringify(item));
    }

    if (Number(rr68.candidateCount || 0) > 0) {
      assert(ucp.snapshot.decision.blockers.includes('RR68_CHALLENGER_FORWARD_VALIDATION_REQUIRED'), JSON.stringify(ucp));
      const preparedTickers = new Set((ucp.snapshot.morningConfirmation.preparedCandidates || []).map((item) => item.ticker));
      for (const item of rr68.candidates || []) assert(preparedTickers.has(item.ticker), JSON.stringify({ preparedTickers:[...preparedTickers], rr68 }));
    }
  }

  assert.strictEqual(ucp.snapshot?.governance?.executionAllowed, false, JSON.stringify(ucp));
  assert(Array.isArray(ucp.snapshot?.governance?.approvedSymbols), JSON.stringify(ucp));
  assert(Array.isArray(ucp.snapshot?.governance?.rejectedSymbols), JSON.stringify(ucp));

  if (v17.available === true) {
    assert.strictEqual(v17.policySafe, true, JSON.stringify(v17));
    if (v17.sessionAligned !== true) {
      assert.strictEqual(ucp.snapshot.governance.approvedSymbols.length, 0, JSON.stringify(ucp));
      assert(ucp.snapshot.decision.blockers.includes('V17_SESSION_ALIGNMENT_REQUIRED'), JSON.stringify(ucp));
    }
  } else {
    assert(ucp.snapshot.decision.blockers.includes('V17_GOVERNANCE_UNAVAILABLE'), JSON.stringify(ucp));
  }

  if (rc2.available === true && rc2.sessionAligned !== true) {
    assert.strictEqual(ucp.snapshot.alpha.candidates.length, 0, JSON.stringify(ucp));
    assert(ucp.snapshot.decision.blockers.includes('RC2_SESSION_ALIGNMENT_REQUIRED'), JSON.stringify(ucp));
  }

  const v24 = ucp.diagnostics?.v24;
  const metaLabel = v24?.metaLabel;
  const morning = ucp.snapshot?.morningConfirmation;
  assert(v24 && typeof v24 === 'object', JSON.stringify(ucp));
  assert(metaLabel && typeof metaLabel === 'object', JSON.stringify(v24));
  assert.strictEqual(metaLabel.usedForSelection, false, JSON.stringify(metaLabel));
  assert.strictEqual(metaLabel.executionAllowed, false, JSON.stringify(metaLabel));
  assert(Array.isArray(metaLabel.results), JSON.stringify(metaLabel));
  if (metaLabel.modelStatus !== 'CALIBRATED') {
    for (const item of metaLabel.results) {
      assert.strictEqual(item.probabilityTarget1Pct, null, JSON.stringify(item));
      assert.strictEqual(item.expectedValuePct, null, JSON.stringify(item));
      assert.strictEqual(item.usedForSelection, false, JSON.stringify(item));
      assert.strictEqual(item.executionAllowed, false, JSON.stringify(item));
    }
  }
  assert(morning && typeof morning === 'object', JSON.stringify(ucp));
  assert.strictEqual(morning.engineId, 'V2_4_MORNING_CONFIRMATION', JSON.stringify(ucp));
  assert.strictEqual(morning.executionAllowed, false, JSON.stringify(ucp));
  assert(V24_STATUSES.has(morning.status), JSON.stringify(morning));
  assert.strictEqual(morning.status, v24.status, JSON.stringify({ morning, v24 }));
  assert(Array.isArray(morning.confirmedSymbols), JSON.stringify(morning));
  assert(Array.isArray(morning.waitingSymbols), JSON.stringify(morning));
  assert(Array.isArray(morning.rejectedSymbols), JSON.stringify(morning));
  assert(Array.isArray(morning.expiredSymbols), JSON.stringify(morning));
  assert(!ucp.snapshot.decision.blockers.includes('V2_4_MORNING_CONFIRMATION_NOT_WIRED'), JSON.stringify(ucp));

  if ((v24.preparedCount || 0) > 0 && morning.confirmedSymbols.length === 0) {
    assert(ucp.snapshot.decision.blockers.includes('V2_4_MORNING_CONFIRMATION_PENDING'), JSON.stringify(ucp));
  }
  if (v24.evidenceComplete !== true) {
    assert.strictEqual(morning.confirmedSymbols.length, 0, 'Incomplete morning evidence must not confirm candidates');
  }
  if (morning.status === 'DEGRADED_EVIDENCE') {
    assert.strictEqual(ucp.status, 'SHADOW_READY', 'Morning data gaps must not degrade an otherwise healthy UCP');
    assert.strictEqual(ucp.executionAllowed, false);
    assert.strictEqual(ucp.recommendationMutationAllowed, false);
    assert((morning.waitingSymbols || []).length > 0, JSON.stringify(morning));
    assert(ucp.snapshot.decision.blockers.includes('V2_4_MORNING_CONFIRMATION_PENDING'), JSON.stringify(ucp));
  }
  for (const item of morning.preparedCandidates || []) {
    assert.strictEqual(item.executionAllowed, false, JSON.stringify(item));
  }

  const forward = ucp.diagnostics?.forward;
  const forwardSnapshot = ucp.snapshot?.forwardValidation;
  assert(forward && typeof forward === 'object', JSON.stringify(ucp));
  assert(forwardSnapshot && typeof forwardSnapshot === 'object', JSON.stringify(ucp));
  assert.strictEqual(forwardSnapshot.automaticPromotionAllowed, false, JSON.stringify(forwardSnapshot));
  assert.strictEqual(forwardSnapshot.executionAllowed, false, JSON.stringify(forwardSnapshot));
  assert.strictEqual(forward.promotion?.automaticPromotionAllowed, false, JSON.stringify(forward));
  assert.strictEqual(forward.promotion?.executionAllowed, false, JSON.stringify(forward));
  assert.strictEqual(forwardSnapshot.promotionEligible, forward.promotion?.eligible === true, JSON.stringify({ forwardSnapshot, forward }));

  if (forward.promotion?.eligible === true) {
    assert.strictEqual(forwardSnapshot.status, 'MANUAL_CHAMPION_REVIEW_REQUIRED', JSON.stringify(forwardSnapshot));
    assert(ucp.snapshot.decision.blockers.includes('MANUAL_CHAMPION_REVIEW_REQUIRED'), JSON.stringify(ucp));
    assert(!ucp.snapshot.decision.blockers.includes('FORWARD_VALIDATION_REQUIRED'), JSON.stringify(ucp));
  } else {
    assert.strictEqual(forwardSnapshot.status, 'FORWARD_VALIDATION_REQUIRED', JSON.stringify(forwardSnapshot));
    assert(ucp.snapshot.decision.blockers.includes('FORWARD_VALIDATION_REQUIRED'), JSON.stringify(ucp));
  }
}

async function main() {
  assert(expectedCommit, 'GITHUB_SHA is required');

  const recommendations = await waitForExpectedDeployment();
  const health = await getJson('/api/data-health?ci=' + encodeURIComponent(expectedCommit));
  const system = await getJson('/api/system-health?ci=' + encodeURIComponent(expectedCommit));
  const ucp = await getJson('/api/ucp-shadow?ci=' + encodeURIComponent(expectedCommit));
  const unified = await getJson('/api/unified-opportunities?ci=' + encodeURIComponent(expectedCommit));

  assert.strictEqual(recommendations.success, true, JSON.stringify(recommendations));
  assert(recommendations.marketSessionDate, JSON.stringify(recommendations));
  assert(recommendations.historySessionDate, JSON.stringify(recommendations));
  assert.strictEqual(recommendations.sessionAligned, true, JSON.stringify({
    marketSessionDate: recommendations.marketSessionDate,
    historySessionDate: recommendations.historySessionDate,
    snapshotMode: recommendations.snapshotMode
  }));
  assert.strictEqual(recommendations.marketSessionDate, recommendations.historySessionDate, JSON.stringify(recommendations));
  assert(['REMOTE_ATOMIC_SNAPSHOT','LOCAL_ATOMIC_SNAPSHOT'].includes(recommendations.snapshotMode), JSON.stringify(recommendations));

  assert.strictEqual(recommendations.market, 'EGX', JSON.stringify(recommendations));
  assert(READY_STATUSES.has(recommendations.status), JSON.stringify(recommendations));
  assert(Array.isArray(recommendations.recommendations), JSON.stringify(recommendations));
  assert(Array.isArray(recommendations.watchlist), JSON.stringify(recommendations));
  assert(Number(recommendations.count) === recommendations.recommendations.length, JSON.stringify(recommendations));

  const deploymentCommit = recommendations.deploymentCommit;
  assert(deploymentCommit, 'Production did not expose VERCEL_GIT_COMMIT_SHA');
  assert.strictEqual(deploymentCommit, expectedCommit, JSON.stringify({ expectedCommit, deploymentCommit }));

  assert.strictEqual(health.success, true, JSON.stringify(health));
  assert.strictEqual(health.sessionAligned, true, JSON.stringify(health));
  assert.strictEqual(health.marketSessionDate, recommendations.marketSessionDate, JSON.stringify({ health, recommendations }));
  assert.strictEqual(health.historySessionDate, recommendations.historySessionDate, JSON.stringify({ health, recommendations }));
  assert(['REMOTE_ATOMIC_SNAPSHOT','LOCAL_ATOMIC_SNAPSHOT'].includes(health.snapshotMode), JSON.stringify(health));
  assert.strictEqual(health.market, 'EGX', JSON.stringify(health));
  assert(READY_STATUSES.has(health.engineStatus), JSON.stringify(health));
  assert.strictEqual(system.success, true, JSON.stringify(system));
  assert.strictEqual(system.system, 'ASTRA_V4', JSON.stringify(system));
  assert.strictEqual(system.healthy, true, JSON.stringify(system));
  assert.strictEqual(ucp.deploymentCommit, expectedCommit, JSON.stringify(ucp));
  assertUcpShadowContract(ucp);

  assert.strictEqual(unified.success, true, JSON.stringify(unified));
  assert.strictEqual(unified.schemaVersion, 'rasheed-egx-unified-opportunity-board/v1', JSON.stringify(unified));
  assert.strictEqual(unified.deploymentCommit, expectedCommit, JSON.stringify(unified));
  assert.strictEqual(unified.executionAllowed, false, JSON.stringify(unified));
  assert.strictEqual(unified.sessionDate, ucp.snapshot?.sessionDate, JSON.stringify({ unified, ucpSession: ucp.snapshot?.sessionDate }));
  assert(Array.isArray(unified.rows), JSON.stringify(unified));
  assert(unified.rows.length >= 100, 'Unified board must expose broad current-session market coverage');
  assert.strictEqual(unified.confidencePolicy?.usedInUnifiedScore, false, JSON.stringify(unified.confidencePolicy));
  assert.strictEqual(Number(unified.weights?.technical), 0.20, JSON.stringify(unified.weights));
  assert.strictEqual(Number(unified.weights?.research), 0.25, JSON.stringify(unified.weights));
  assert.strictEqual(Number(unified.weights?.structuralRR), 0.15, JSON.stringify(unified.weights));
  assert.strictEqual(Number(unified.weights?.riskSafety), 0.15, JSON.stringify(unified.weights));
  assert.strictEqual(unified.metaLabelPolicy?.status, 'NOT_CALIBRATED', JSON.stringify(unified.metaLabelPolicy));
  assert.strictEqual(unified.metaLabelPolicy?.probabilityTarget1Pct, null, JSON.stringify(unified.metaLabelPolicy));
  assert.strictEqual(unified.metaLabelPolicy?.expectedValuePct, null, JSON.stringify(unified.metaLabelPolicy));
  assert.strictEqual(unified.marketRegime?.affectsHardGatesAutomatically, false, JSON.stringify(unified.marketRegime));

  for (let index = 0; index < unified.rows.length; index += 1) {
    const item = unified.rows[index];
    assert.strictEqual(item.executionAllowed, false, JSON.stringify(item));
    assert.strictEqual(item.unifiedRank, index + 1, JSON.stringify(item));
    assert(Number(item.unifiedScore) >= 0 && Number(item.unifiedScore) <= 100, JSON.stringify(item));
    assert(Number(item.scoreCoveragePct) >= 0 && Number(item.scoreCoveragePct) <= 100, JSON.stringify(item));
    assert.strictEqual(item.confidence?.usedInUnifiedScore, false, JSON.stringify(item));
    assert(Number(item.crossSectionalScore) >= 0 && Number(item.crossSectionalScore) <= 100, JSON.stringify(item));
    assert(Number(item.crossSectionalRank) >= 1, JSON.stringify(item));
    assert(item.metaLabel && typeof item.metaLabel === 'object', JSON.stringify(item));
    assert.strictEqual(item.metaLabel.usedForSelection, false, JSON.stringify(item));
    assert.strictEqual(item.metaLabel.executionAllowed, false, JSON.stringify(item));
    if (index > 0) {
      assert(Number(unified.rows[index - 1].unifiedScore) >= Number(item.unifiedScore), 'Unified rows must remain score-sorted');
    }
  }

  const binv = unified.rows.find((item) => item.ticker === 'BINV');
  if (ucp.diagnostics?.rc2?.challenger?.candidateCount > 0) {
    assert(binv, JSON.stringify(unified.rows.slice(0, 20)));
    assert.strictEqual(binv.source, 'RR68_CHALLENGER', JSON.stringify(binv));
    assert.strictEqual(binv.selectedByUcp, true, JSON.stringify(binv));
    assert(Number(binv.researchScore) >= 72, JSON.stringify(binv));
    assert(Number(binv.structuralNetRR) >= 0.68, JSON.stringify(binv));
    assert.strictEqual(binv.morningStatus, 'PREPARED', JSON.stringify(binv));
  }

  assert(recommendations.recommendations.every((item) => item.signal === 'BUY'), JSON.stringify(recommendations));
  assert(recommendations.watchlist.every((item) => item.signal === 'WATCH'), JSON.stringify(recommendations));

  for (const item of recommendations.recommendations) {
    assert.strictEqual(item.entryOpportunity, true, JSON.stringify(item));
    assert(item.stopLoss < item.entry, JSON.stringify(item));
    assert(item.entry < item.target1, JSON.stringify(item));
    assert(item.target1 < item.target2, JSON.stringify(item));
    assert(item.target2 < item.target3, JSON.stringify(item));
    if (item.executionReady === true) {
      assert.strictEqual(recommendations.status, 'LIVE_READY', JSON.stringify(item));
      assert.strictEqual(item.morningGate?.confirmed, true, JSON.stringify(item));
      assert.strictEqual(item.priceMatched, true, JSON.stringify(item));
      assert.strictEqual(item.dataFreshness?.status, 'FRESH', JSON.stringify(item));
      assert.strictEqual(item.executionMode, 'PAPER_ONLY', JSON.stringify(item));
    }
  }

  assertNonExecutableWhenNotFresh(recommendations, 'Recommendations API');
  assertNonExecutableWhenNotFresh({ status: health.engineStatus, executionReadyCount: health.executionReadyCount }, 'Data-health API');

  if (recommendations.status === 'DELAYED_READY') {
    assert.strictEqual(health.liveFeed, 'DELAYED_CURRENT_SESSION', JSON.stringify(health));
  }

  console.log(JSON.stringify({
    productionUrl: baseUrl,
    status: recommendations.status,
    mode: recommendations.mode,
    dataSource: recommendations.dataSource,
    marketSessionDate: recommendations.marketSessionDate,
    historySessionDate: recommendations.historySessionDate,
    sessionAligned: recommendations.sessionAligned,
    snapshotMode: recommendations.snapshotMode,
    entryCandidates: recommendations.count,
    morningConfirmedCount: recommendations.morningConfirmedCount,
    executionReadyCount: recommendations.executionReadyCount,
    ucpStatus: ucp.status,
    ucpSession: ucp.snapshot?.sessionDate,
    ucpDataGatePass: ucp.snapshot?.dataGate?.pass,
    ucpRc2Available: ucp.diagnostics?.rc2?.available,
    ucpRc2Session: ucp.diagnostics?.rc2?.sessionDate,
    ucpRc2SessionAligned: ucp.diagnostics?.rc2?.sessionAligned,
    ucpRc2Candidates: ucp.snapshot?.alpha?.candidates?.length || 0,
    unifiedRows: unified.rows?.length || 0,
    unifiedTop: unified.rows?.slice(0, 5).map((item) => ({
      rank: item.unifiedRank,
      ticker: item.ticker,
      score: item.unifiedScore,
      source: item.source
    })),
    ucpRr68Published: ucp.diagnostics?.rc2?.challenger?.published,
    ucpRr68Available: ucp.diagnostics?.rc2?.challenger?.available,
    ucpRr68Candidates: ucp.diagnostics?.rc2?.challenger?.candidateCount || 0,
    ucpV17Available: ucp.diagnostics?.v17?.available,
    ucpV17SourceCurrent: ucp.diagnostics?.v17?.sourceCurrent,
    ucpV17SessionAligned: ucp.diagnostics?.v17?.sessionAligned,
    ucpV17ReferenceSession: ucp.diagnostics?.v17?.referenceSession,
    ucpV24Status: ucp.diagnostics?.v24?.status,
    ucpV24TargetSession: ucp.diagnostics?.v24?.targetSessionDate,
    ucpV24Prepared: ucp.diagnostics?.v24?.preparedCount,
    ucpV24EvidenceComplete: ucp.diagnostics?.v24?.evidenceComplete,
    ucpMetaLabelStatus: ucp.diagnostics?.v24?.metaLabel?.modelStatus,
    ucpMetaLabelCalibrated: ucp.diagnostics?.v24?.metaLabel?.calibrated,
    ucpForwardSessions: ucp.diagnostics?.forward?.summary?.forwardSessions,
    ucpForwardResolvedTrades: ucp.diagnostics?.forward?.summary?.resolvedTrades,
    ucpPromotionEligible: ucp.diagnostics?.forward?.promotion?.eligible,
    deploymentCommit
  }, null, 2));
}

main().catch((error) => {
  console.error('ASTRA production entry contract validation failed');
  console.error(error?.stack || error);
  process.exit(1);
});
