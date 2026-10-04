'use strict';

const assert = require('assert');
const {
  FORWARD_POLICY,
  summarizeForwardLedger,
  evaluatePromotionEligibility
} = require('../engine/ucp/forward-governance');
const {
  resolveCandidate,
  finalizeLedger
} = require('./ucp-forward-ledger');
const {
  buildDecisionSnapshot,
  evaluateDataQuality
} = require('../engine/ucp');

function isoDay(offsetDays) {
  const date = new Date('2026-01-01T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function strongForwardLedger() {
  const entries = [];
  for (let i = 0; i < 30; i += 1) {
    const win = i < 20;
    const date = isoDay(i * 4);
    entries.push({
      sessionDate: date,
      targetSessionDate: date,
      capturedAt: `${date}T16:00:00Z`,
      criticalBreaches: [],
      outcomes: [{
        ticker: `T${i}`,
        outcome: win ? 'TARGET1' : 'STOP',
        netReturnPct: win ? 2 : -1,
        exitSession: date,
        resolvedAt: `${date}T17:00:00Z`
      }]
    });
  }
  return { entries };
}

function decisionInput(generatedAt, forwardValidation) {
  const gate = evaluateDataQuality({
    expectedUniverseSize: 212,
    acceptedRows: 199,
    verifiedRows: 202,
    sourceReady: true,
    currentSessionReady: true,
    executionGrade: true,
    criticalErrors: []
  });
  return {
    generatedAt,
    sessionDate: '2026-10-01',
    dataGate: gate,
    alpha: {
      engineId: 'TFE_V20_FUSION_RC2',
      status: 'SHADOW_READY',
      candidates: [{ ticker: 'COPR', entry: 10, stopLoss: 9, target1: 11 }]
    },
    governance: {
      status: 'GOVERNANCE_BLOCKED',
      requiredSession: '2026-10-01',
      referenceSession: '2026-09-13',
      sessionAligned: false,
      policySafe: true,
      approvedSymbols: [],
      rejectedSymbols: [{ symbol: 'COPR', reason: 'V17_SESSION_MISMATCH' }]
    },
    morningConfirmation: {
      engineId: 'V2_4_MORNING_CONFIRMATION',
      status: 'WAITING_NEXT_SESSION',
      preparedFromSession: '2026-10-01',
      targetSessionDate: '2026-10-04',
      preparedCandidates: [{ ticker: 'COPR', lifecycleState: 'PREPARED', executionAllowed: false }],
      waitingSymbols: ['COPR']
    },
    forwardValidation,
    decision: {
      status: 'RESEARCH_ONLY',
      finalRecommendations: [],
      watchlist: ['COPR'],
      blockers: ['FORWARD_VALIDATION_REQUIRED', 'V17_SESSION_ALIGNMENT_REQUIRED', 'V2_4_MORNING_CONFIRMATION_PENDING']
    },
    provenance: {
      sourceCommit: 'rc2-test',
      sourceSession: '2026-10-01',
      notes: ['stable-decision-test']
    }
  };
}

function main() {
  const emptySummary = summarizeForwardLedger({ entries: [] });
  const emptyPromotion = evaluatePromotionEligibility(emptySummary);
  assert.strictEqual(emptySummary.forwardSessions, 0);
  assert.strictEqual(emptyPromotion.eligible, false);
  assert.strictEqual(emptyPromotion.automaticPromotionAllowed, false);
  assert.strictEqual(emptyPromotion.executionAllowed, false);
  assert.ok(emptyPromotion.blockers.includes('MIN_FORWARD_SESSIONS_NOT_MET'));
  assert.ok(emptyPromotion.blockers.includes('MIN_RESOLVED_TRADES_NOT_MET'));
  assert.ok(emptyPromotion.blockers.includes('MIN_CALENDAR_DAYS_NOT_MET'));

  const strong = strongForwardLedger();
  const strongSummary = summarizeForwardLedger(strong);
  const strongPromotion = evaluatePromotionEligibility(strongSummary);
  assert.strictEqual(strongSummary.forwardSessions, 30);
  assert.strictEqual(strongSummary.resolvedTrades, 30);
  assert.strictEqual(strongSummary.wins, 20);
  assert.strictEqual(strongSummary.losses, 10);
  assert(strongSummary.observedCalendarDays >= 90);
  assert.strictEqual(strongSummary.averageNetReturnPct, 1);
  assert.strictEqual(strongSummary.profitFactor, 4);
  assert.strictEqual(strongPromotion.eligible, true);
  assert.strictEqual(strongPromotion.status, 'MANUAL_CHAMPION_REVIEW_REQUIRED');
  assert.strictEqual(strongPromotion.automaticPromotionAllowed, false);
  assert.strictEqual(strongPromotion.executionAllowed, false);
  assert.deepStrictEqual(strongPromotion.blockers, []);

  const breached = strongForwardLedger();
  breached.entries[0].criticalBreaches = ['EXECUTION_PERMISSION_BREACH'];
  const breachedPromotion = evaluatePromotionEligibility(summarizeForwardLedger(breached));
  assert.strictEqual(breachedPromotion.eligible, false);
  assert.ok(breachedPromotion.blockers.includes('CRITICAL_GOVERNANCE_BREACH_PRESENT'));

  const tradeEntry = { targetSessionDate: '2026-10-04' };
  const candidate = { ticker: 'TEST', entry: 10, stopLoss: 9, target1: 11 };

  const sameBar = resolveCandidate(tradeEntry, candidate, [{
    date: '2026-10-04', open: 10, high: 11.5, low: 8.5, close: 10.5
  }]);
  assert.strictEqual(sameBar.outcome, 'STOP');
  assert.strictEqual(sameBar.sameBarAmbiguity, 'STOP_FIRST');
  assert.strictEqual(sameBar.netReturnPct, -10.6);

  const targetHit = resolveCandidate(tradeEntry, candidate, [{
    date: '2026-10-04', open: 10, high: 11.2, low: 9.5, close: 10.9
  }]);
  assert.strictEqual(targetHit.outcome, 'TARGET1');
  assert.strictEqual(targetHit.netReturnPct, 9.4);

  const noEntry = resolveCandidate(tradeEntry, candidate, [
    { date: '2026-10-04', open: 9.2, high: 9.5, low: 9.0, close: 9.3 },
    { date: '2026-10-05', open: 9.1, high: 9.4, low: 8.9, close: 9.2 },
    { date: '2026-10-06', open: 9.0, high: 9.3, low: 8.8, close: 9.1 }
  ]);
  assert.strictEqual(noEntry.outcome, 'NOT_ENTERED');
  assert.strictEqual(noEntry.entered, false);

  const holdRows = Array.from({ length: FORWARD_POLICY.maxHoldSessions }, (_, index) => ({
    date: `2026-10-${String(4 + index).padStart(2, '0')}`,
    open: 10,
    high: 10.5,
    low: 9.5,
    close: 10.2
  }));
  const timeExit = resolveCandidate(tradeEntry, candidate, holdRows);
  assert.strictEqual(timeExit.outcome, 'TIME_EXIT');
  assert.strictEqual(timeExit.netReturnPct, 1.4);

  const finalized = finalizeLedger({
    schemaVersion: 'rasheed-egx-ucp-forward-ledger/v1',
    entries: strongForwardLedger().entries
  });
  assert.strictEqual(finalized.promotion.eligible, true);
  assert.strictEqual(finalized.promotion.automaticPromotionAllowed, false);
  assert.strictEqual(finalized.promotion.executionAllowed, false);

  const snapshotA = buildDecisionSnapshot(decisionInput(
    '2026-10-02T00:00:00.000Z',
    {
      status: 'FORWARD_VALIDATION_REQUIRED',
      ledgerAvailable: true,
      ledgerUpdatedAt: null,
      promotionEligible: false,
      metrics: emptySummary,
      blockers: emptyPromotion.blockers
    }
  ));
  const snapshotB = buildDecisionSnapshot(decisionInput(
    '2026-10-02T01:30:00.000Z',
    {
      status: 'MANUAL_CHAMPION_REVIEW_REQUIRED',
      ledgerAvailable: true,
      ledgerUpdatedAt: '2026-10-02T01:00:00.000Z',
      promotionEligible: true,
      metrics: strongSummary,
      blockers: []
    }
  ));
  assert.strictEqual(snapshotA.decisionHash, snapshotB.decisionHash);
  assert.notStrictEqual(snapshotA.generatedAt, snapshotB.generatedAt);
  assert.notDeepStrictEqual(snapshotA.forwardValidation.metrics, snapshotB.forwardValidation.metrics);
  assert.strictEqual(snapshotB.forwardValidation.automaticPromotionAllowed, false);
  assert.strictEqual(snapshotB.forwardValidation.executionAllowed, false);

  console.log('Rasheed EGX UCP forward validation passed');
}

main();
