'use strict';

const TERMINAL_STATES = new Set(['CONFIRMED', 'REJECTED', 'EXPIRED']);

const POLICY = Object.freeze({
  confirmationStartMinute: 10 * 60 + 20,
  confirmationEndMinute: 10 * 60 + 45,
  confirmationGraceEndMinute: 11 * 60 + 10,
  minimumMarketCoveragePct: 90,
  requireCandidateCoverage: true,
  requireHistoricalVolumeBaseline: true,
  requiredChecks: Object.freeze([
    'openingGapPass',
    'priceAcceptancePass',
    'relativeVolumePass',
    'relativeTurnoverPass',
    'marketBreadthPass'
  ])
});

function dateOnly(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function nextEgxTradingSession(sessionDate, holidays = []) {
  const source = dateOnly(sessionDate);
  if (!source) return null;
  const holidaySet = new Set((holidays || []).map(dateOnly).filter(Boolean));
  const date = new Date(source + 'T12:00:00Z');

  for (let i = 0; i < 14; i += 1) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    const candidate = date.toISOString().slice(0, 10);
    if (day === 5 || day === 6) continue; // Friday / Saturday
    if (holidaySet.has(candidate)) continue;
    return candidate;
  }

  return null;
}

function cairoClock(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    sessionDate: `${map.year}-${map.month}-${map.day}`,
    minuteOfDay: Number(map.hour) * 60 + Number(map.minute)
  };
}

function parseHolidays(value = process.env.UCP_EGX_HOLIDAYS || '') {
  return [...new Set(String(value).split(',').map((item) => dateOnly(item.trim())).filter(Boolean))];
}

function normalizePreparedCandidate(candidate = {}, context = {}) {
  const ticker = candidate.ticker || candidate.symbol || null;
  const preparedFromSession = dateOnly(context.preparedFromSession);
  const targetSessionDate = context.targetSessionDate ||
    nextEgxTradingSession(preparedFromSession, context.holidays || []);

  return Object.freeze({
    ticker,
    rank: Number.isFinite(Number(candidate.rank)) ? Number(candidate.rank) : null,
    candidateSource: candidate.candidateSource || 'TFE_V20_FUSION_RC2',
    challengerResearchOnly: candidate.challengerResearchOnly === true,
    researchScore: Number.isFinite(Number(candidate.researchScore)) ? Number(candidate.researchScore) : null,
    fusionRankScore: Number.isFinite(Number(candidate.fusionRankScore)) ? Number(candidate.fusionRankScore) : null,
    entry: Number.isFinite(Number(candidate.entry)) ? Number(candidate.entry) : null,
    stopLoss: Number.isFinite(Number(candidate.stopLoss)) ? Number(candidate.stopLoss) : null,
    target1: Number.isFinite(Number(candidate.target1)) ? Number(candidate.target1) : null,
    target2: Number.isFinite(Number(candidate.target2)) ? Number(candidate.target2) : null,
    preparedFromSession,
    targetSessionDate,
    lifecycleState: context.dataGatePass === true ? 'PREPARED' : 'WAITING_DATA',
    executionAllowed: false,
    frozenAlpha: Object.freeze({ ...candidate })
  });
}

function prepareCandidates(candidates = [], {
  preparedFromSession = null,
  dataGatePass = false,
  holidays = parseHolidays()
} = {}) {
  const targetSessionDate = nextEgxTradingSession(preparedFromSession, holidays);
  return Object.freeze((candidates || []).map((candidate) => normalizePreparedCandidate(candidate, {
    preparedFromSession,
    targetSessionDate,
    dataGatePass,
    holidays
  })));
}

function evidenceReadiness(evidence = {}, prepared = {}, clock = {}) {
  const reasons = [];
  const sourceSessionDate = dateOnly(evidence.sourceSessionDate || evidence.sessionDate);
  const latestSourceMinute = Number(evidence.latestSourceMinute);
  const marketCoveragePct = Number(evidence.marketCoveragePct);
  const observedMinute = Number(clock.minuteOfDay);

  if (!sourceSessionDate || sourceSessionDate !== prepared.targetSessionDate) {
    reasons.push('MORNING_SESSION_MISMATCH');
  }
  if (!Number.isFinite(latestSourceMinute) || latestSourceMinute < POLICY.confirmationStartMinute) {
    reasons.push('MORNING_SOURCE_TOO_EARLY');
  }
  if (Number.isFinite(latestSourceMinute) && latestSourceMinute > POLICY.confirmationEndMinute) {
    reasons.push('MORNING_SOURCE_TOO_LATE');
  }
  if (Number.isFinite(latestSourceMinute) && Number.isFinite(observedMinute) && latestSourceMinute > observedMinute) {
    reasons.push('MORNING_SOURCE_FROM_FUTURE');
  }
  if (!Number.isFinite(marketCoveragePct) || marketCoveragePct < POLICY.minimumMarketCoveragePct) {
    reasons.push('MORNING_MARKET_COVERAGE_INSUFFICIENT');
  }
  if (POLICY.requireCandidateCoverage && evidence.candidatePresent !== true) {
    reasons.push('MORNING_CANDIDATE_NOT_COVERED');
  }
  if (POLICY.requireHistoricalVolumeBaseline && evidence.volumeBaselineAvailable !== true) {
    reasons.push('MORNING_VOLUME_BASELINE_MISSING');
  }
  for (const check of POLICY.requiredChecks) {
    if (typeof evidence[check] !== 'boolean') reasons.push(`MORNING_${check.toUpperCase()}_MISSING`);
  }

  return Object.freeze({
    ready: reasons.length === 0,
    reasons: Object.freeze(reasons),
    sourceSessionDate,
    latestSourceMinute: Number.isFinite(latestSourceMinute) ? latestSourceMinute : null,
    marketCoveragePct: Number.isFinite(marketCoveragePct) ? marketCoveragePct : null
  });
}

