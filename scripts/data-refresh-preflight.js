'use strict';

const fs = require('fs');
const path = require('path');

const BASE =
  process.env.ASTRA_CANONICAL_SOURCE_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data';

const TIMEOUT_MS = 12000;
const MIN_CURRENT_SESSION_ROWS = 80;

async function fetchJson(relativePath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}/${relativePath}?preflight=${Date.now()}`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'ASTRA-V4-ATOMIC-PREFLIGHT/1.0'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}:${relativePath}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function readLocal() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'data', 'canonical-market.json'), 'utf8')
    );
  } catch {
    return {};
  }
}

function time(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxTime(...values) {
  return Math.max(...values.map(time), 0);
}

function bool(value) {
  return value === true;
}

async function evaluate() {
  const [fetchStatus, price, primary, regime, v17, rc2] = await Promise.all([
    fetchJson('fetch-status.json'),
    fetchJson('stable/v15-price-truth.json'),
    fetchJson('stable/v16-v169-primary-decision.json'),
    fetchJson('stable/v16-market-regime.json'),
    fetchJson('v17/ucp-current-session.json'),
    fetchJson('rc2/current-session.json')
  ]);

  const local = readLocal();
  const expected =
    fetchStatus?.expectedSession ||
    price?.expectedSession ||
    primary?.sessionDate ||
    null;

  const regimeSession = regime?.metrics?.sessionDate || regime?.sessionDate || null;
  const sourceFingerprint =
    primary?.basketPlan?.sourceSessionDataHash ||
    primary?.sourceSessionDataHash ||
    null;

  const v17FingerprintCurrent = Boolean(sourceFingerprint && v17?.sourceSessionDataHash === sourceFingerprint);
  const rc2FingerprintCurrent = Boolean(sourceFingerprint && rc2?.sourceSessionDataHash === sourceFingerprint);

  const v17RequiredFreshAt = maxTime(
    primary?.generatedAt,
    regime?.generatedAt,
    price?.generatedAt
  );
  const rc2RequiredFreshAt = maxTime(
    fetchStatus?.generatedAt,
    price?.generatedAt,
    primary?.generatedAt
  );

  const sourceReady = Boolean(
    expected &&
    fetchStatus?.expectedSession === expected &&
    bool(fetchStatus?.executionGrade) &&
    Number(fetchStatus?.currentSessionRows || 0) >= MIN_CURRENT_SESSION_ROWS &&
    price?.expectedSession === expected &&
    bool(price?.executionGrade) &&
    primary?.sessionDate === expected &&
    primary?.selectedModel?.id === 'V16_9_EQUAL_WEIGHT_BASKET' &&
    regimeSession === expected &&
    v17?.sessionDate === expected &&
    v17?.systemHealth?.sessionAligned === true &&
    (sourceFingerprint ? v17FingerprintCurrent : time(v17?.generatedAt) >= v17RequiredFreshAt) &&
    rc2?.sessionDate === expected &&
    rc2?.sessionAligned === true &&
    (sourceFingerprint ? rc2FingerprintCurrent : time(rc2?.generatedAt) >= rc2RequiredFreshAt)
  );

  const localSession = local?.source?.expectedSession || null;
  const localFingerprint = local?.source?.sourceSessionDataHash || null;
  const localFetchGeneratedAt = local?.source?.fetchStatusGeneratedAt || null;

  const materialChanged = sourceFingerprint
    ? sourceFingerprint !== localFingerprint
    : String(fetchStatus?.generatedAt || '') !== String(localFetchGeneratedAt || '');

  const refreshNeeded = Boolean(
    sourceReady &&
    (
      localSession !== expected ||
      local?.source?.executionGrade !== true ||
      materialChanged
    )
  );

  const blockers = [];
  if (!expected) blockers.push('EXPECTED_SESSION_MISSING');
  if (fetchStatus?.expectedSession !== expected) blockers.push('FETCH_SESSION_MISMATCH');
  if (fetchStatus?.executionGrade !== true) blockers.push('FETCH_NOT_EXECUTION_GRADE');
  if (Number(fetchStatus?.currentSessionRows || 0) < MIN_CURRENT_SESSION_ROWS) blockers.push('FETCH_CURRENT_SESSION_COVERAGE_LOW');
  if (price?.expectedSession !== expected || price?.executionGrade !== true) blockers.push('PRICE_TRUTH_NOT_READY');
  if (primary?.sessionDate !== expected || primary?.selectedModel?.id !== 'V16_9_EQUAL_WEIGHT_BASKET') blockers.push('V169_PRIMARY_NOT_READY');
  if (regimeSession !== expected) blockers.push('REGIME_SESSION_MISMATCH');
  if (v17?.sessionDate !== expected || v17?.systemHealth?.sessionAligned !== true) blockers.push('V17_SESSION_NOT_ALIGNED');
  if (sourceFingerprint ? !v17FingerprintCurrent : time(v17?.generatedAt) < v17RequiredFreshAt) blockers.push('V17_STALE_WITHIN_SESSION');
  if (rc2?.sessionDate !== expected || rc2?.sessionAligned !== true) blockers.push('RC2_SESSION_NOT_ALIGNED');
  if (sourceFingerprint ? !rc2FingerprintCurrent : time(rc2?.generatedAt) < rc2RequiredFreshAt) blockers.push('RC2_STALE_WITHIN_SESSION');

  return {
    expectedSession: expected,
    sourceReady,
    refreshNeeded,
    materialChanged,
    sourceFingerprint,
    localSession,
    localFingerprint,
    sourceGeneratedAt: fetchStatus?.generatedAt || null,
    localFetchGeneratedAt,
    currentSessionRows: Number(fetchStatus?.currentSessionRows || 0),
    coveragePct: Number(fetchStatus?.coveragePct || 0),
    v17GeneratedAt: v17?.generatedAt || null,
    rc2GeneratedAt: rc2?.generatedAt || null,
    blockers
  };
}

function writeOutput(result) {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  const lines = [
    `expected_session=${result.expectedSession || ''}`,
    `source_ready=${result.sourceReady ? 'true' : 'false'}`,
    `refresh_needed=${result.refreshNeeded ? 'true' : 'false'}`,
    `material_changed=${result.materialChanged ? 'true' : 'false'}`,
    `source_fingerprint=${result.sourceFingerprint || ''}`,
    `blockers=${result.blockers.join(',')}`
  ];
  fs.appendFileSync(target, lines.join('\n') + '\n');
}

evaluate()
  .then(result => {
    writeOutput(result);
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(error => {
    const result = {
      expectedSession: null,
      sourceReady: false,
      refreshNeeded: false,
      materialChanged: false,
      sourceFingerprint: null,
      blockers: ['PREFLIGHT_SOURCE_UNAVAILABLE'],
      error: error?.message || String(error)
    };
    writeOutput(result);
    console.log(JSON.stringify(result, null, 2));
    // Source outage is non-fatal: ASTRA keeps serving the last validated atomic snapshot.
    process.exit(0);
  });
