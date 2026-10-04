// ASTRA V4 Morning Liquidity Gate
// Validates the exact 10:00-10:15 Cairo evidence window.
// Historical daily candles are never used to simulate first-15-minute liquidity.

const POLICY = Object.freeze({
  marketOpenTimeCairo: '10:00',
  windowMinutes: 15,
  minimumMorningRelativeVolume: 1.2,
  minimumMorningConfidence: 80,
  maximumMorningAgeMinutes: 5
});

function cairoParts(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function cairoSessionDate(value = new Date()) {
  const p = cairoParts(value);
  return [
    String(p.year).padStart(4, '0'),
    String(p.month).padStart(2, '0'),
    String(p.day).padStart(2, '0')
  ].join('-');
}

function cairoMinuteOfDay(value = new Date()) {
  const p = cairoParts(value);
  return p.hour * 60 + p.minute;
}

function getSessionPhase(value = new Date()) {
  const minute = cairoMinuteOfDay(value);
  const open = 10 * 60;
  const morningEnd = open + POLICY.windowMinutes;
  const close = 14 * 60 + 30;

  if (minute < open) return 'PRE_OPEN';
  if (minute < morningEnd) return 'MORNING_WINDOW';
  if (minute < close) return 'POST_MORNING';
  return 'CLOSED';
}

function normalizeCandle(row = {}) {
  const timestamp = row.timestamp ?? row.time ?? row.date;
  const timestampMs = typeof timestamp === 'number'
    ? timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
    : Date.parse(timestamp);

  return {
    timestamp: Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null,
    timestampMs,
    close: Number(row.close || row.price || 0),
    volume: Number(row.volume || 0)
  };
}

function getMorningCandles(candles = [], sessionDate) {
  return candles
    .map(normalizeCandle)
    .filter((row) => {
      if (!row.timestamp || row.close <= 0) return false;

      const p = cairoParts(row.timestamp);
      const rowDate = [
        String(p.year).padStart(4, '0'),
        String(p.month).padStart(2, '0'),
        String(p.day).padStart(2, '0')
      ].join('-');
      const minute = p.hour * 60 + p.minute;

      return rowDate === sessionDate &&
        minute >= 600 &&
        minute < 600 + POLICY.windowMinutes;
    })
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

function buildMorningRecord({
  candles = [],
  now = new Date(),
  sourceUrl = null,
  sourceVerified = false,
  sourceLatencySeconds = null,
  confidence = null,
  baselineFirst15Volume = null
} = {}) {
  const observedSessionDate = cairoSessionDate(now);
  const morningCandles = getMorningCandles(candles, observedSessionDate);
  const first15Volume = morningCandles.reduce(
    (sum, row) => sum + Math.max(0, row.volume),
    0
  );

  const latestCandle = morningCandles[morningCandles.length - 1] || null;
  const computedLatency = latestCandle
    ? Math.max(0, (Date.now() - latestCandle.timestampMs) / 1000)
    : null;

  const latency = Number.isFinite(Number(sourceLatencySeconds))
    ? Number(sourceLatencySeconds)
    : computedLatency;

  const baseline = Number(baselineFirst15Volume);
  const relativeVolume15 =
    Number.isFinite(baseline) && baseline > 0
      ? first15Volume / baseline
      : null;

  const record = {
    sessionDate: observedSessionDate,
    windowStart: '10:00',
    windowEnd: '10:15',
    first15Volume,
    relativeVolume15,
    latestCandleAt: latestCandle?.timestamp || null,
    sourceUrl,
    sourceVerified: sourceVerified === true,
    sourceLatencySeconds: Number.isFinite(latency) ? latency : null,
    confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : null
  };

  return {
    ...record,
    gate: morningGate(record, { now })
  };
}

function morningGate(record, { now = new Date() } = {}) {
  const reasons = [];
  const observedSessionDate = cairoSessionDate(now);

  if (!record) {
    return {
      confirmed: false,
      reasons: ['MORNING_NOT_PUBLISHED']
    };
  }

  if (
    record.windowStart !== POLICY.marketOpenTimeCairo ||
    record.windowEnd !== '10:15'
  ) {
    reasons.push('MORNING_TIME_INVALID');
  }

  if (record.sessionDate !== observedSessionDate) {
    reasons.push('MORNING_SESSION_MISMATCH');
  }

  const sourceUrlValid =
    typeof record.sourceUrl === 'string' &&
    /^https:///i.test(record.sourceUrl);

  const sourceLatencyValid =
    Number.isFinite(Number(record.sourceLatencySeconds)) &&
    Number(record.sourceLatencySeconds) >= 0 &&
    Number(record.sourceLatencySeconds) <= POLICY.maximumMorningAgeMinutes * 60;

  if (
    !sourceUrlValid ||
    record.sourceVerified !== true ||
    !Number.isFinite(Number(record.confidence)) ||
    Number(record.confidence) < POLICY.minimumMorningConfidence ||
    !sourceLatencyValid
  ) {
    reasons.push('MORNING_SOURCE_UNVERIFIED');
  }

  if (
    !Number.isFinite(Number(record.relativeVolume15)) ||
    Number(record.relativeVolume15) < POLICY.minimumMorningRelativeVolume
  ) {
    reasons.push('MORNING_LIQUIDITY_WEAK');
  }

  return {
    confirmed: reasons.length === 0,
    reasons,
    policy: POLICY
  };
}

module.exports = {
  POLICY,
  cairoParts,
  cairoSessionDate,
  cairoMinuteOfDay,
  getSessionPhase,
  getMorningCandles,
  buildMorningRecord,
  morningGate
};
