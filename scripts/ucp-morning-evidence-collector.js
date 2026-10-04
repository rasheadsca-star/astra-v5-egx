'use strict';

const fs = require('fs');
const path = require('path');

const MARKET_URL = process.env.UCP_MARKET_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/market.json';
const UCP_URL = process.env.UCP_URL || 'https://ras-egx-astra-v4.vercel.app/api/ucp-shadow';
const OUTPUT = path.join(process.cwd(), 'data', 'ucp', 'morning-evidence.json');

const MIN_BASELINE_SESSIONS = Number(process.env.UCP_MORNING_MIN_BASELINE_SESSIONS || 5);
const MAX_RECEIPT_AGE_MINUTES = Number(process.env.UCP_MORNING_MAX_RECEIPT_AGE_MINUTES || 35);
const EXPECTED_FEED_DELAY_MINUTES = Number(process.env.UCP_MORNING_EXPECTED_FEED_DELAY_MINUTES || 15);

const EVIDENCE_START_MINUTE = 10 * 60 + 20; // 10:20 market-data time
const EVIDENCE_END_MINUTE = 10 * 60 + 45;   // 10:45 market-data time
const COLLECTION_START_MINUTE = EVIDENCE_START_MINUTE;
const COLLECTION_END_MINUTE = 11 * 60 + 10; // 11:10 wall-clock grace

function cairoClock(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return {
    sessionDate: `${p.year}-${p.month}-${p.day}`,
    minuteOfDay: Number(p.hour) * 60 + Number(p.minute),
    display: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
  };
}