function evaluateCandidate(prepared = {}, evidence = null, {
  now = new Date(),
  previousState = null
} = {}) {
  const clock = cairoClock(now);
  const prior = previousState || prepared.lifecycleState || 'PREPARED';

  if (TERMINAL_STATES.has(prior)) {
    return Object.freeze({ ...prepared, lifecycleState: prior, executionAllowed: false, terminal: true });
  }

  if (!prepared.targetSessionDate) {
    return Object.freeze({ ...prepared, lifecycleState: 'WAITING_DATA', executionAllowed: false, reasons: Object.freeze(['TARGET_SESSION_UNKNOWN']) });
  }

  if (clock.sessionDate < prepared.targetSessionDate) {
    return Object.freeze({ ...prepared, lifecycleState: 'PREPARED', executionAllowed: false, reasons: Object.freeze(['WAITING_FOR_TARGET_SESSION']) });
  }

  if (clock.sessionDate > prepared.targetSessionDate) {
    return Object.freeze({ ...prepared, lifecycleState: 'EXPIRED', executionAllowed: false, terminal: true, reasons: Object.freeze(['TARGET_SESSION_PASSED']) });
  }

  if (clock.minuteOfDay < POLICY.confirmationStartMinute) {
    return Object.freeze({ ...prepared, lifecycleState: 'WAITING_DATA', executionAllowed: false, reasons: Object.freeze(['MORNING_WINDOW_NOT_READY']) });
  }

  const readiness = evidenceReadiness(evidence || {}, prepared, clock);

  if (!readiness.ready) {
    const graceExpired = clock.minuteOfDay > POLICY.confirmationGraceEndMinute;
    return Object.freeze({
      ...prepared,
      lifecycleState: graceExpired ? 'UNCONFIRMED_DATA_GAP' : 'WAITING_DATA',
      executionAllowed: false,
      terminal: false,
      reasons: Object.freeze([
        ...readiness.reasons,
        ...(graceExpired ? ['MORNING_EVIDENCE_UNAVAILABLE_AFTER_GRACE'] : [])
      ]),
      evidenceReadiness: readiness
    });
  }

  const hardReject = evidence.stopBreached === true || evidence.priceAcceptancePass === false || Boolean(evidence.hardRejectReason);
  if (hardReject) {
    return Object.freeze({
      ...prepared,
      lifecycleState: 'REJECTED',
      executionAllowed: false,
      terminal: true,
      reasons: Object.freeze([evidence.hardRejectReason || (evidence.stopBreached ? 'STOP_BREACHED' : 'PRICE_ACCEPTANCE_FAILED')]),
      evidenceReadiness: readiness
    });
  }

  const confirmed = POLICY.requiredChecks.every((check) => evidence[check] === true);
  if (confirmed) {
    return Object.freeze({
      ...prepared,
      lifecycleState: 'CONFIRMED',
      executionAllowed: false,
      terminal: true,
      reasons: Object.freeze([]),
      evidenceReadiness: readiness
    });
  }

  return Object.freeze({
    ...prepared,
    lifecycleState: 'WATCH',
    executionAllowed: false,
    terminal: false,
    reasons: Object.freeze(POLICY.requiredChecks.filter((check) => evidence[check] === false).map((check) => `MORNING_${check.toUpperCase()}_FAILED`)),
    evidenceReadiness: readiness
  });
}

function evaluateMorningBatch(preparedCandidates = [], evidenceByTicker = {}, options = {}) {
  const results = (preparedCandidates || []).map((candidate) => evaluateCandidate(
    candidate,
    evidenceByTicker?.[candidate.ticker] || null,
    options
  ));
  const stateCounts = results.reduce((counts, item) => {
    counts[item.lifecycleState] = (counts[item.lifecycleState] || 0) + 1;
    return counts;
  }, {});

  return Object.freeze({
    engineId: 'V2_4_MORNING_CONFIRMATION',
    status: results.length ? 'EVALUATED' : 'NO_CANDIDATES',
    executionAllowed: false,
    results: Object.freeze(results),
    stateCounts: Object.freeze(stateCounts),
    confirmedSymbols: Object.freeze(results.filter((item) => item.lifecycleState === 'CONFIRMED').map((item) => item.ticker)),
    waitingSymbols: Object.freeze(results.filter((item) => ['PREPARED', 'WAITING_DATA', 'WATCH', 'UNCONFIRMED_DATA_GAP'].includes(item.lifecycleState)).map((item) => item.ticker)),
    rejectedSymbols: Object.freeze(results.filter((item) => item.lifecycleState === 'REJECTED').map((item) => item.ticker)),
    expiredSymbols: Object.freeze(results.filter((item) => item.lifecycleState === 'EXPIRED').map((item) => item.ticker))
  });
}

module.exports = {
  POLICY,
  TERMINAL_STATES,
  dateOnly,
  nextEgxTradingSession,
  cairoClock,
  parseHolidays,
  prepareCandidates,
  evidenceReadiness,
  evaluateCandidate,
  evaluateMorningBatch
};
