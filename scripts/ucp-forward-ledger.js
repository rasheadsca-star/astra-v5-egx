'use strict';

const fs = require('fs');
const path = require('path');
const {
  FORWARD_POLICY,
  summarizeForwardLedger,
  evaluatePromotionEligibility
} = require('../engine/ucp/forward-governance');

const LEDGER_PATH = path.join(process.cwd(), 'data', 'ucp', 'forward-ledger.json');
const PROD_URL = process.env.UCP_PROD_URL || 'https://ras-egx-astra-v4.vercel.app';
const EXPECTED_COMMIT = process.env.UCP_EXPECTED_COMMIT || null;
const HISTORY_BASE = process.env.UCP_HISTORY_BASE ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/history';
const FETCH_TIMEOUT_MS = Number(process.env.UCP_FORWARD_FETCH_TIMEOUT_MS || 20000);
const PROD_RETRY_ATTEMPTS = Number(process.env.UCP_PROD_RETRY_ATTEMPTS || 12);
const PROD_RETRY_DELAY_MS = Number(process.env.UCP_PROD_RETRY_DELAY_MS || 10000);

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return null;
  const power = 10 ** digits;
  return Math.round(Number(value) * power) / power;
}

function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Rasheed-EGX-UCP-Forward-Ledger/1.1'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}:${url}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function waitForProductionSnapshot() {
  let lastError = null;
  for (let attempt = 1; attempt <= PROD_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const ucp = await fetchJson(
        `${PROD_URL.replace(/\/$/, '')}/api/ucp-shadow?forwardCapture=${Date.now()}&attempt=${attempt}`
      );
      if (!EXPECTED_COMMIT || ucp?.deploymentCommit === EXPECTED_COMMIT) return ucp;
      lastError = new Error(
        `PRODUCTION_COMMIT_MISMATCH expected=${EXPECTED_COMMIT} actual=${ucp?.deploymentCommit || 'missing'}`
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < PROD_RETRY_ATTEMPTS) await sleep(PROD_RETRY_DELAY_MS);
  }
  throw lastError || new Error('PRODUCTION_SNAPSHOT_NOT_READY');
}

function readLedger() {
  return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
}

function safeCandidate(candidate = {}) {
  return {
    ticker: candidate.ticker || candidate.symbol || null,
    publicationState: candidate.publicationState || candidate.decision || null,
    researchScore: round(candidate.researchScore),
    fusionRankScore: round(candidate.fusionRankScore),
    liquidityScore: round(candidate.liquidityScore),
    srScore: round(candidate.srScore),
    structuralNetRR: round(candidate.structuralNetRR),
    entry: round(candidate.entry, 6),
    stopLoss: round(candidate.stopLoss, 6),
    target1: round(candidate.target1, 6),
    target2: round(candidate.target2, 6)
  };
}

function assertSafeSnapshot(ucp) {
  if (ucp?.success !== true) throw new Error('UCP_SNAPSHOT_NOT_SUCCESSFUL');
  if (ucp?.executionAllowed !== false) throw new Error('UCP_EXECUTION_PERMISSION_BREACH');
  if (ucp?.recommendationMutationAllowed !== false) throw new Error('UCP_RECOMMENDATION_MUTATION_BREACH');
  if (ucp?.snapshot?.executionAllowed !== false) throw new Error('UCP_SNAPSHOT_EXECUTION_PERMISSION_BREACH');
  if (ucp?.snapshot?.engines?.alphaChampionCandidate?.id !== 'TFE_V20_FUSION_RC2') {
    throw new Error('UCP_ALPHA_ENGINE_MISMATCH');
  }
}