async function fetchJson(url) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}ucpMorning=${Date.now()}`, {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Rasheed-EGX-UCP-Morning/2.0'
    }
  });
  if (!response.ok) throw new Error(`HTTP_${response.status}:${url}`);
  return response.json();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function ageMinutes(timestamp, now = Date.now()) {
  const time = Date.parse(timestamp || '');
  return Number.isFinite(time) ? (now - time) / 60000 : Infinity;
}

function parseMinuteOfDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();

  const hm = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) {
    const hour = Number(hm[1]);
    const minute = Number(hm[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
  }

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return cairoClock(new Date(parsed)).minuteOfDay;
  return null;
}

function rowTiming(row = {}, now = new Date()) {
  const explicitMarketMinute = parseMinuteOfDay(row.sourceMarketTime);
  const receiptTimestamp = row.updatedAt || row.sourceSessionCheckedAt || row.sourceSessionEvidenceVerifiedAt || null;
  const receiptMinute = receiptTimestamp ? cairoClock(new Date(receiptTimestamp)).minuteOfDay : null;
  const receiptAgeMinutes = ageMinutes(receiptTimestamp, now.getTime());

  if (explicitMarketMinute !== null) {
    return {
      effectiveSourceMinute: explicitMarketMinute,
      receiptMinute,
      receiptAgeMinutes,
      timingMode: 'EXPLICIT_MARKET_TIME',
      inferredDelayMinutes: receiptMinute === null ? null : Math.max(0, receiptMinute - explicitMarketMinute)
    };
  }

  if (receiptMinute !== null) {
    return {
      effectiveSourceMinute: Math.max(0, receiptMinute - EXPECTED_FEED_DELAY_MINUTES),
      receiptMinute,
      receiptAgeMinutes,
      timingMode: 'RECEIPT_MINUS_EXPECTED_DELAY',
      inferredDelayMinutes: EXPECTED_FEED_DELAY_MINUTES
    };
  }

  return {
    effectiveSourceMinute: null,
    receiptMinute: null,
    receiptAgeMinutes: Infinity,
    timingMode: 'TIME_UNAVAILABLE',
    inferredDelayMinutes: null
  };
}

function loadStore() {
  try { return JSON.parse(fs.readFileSync(OUTPUT, 'utf8')); }
  catch {
    return {
      schemaVersion: 'rasheed-egx-ucp-morning-evidence/v2',
      evidenceByTicker: {},
      baselineSessions: []
    };
  }
}

function median(values = []) {
  const valid = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const i = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[i] : (valid[i - 1] + valid[i]) / 2;
}

function candidateRange(candidate = {}) {
  const frozen = candidate.frozenAlpha || candidate;
  const low = num(frozen.entryLow ?? frozen.tradePlan?.entryLow ?? frozen.entry);
  const high = num(frozen.entryHigh ?? frozen.tradePlan?.entryHigh ?? frozen.entry);
  const center = num(frozen.entry);
  return {
    low: low ?? center,
    high: high ?? center,
    stop: num(frozen.stopLoss ?? frozen.tradePlan?.stop),
    target1: num(frozen.target1 ?? frozen.tradePlan?.target1)
  };
}

function buildEvidence({ market, ucp, existing, now = new Date() }) {
  const clock = cairoClock(now);
  const rows = Array.isArray(market?.rows) ? market.rows : [];

  const timedRows = rows
    .filter(row => (row.sourceSessionDate || row.marketSessionDate) === clock.sessionDate)
    .map(row => ({ row, timing: rowTiming(row, now) }))
    .filter(item => item.timing.receiptAgeMinutes <= MAX_RECEIPT_AGE_MINUTES);

  const evidenceRows = timedRows.filter(item =>
    Number.isFinite(item.timing.effectiveSourceMinute) &&
    item.timing.effectiveSourceMinute >= EVIDENCE_START_MINUTE &&
    item.timing.effectiveSourceMinute <= EVIDENCE_END_MINUTE
  );

  const rowMap = new Map(
    evidenceRows.map(({ row, timing }) => [
      String(row.symbol || row.ticker || '').toUpperCase(),
      { row, timing }
    ])
  );

  const expectedUniverse = Number(
    ucp?.snapshot?.dataGate?.metrics?.expectedUniverseSize ||
    rows.length ||
    0
  );

  const marketCoveragePct = expectedUniverse > 0
    ? Number(((evidenceRows.length / expectedUniverse) * 100).toFixed(2))
    : null;

  const effectiveMinutes = evidenceRows
    .map(item => item.timing.effectiveSourceMinute)
    .filter(Number.isFinite);
  const marketEvidenceMinute = median(effectiveMinutes);

  const breadthRows = evidenceRows
    .map(item => item.row)
    .filter(row => num(row.changePct) !== null);

  const advancers = breadthRows.filter(row => num(row.changePct) > 0).length;
  const decliners = breadthRows.filter(row => num(row.changePct) < 0).length;
  const breadthPct = breadthRows.length
    ? Number(((advancers / breadthRows.length) * 100).toFixed(2))
    : null;
  const marketBreadthPass = breadthPct === null ? null : breadthPct >= 45;

  const prepared = Array.isArray(ucp?.snapshot?.morningConfirmation?.preparedCandidates)
    ? ucp.snapshot.morningConfirmation.preparedCandidates
    : [];

  const previousBaselines = Array.isArray(existing?.baselineSessions)
    ? existing.baselineSessions
    : [];
  const priorSessions = previousBaselines.filter(x =>
    x?.sessionDate && x.sessionDate !== clock.sessionDate
  );

  const evidenceByTicker = {};

  for (const candidate of prepared) {
    const ticker = String(candidate.ticker || '').toUpperCase();
    if (!ticker) continue;

    const timed = rowMap.get(ticker);
    const row = timed?.row;
    const timing = timed?.timing;
    const range = candidateRange(candidate);

    const baselines = priorSessions
      .map(session => session?.rows?.[ticker])
      .filter(Boolean);

    const volumeBaseline = median(baselines.map(x => x.volume));
    const turnoverBaseline = median(baselines.map(x => x.turnover));
    const volumeBaselineAvailable =
      baselines.length >= MIN_BASELINE_SESSIONS &&
      volumeBaseline > 0 &&
      turnoverBaseline > 0;

    const price = num(row?.price ?? row?.last);
    const open = num(row?.open);
    const previousClose = num(row?.previousClose);
    const volume = num(row?.volume);
    const turnover = num(row?.valueTraded ?? row?.turnover);

    const gapPct = open !== null && previousClose > 0
      ? ((open - previousClose) / previousClose) * 100
      : null;

    const entryLow = range.low;
    const entryHigh = range.high;
    const tolerance = entryLow !== null && entryHigh !== null
      ? Math.max((entryHigh - entryLow) * 0.5, (entryLow + entryHigh) * 0.005)
      : null;

    const priceAcceptancePass =
      price !== null &&
      entryLow !== null &&
      entryHigh !== null &&
      tolerance !== null
        ? price >= entryLow - tolerance && price <= entryHigh + tolerance
        : null;

    const openingGapPass = gapPct === null ? null : Math.abs(gapPct) <= 5;
    const relativeVolume = volumeBaselineAvailable && volume !== null
      ? volume / volumeBaseline
      : null;
    const relativeTurnover = volumeBaselineAvailable && turnover !== null
      ? turnover / turnoverBaseline
      : null;
    const relativeVolumePass = relativeVolume === null ? null : relativeVolume >= 0.75;
    const relativeTurnoverPass = relativeTurnover === null ? null : relativeTurnover >= 0.75;
    const stopBreached = price !== null && range.stop !== null ? price <= range.stop : false;

    evidenceByTicker[ticker] = {
      sourceSessionDate: clock.sessionDate,
      latestSourceMinute: timing?.effectiveSourceMinute ?? null,
      receiptMinute: timing?.receiptMinute ?? null,
      sourceDelayMinutes: timing?.inferredDelayMinutes ?? null,
      timingMode: timing?.timingMode || 'TIME_UNAVAILABLE',
      marketCoveragePct,
      candidatePresent: Boolean(row),
      volumeBaselineAvailable,
      baselineSessionCount: baselines.length,
      currentPrice: price,
      openingPrice: open,
      previousClose,
      openingGapPct: gapPct === null ? null : Number(gapPct.toFixed(4)),
      cumulativeVolume: volume,
      cumulativeTurnover: turnover,
      baselineMedianVolume: volumeBaseline,
      baselineMedianTurnover: turnoverBaseline,
      relativeVolumeRatio: relativeVolume === null ? null : Number(relativeVolume.toFixed(4)),
      relativeTurnoverRatio: relativeTurnover === null ? null : Number(relativeTurnover.toFixed(4)),
      marketBreadthPct: breadthPct,
      openingGapPass,
      priceAcceptancePass,
      relativeVolumePass,
      relativeTurnoverPass,
      marketBreadthPass,
      stopBreached,
      sourceTimestamp: row?.sourceMarketTime || row?.updatedAt || row?.sourceSessionCheckedAt || null,
      source: market?.source || 'PRO_CURRENT_MARKET',
      limitations: [
        ...(volumeBaselineAvailable ? [] : ['HISTORICAL_MORNING_BASELINE_NOT_ESTABLISHED']),
        ...(timing?.timingMode === 'RECEIPT_MINUS_EXPECTED_DELAY'
          ? ['SOURCE_MARKET_TIME_INFERRED_FROM_KNOWN_15M_DELAY']
          : [])
      ]
    };
  }

  const baselineRows = {};
  for (const [ticker, timed] of rowMap.entries()) {
    const row = timed.row;
    baselineRows[ticker] = {
      volume: num(row.volume),
      turnover: num(row.valueTraded ?? row.turnover),
      price: num(row.price ?? row.last)
    };
  }

  let baselineSessions = priorSessions;
  if (
    marketEvidenceMinute !== null &&
    marketEvidenceMinute >= EVIDENCE_START_MINUTE &&
    marketEvidenceMinute <= EVIDENCE_END_MINUTE
  ) {
    baselineSessions = [
      ...priorSessions,
      {
        sessionDate: clock.sessionDate,
        capturedAt: now.toISOString(),
        receiptMinute: clock.minuteOfDay,
        sourceMinute: marketEvidenceMinute,
        rows: baselineRows
      }
    ].slice(-30);
  }

  const allEvidence = Object.values(evidenceByTicker);
  const completeSource =
    prepared.length > 0 &&
    marketCoveragePct >= 90 &&
    allEvidence.every(item =>
      item.candidatePresent === true &&
      item.volumeBaselineAvailable === true &&
      Number.isFinite(item.latestSourceMinute) &&
      item.latestSourceMinute >= EVIDENCE_START_MINUTE &&
      item.latestSourceMinute <= EVIDENCE_END_MINUTE &&
      ['openingGapPass', 'priceAcceptancePass', 'relativeVolumePass', 'relativeTurnoverPass', 'marketBreadthPass']
        .every(key => typeof item[key] === 'boolean')
    );

  const sourceTimingModes = [...new Set(
    evidenceRows.map(item => item.timing.timingMode).filter(Boolean)
  )];

  return {
    schemaVersion: 'rasheed-egx-ucp-morning-evidence/v2',
    sessionDate: clock.sessionDate,
    generatedAt: now.toISOString(),
    cairoTime: clock.display,
    collectorMinute: clock.minuteOfDay,
    latestSourceMinute: marketEvidenceMinute,
    source: 'UCP_DELAY_AWARE_MORNING_COLLECTOR',
    sourceMarketGeneratedAt: market?.generatedAt || null,
    sourceMarketUpdatedAt: market?.updatedAt || null,
    sourceTimingModes,
    completeSource,
    marketCoveragePct,
    breadth: {
      observed: breadthRows.length,
      advancers,
      decliners,
      advancerPct: breadthPct,
      pass: marketBreadthPass
    },
    preparedCandidateCount: prepared.length,
    evidenceByTicker,
    baselineSessions,
    policy: {
      minBaselineSessions: MIN_BASELINE_SESSIONS,
      maxReceiptAgeMinutes: MAX_RECEIPT_AGE_MINUTES,
      expectedFeedDelayMinutes: EXPECTED_FEED_DELAY_MINUTES,
      marketEvidenceWindow: '10:20-10:45 Africa/Cairo market-data time',
      collectionWindow: '10:20-11:10 Africa/Cairo wall-clock time',
      evidenceStartMinute: EVIDENCE_START_MINUTE,
      evidenceEndMinute: EVIDENCE_END_MINUTE,
      collectionEndMinute: COLLECTION_END_MINUTE
    },
    resilience: {
      appAvailabilityIndependentOfMorningEvidence: true,
      missingMorningEvidenceBehavior: 'WAITING_DATA_THEN_UNCONFIRMED_DATA_GAP',
      afterCloseCandidatesPreserved: true,
      executionFailsClosed: true
    },
    notes: [
      'Morning evidence uses market-data time, not workflow wall-clock time.',
      'If sourceMarketTime is unavailable, receipt time is shifted by the configured 15-minute feed delay and explicitly marked as inferred.',
      'Delayed or missing morning data never crashes ASTRA/UCP and never deletes the after-close prepared candidate set.',
      'Incomplete evidence cannot confirm execution and remains research-only.',
      'Historical morning baselines are accumulated prospectively; no full-day volume is substituted.'
    ]
  };
}

async function main() {
  const clock = cairoClock();

  if (
    clock.minuteOfDay < COLLECTION_START_MINUTE ||
    clock.minuteOfDay > COLLECTION_END_MINUTE
  ) {
    console.log(JSON.stringify({
      changed: false,
      reason: 'OUTSIDE_DELAY_AWARE_COLLECTION_WINDOW',
      clock,
      collectionWindow: [COLLECTION_START_MINUTE, COLLECTION_END_MINUTE]
    }, null, 2));
    return;
  }

  let market;
  let ucp;
  try {
    [market, ucp] = await Promise.all([fetchJson(MARKET_URL), fetchJson(UCP_URL)]);
  } catch (error) {
    console.log(JSON.stringify({
      changed: false,
      reason: 'MORNING_SOURCE_UNAVAILABLE_NON_FATAL',
      error: error?.message || String(error),
      clock,
      appStabilityAffected: false
    }, null, 2));
    return;
  }

  const target = ucp?.snapshot?.morningConfirmation?.targetSessionDate || null;
  if (target && target !== clock.sessionDate) {
    console.log(JSON.stringify({
      changed: false,
      reason: 'TARGET_SESSION_MISMATCH',
      clock,
      target
    }, null, 2));
    return;
  }

  const existing = loadStore();
  const output = buildEvidence({ market, ucp, existing });

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');

  console.log(JSON.stringify({
    changed: true,
    sessionDate: output.sessionDate,
    collectorMinute: output.collectorMinute,
    latestSourceMinute: output.latestSourceMinute,
    preparedCandidateCount: output.preparedCandidateCount,
    marketCoveragePct: output.marketCoveragePct,
    completeSource: output.completeSource,
    sourceTimingModes: output.sourceTimingModes
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.log(JSON.stringify({
      changed: false,
      reason: 'MORNING_COLLECTOR_INTERNAL_ERROR_NON_FATAL',
      error: error?.message || String(error),
      appStabilityAffected: false
    }, null, 2));
  });
}

module.exports = {
  EXPECTED_FEED_DELAY_MINUTES,
  EVIDENCE_START_MINUTE,
  EVIDENCE_END_MINUTE,
  COLLECTION_END_MINUTE,
  cairoClock,
  ageMinutes,
  parseMinuteOfDay,
  rowTiming,
  median,
  candidateRange,
  buildEvidence
};