async function capture(ledger) {
  const ucp = await waitForProductionSnapshot();
  assertSafeSnapshot(ucp);

  const snapshot = ucp.snapshot;
  const decisionHash = snapshot.decisionHash;
  if (!decisionHash || !snapshot.sessionDate) throw new Error('UCP_DECISION_IDENTITY_MISSING');

  const frozenSession = ledger.entries.find((entry) => entry.sessionDate === snapshot.sessionDate);
  if (frozenSession) {
    return {
      changed: false,
      reason: frozenSession.decisionHash === decisionHash
        ? 'NOOP_SESSION_ALREADY_CAPTURED'
        : 'NOOP_SESSION_ALREADY_FROZEN_HASH_CHANGED',
      decisionHash,
      frozenDecisionHash: frozenSession.decisionHash,
      sessionDate: snapshot.sessionDate
    };
  }

  const candidates = (snapshot.alpha?.candidates || []).map(safeCandidate).filter((item) => item.ticker);
  const entry = {
    recordId: `${snapshot.sessionDate}:${decisionHash.slice(0, 16)}`,
    capturedAt: new Date().toISOString(),
    source: 'UCP_PRODUCTION_SHADOW',
    sessionDate: snapshot.sessionDate,
    targetSessionDate: snapshot.morningConfirmation?.targetSessionDate || null,
    decisionHash,
    deploymentCommit: ucp.deploymentCommit || null,
    alphaEngine: snapshot.alpha?.engineId || 'TFE_V20_FUSION_RC2',
    alphaStatus: snapshot.alpha?.status || null,
    governance: {
      status: snapshot.governance?.status || null,
      referenceSession: snapshot.governance?.referenceSession || null,
      sessionAligned: snapshot.governance?.sessionAligned === true,
      policySafe: snapshot.governance?.policySafe === true
    },
    morning: {
      status: snapshot.morningConfirmation?.status || null,
      evidenceComplete: snapshot.morningConfirmation?.evidenceComplete === true
    },
    blockers: Array.isArray(snapshot.decision?.blockers) ? [...snapshot.decision.blockers] : [],
    candidates,
    outcomes: candidates.map((candidate) => ({
      ticker: candidate.ticker,
      outcome: 'OPEN',
      entered: false,
      entrySession: null,
      exitSession: null,
      entryPrice: candidate.entry,
      exitPrice: null,
      netReturnPct: null,
      resolvedAt: null,
      sourceLastSession: null
    })),
    criticalBreaches: []
  };

  ledger.entries.push(entry);
  return {
    changed: true,
    reason: 'CAPTURED',
    decisionHash,
    sessionDate: snapshot.sessionDate,
    candidateCount: candidates.length,
    deploymentCommit: ucp.deploymentCommit || null
  };
}

function historyRows(payload = {}) {
  return (Array.isArray(payload.sessions) ? payload.sessions : Array.isArray(payload.rows) ? payload.rows : [])
    .filter((row) => row && dateOnly(row.date) && Number(row.high) > 0 && Number(row.low) > 0 && Number(row.close) > 0)
    .map((row) => ({
      date: dateOnly(row.date),
      open: Number(row.open || row.close),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function netReturn(entryPrice, exitPrice) {
  if (!(entryPrice > 0) || !(exitPrice > 0)) return null;
  return round(((exitPrice - entryPrice) / entryPrice) * 100 - FORWARD_POLICY.roundTripCostPct, 4);
}

function resolveCandidate(entry, candidate, rows, previous = {}) {
  const ticker = candidate.ticker;
  const targetSession = dateOnly(entry.targetSessionDate);
  const entryPrice = Number(candidate.entry);
  const stop = Number(candidate.stopLoss);
  const target1 = Number(candidate.target1);
  const sourceLastSession = rows.at(-1)?.date || null;

  if (!targetSession || !(entryPrice > 0) || !(stop > 0) || !(target1 > entryPrice) || !(stop < entryPrice)) {
    return {
      ...previous,
      ticker,
      outcome: 'UNRESOLVABLE',
      entered: false,
      entryPrice: Number.isFinite(entryPrice) ? entryPrice : null,
      sourceLastSession,
      resolutionReason: 'TRADE_PLAN_INCOMPLETE'
    };
  }

  const future = rows.filter((row) => row.date >= targetSession);
  if (!future.length) return { ...previous, ticker, outcome: 'OPEN', entered: false, entryPrice, sourceLastSession };

  const entryWindow = future.slice(0, FORWARD_POLICY.entryExpirySessions);
  const entryIndexInWindow = entryWindow.findIndex((row) => row.low <= entryPrice && row.high >= entryPrice);

  if (entryIndexInWindow < 0) {
    if (future.length >= FORWARD_POLICY.entryExpirySessions) {
      return {
        ...previous,
        ticker,
        outcome: 'NOT_ENTERED',
        entered: false,
        entrySession: null,
        exitSession: entryWindow.at(-1)?.date || null,
        entryPrice,
        exitPrice: null,
        netReturnPct: 0,
        resolvedAt: new Date().toISOString(),
        sourceLastSession
      };
    }
    return { ...previous, ticker, outcome: 'OPEN', entered: false, entryPrice, sourceLastSession };
  }

  const entryRow = entryWindow[entryIndexInWindow];
  const absoluteEntryIndex = future.findIndex((row) => row.date === entryRow.date);
  const holdRows = future.slice(absoluteEntryIndex, absoluteEntryIndex + FORWARD_POLICY.maxHoldSessions);

  for (const row of holdRows) {
    const stopHit = row.low <= stop;
    const targetHit = row.high >= target1;
    if (stopHit) {
      return {
        ticker,
        outcome: 'STOP',
        entered: true,
        entrySession: entryRow.date,
        exitSession: row.date,
        entryPrice,
        exitPrice: stop,
        netReturnPct: netReturn(entryPrice, stop),
        resolvedAt: new Date().toISOString(),
        sourceLastSession,
        sameBarAmbiguity: targetHit ? 'STOP_FIRST' : null
      };
    }
    if (targetHit) {
      return {
        ticker,
        outcome: 'TARGET1',
        entered: true,
        entrySession: entryRow.date,
        exitSession: row.date,
        entryPrice,
        exitPrice: target1,
        netReturnPct: netReturn(entryPrice, target1),
        resolvedAt: new Date().toISOString(),
        sourceLastSession,
        sameBarAmbiguity: null
      };
    }
  }

  if (holdRows.length >= FORWARD_POLICY.maxHoldSessions) {
    const exit = holdRows[FORWARD_POLICY.maxHoldSessions - 1];
    return {
      ticker,
      outcome: 'TIME_EXIT',
      entered: true,
      entrySession: entryRow.date,
      exitSession: exit.date,
      entryPrice,
      exitPrice: exit.close,
      netReturnPct: netReturn(entryPrice, exit.close),
      resolvedAt: new Date().toISOString(),
      sourceLastSession,
      sameBarAmbiguity: null
    };
  }

  return { ...previous, ticker, outcome: 'OPEN', entered: true, entrySession: entryRow.date, entryPrice, sourceLastSession };
}

async function resolve(ledger) {
  let changed = false;
  const cache = new Map();

  for (const entry of ledger.entries || []) {
    if (!Array.isArray(entry.candidates) || !entry.candidates.length) continue;
    if (!Array.isArray(entry.outcomes)) entry.outcomes = [];

    for (const candidate of entry.candidates) {
      const ticker = candidate.ticker;
      if (!ticker) continue;
      const previous = entry.outcomes.find((item) => item.ticker === ticker) || {};
      if (['TARGET1', 'STOP', 'TIME_EXIT', 'NOT_ENTERED', 'UNRESOLVABLE'].includes(previous.outcome)) continue;

      if (!cache.has(ticker)) {
        try {
          const payload = await fetchJson(`${HISTORY_BASE.replace(/\/$/, '')}/${encodeURIComponent(ticker)}.json?ucp=${Date.now()}`);
          cache.set(ticker, historyRows(payload));
        } catch (error) {
          cache.set(ticker, null);
          console.warn(`UCP history unavailable for ${ticker}: ${error.message}`);
        }
      }

      const rows = cache.get(ticker);
      if (!rows) continue;
      const next = resolveCandidate(entry, candidate, rows, previous);
      const index = entry.outcomes.findIndex((item) => item.ticker === ticker);
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        if (index >= 0) entry.outcomes[index] = next;
        else entry.outcomes.push(next);
        changed = true;
      }
    }
  }

  return { changed };
}

function finalizeLedger(ledger) {
  const summary = summarizeForwardLedger(ledger);
  const promotion = evaluatePromotionEligibility(summary);
  ledger.schemaVersion = 'rasheed-egx-ucp-forward-ledger/v1';
  ledger.policyVersion = FORWARD_POLICY.version;
  ledger.updatedAt = new Date().toISOString();
  ledger.summary = summary;
  ledger.promotion = promotion;
  return ledger;
}

function writeLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
}

async function main() {
  const mode = process.argv[2] || 'cycle';
  const ledger = readLedger();
  let changed = false;
  const result = {};

  if (mode === 'capture' || mode === 'cycle') {
    result.capture = await capture(ledger);
    changed = changed || result.capture.changed;
  }
  if (mode === 'resolve' || mode === 'cycle') {
    result.resolve = await resolve(ledger);
    changed = changed || result.resolve.changed;
  }

  const before = JSON.stringify({ summary: ledger.summary, promotion: ledger.promotion });
  finalizeLedger(ledger);
  const after = JSON.stringify({ summary: ledger.summary, promotion: ledger.promotion });
  changed = changed || before !== after;

  if (changed) writeLedger(ledger);

  console.log(JSON.stringify({
    mode,
    expectedCommit: EXPECTED_COMMIT,
    changed,
    entries: ledger.entries.length,
    summary: ledger.summary,
    promotion: ledger.promotion,
    result
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}

module.exports = {
  safeCandidate,
  historyRows,
  netReturn,
  resolveCandidate,
  finalizeLedger,
  waitForProductionSnapshot
};
