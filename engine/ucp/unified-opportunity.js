'use strict';

const RR68_ID = 'TFE_V20_FUSION_RC2_RR68_CHALLENGER';

const WEIGHTS = Object.freeze({
  technical: 0.20,
  research: 0.25,
  liquidity: 0.10,
  supportResistance: 0.10,
  structuralRR: 0.15,
  riskSafety: 0.15,
  dataQuality: 0.05
});

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function piecewise(value, points) {
  const x = finite(value);
  if (x === null) return null;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i - 1];
    const [x2, y2] = points[i];
    if (x <= x2) {
      const t = (x - x1) / Math.max(1e-9, x2 - x1);
      return y1 + t * (y2 - y1);
    }
  }
  return points.at(-1)[1];
}

function structuralRrScore(rr) {
  const score = piecewise(rr, [
    [0, 0],
    [0.50, 25],
    [0.68, 40],
    [0.70, 42],
    [1.00, 58],
    [1.25, 68],
    [1.50, 78],
    [2.00, 90],
    [3.00, 100]
  ]);
  return score === null ? null : Number(score.toFixed(2));
}

function stopRiskPct(row = {}) {
  const entryHigh = finite(row.entryHigh);
  const entryLow = finite(row.entryLow);
  const stop = finite(row.stopLoss);
  const entry = entryHigh ?? entryLow;
  if (!(entry > 0) || !(stop > 0) || stop >= entry) return null;
  return Number((((entry - stop) / entry) * 100).toFixed(3));
}

function stopRiskSafety(scorePct) {
  const pct = finite(scorePct);
  if (pct === null) return null;
  const score = piecewise(pct, [
    [0, 100],
    [2, 95],
    [3, 88],
    [5, 72],
    [7, 55],
    [10, 35],
    [15, 15],
    [25, 0]
  ]);
  return score === null ? null : Number(score.toFixed(2));
}

function nativeRiskSafety(level) {
  return ({ LOW: 90, MEDIUM: 60, HIGH: 25, UNKNOWN: 40 })[String(level || 'UNKNOWN').toUpperCase()] ?? 40;
}

function combinedRiskSafety(row = {}, native = {}) {
  const structural = stopRiskSafety(stopRiskPct(row));
  const nativeScore = nativeRiskSafety(native.riskLevel);
  if (structural === null) return nativeScore;
  return Number((structural * 0.70 + nativeScore * 0.30).toFixed(2));
}

function weightedScore(components = {}) {
  let numerator = 0;
  let denominator = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    const value = finite(components[key]);
    if (value === null) continue;
    numerator += clamp(value) * weight;
    denominator += weight;
  }
  if (!denominator) return { score: 0, coveragePct: 0 };
  const raw = numerator / denominator;
  const coveragePct = Number((denominator * 100).toFixed(1));
  const coveragePenalty = 0.75 + (coveragePct / 100) * 0.25;
  return {
    score: Number((raw * coveragePenalty).toFixed(2)),
    coveragePct
  };
}

function percentileRanks(rows = [], key) {
  const values = rows
    .map((row, index) => ({ index, value: finite(row[key]) }))
    .filter((item) => item.value !== null)
    .sort((a, b) => a.value - b.value);

  const output = new Map();
  const n = values.length;
  if (!n) return output;

  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && values[j].value === values[i].value) j += 1;
    const averageRank = ((i + 1) + j) / 2;
    const percentile = n === 1 ? 100 : ((averageRank - 1) / (n - 1)) * 100;
    for (let k = i; k < j; k += 1) output.set(values[k].index, Number(percentile.toFixed(2)));
    i = j;
  }
  return output;
}

function breakEvenTargetProbability({
  entryLow = null,
  entryHigh = null,
  stopLoss = null,
  target1 = null,
  roundTripCostPct = 0.60
} = {}) {
  const entry = finite(entryHigh) ?? finite(entryLow);
  const stop = finite(stopLoss);
  const target = finite(target1);
  const costPct = finite(roundTripCostPct) ?? 0.60;
  if (!(entry > 0) || !(stop > 0) || !(target > entry) || !(stop < entry)) return null;
  const cost = entry * costPct / 100;
  const effectiveRisk = entry - stop + cost;
  const effectiveReward = target - entry - cost;
  if (!(effectiveRisk > 0) || !(effectiveReward > 0)) return null;
  return Number((effectiveRisk / (effectiveRisk + effectiveReward) * 100).toFixed(2));
}

function metaLabelStatus() {
  return Object.freeze({
    status: 'NOT_CALIBRATED',
    probabilityTarget1Pct: null,
    expectedValuePct: null,
    minimumProspectiveResolvedTrades: 30,
    calibrationRequired: true,
    usedForSelection: false,
    executionAllowed: false,
    reason: 'No probability is published until prospective out-of-sample calibration is sufficient.'
  });
}

function sourceState({ rc2Row = {}, rr68Set = new Set(), nativeStatus = 'NONE' } = {}) {
  if (rc2Row.publicationEligible === true && rc2Row.eligible === true) return 'RC2_FROZEN';
  if (rr68Set.has(rc2Row.ticker)) return 'RR68_CHALLENGER';
  if (rc2Row.nearMiss === true) return 'RC2_NEAR_MISS';
  if (nativeStatus === 'ENTRY') return 'ASTRA_NATIVE_ENTRY';
  if (nativeStatus === 'WATCH') return 'ASTRA_NATIVE_WATCH';
  return 'REJECTED';
}

function nativeMap(runtime = {}) {
  const map = new Map();
  const add = (items, status) => {
    for (const item of items || []) {
      const symbol = item.symbol || item.ticker;
      if (!symbol) continue;
      map.set(symbol, { ...item, nativeStatus: status });
    }
  };
  add(runtime.recommendations, 'ENTRY');
  add(runtime.watchlist, 'WATCH');
  add(runtime.rejected, 'REJECTED');
  return map;
}

function morningMap(snapshot = {}) {
  const map = new Map();
  for (const item of snapshot?.morningConfirmation?.preparedCandidates || []) {
    if (item?.ticker) map.set(item.ticker, item);
  }
  return map;
}

function rr68TickerSet(snapshot = {}) {
  const set = new Set();
  for (const challenger of snapshot?.alpha?.challengers || []) {
    if (challenger?.id !== RR68_ID) continue;
    for (const item of challenger.candidates || []) if (item?.ticker) set.add(item.ticker);
  }
  return set;
}

function confidenceDescriptor(native = {}) {
  const confidence = finite(native.confidence);
  return {
    value: confidence,
    source: confidence === null ? 'NOT_AVAILABLE' : 'ASTRA_TECHNICAL_PROXY',
    usedInUnifiedScore: false
  };
}

function buildUnifiedOpportunityBoard({ runtime = {}, ucp = {} } = {}) {
  const snapshot = ucp?.snapshot || {};
  const rc2Rows = ucp?.diagnostics?.rc2?.marketScoreboard || [];
  const nativeByTicker = nativeMap(runtime);
  const morningByTicker = morningMap(snapshot);
  const rr68Set = rr68TickerSet(snapshot);
  const metaLabelByTicker = new Map(
    (ucp?.diagnostics?.v24?.metaLabel?.results || [])
      .filter(item => item?.ticker)
      .map(item => [item.ticker, item])
  );

  const tickers = new Set([
    ...rc2Rows.map((row) => row.ticker).filter(Boolean),
    ...nativeByTicker.keys(),
    ...rr68Set
  ]);

  const rc2Map = new Map(rc2Rows.map((row) => [row.ticker, row]));
  const rows = [];

  for (const ticker of tickers) {
    const rc2 = rc2Map.get(ticker) || { ticker };
    const native = nativeByTicker.get(ticker) || {};
    const morning = morningByTicker.get(ticker) || null;

    const components = {
      technical: finite(rc2.coreScore ?? native.analysis?.technicalScore ?? native.confidence),
      research: finite(rc2.researchScore),
      liquidity: finite(rc2.liquidityScore ?? native.analysis?.liquidity),
      supportResistance: finite(rc2.srScore),
      structuralRR: structuralRrScore(rc2.structuralNetRR),
      riskSafety: combinedRiskSafety(rc2, native),
      dataQuality: finite(rc2.dataQualityScore)
    };

    const weighted = weightedScore(components);
    const source = sourceState({
      rc2Row: rc2,
      rr68Set,
      nativeStatus: native.nativeStatus || 'NONE'
    });

    rows.push({
      ticker,
      unifiedRank: null,
      unifiedScore: weighted.score,
      scoreCoveragePct: weighted.coveragePct,
      source,
      selectedByUcp: source === 'RC2_FROZEN' || source === 'RR68_CHALLENGER',
      executionAllowed: false,
      technicalScore: components.technical,
      researchScore: components.research,
      confidence: confidenceDescriptor(native),
      liquidityScore: components.liquidity,
      supportResistanceScore: components.supportResistance,
      dataQualityScore: components.dataQuality,
      structuralNetRR: finite(rc2.structuralNetRR),
      structuralRrScore: components.structuralRR,
      riskLevel: native.riskLevel || 'UNKNOWN',
      stopRiskPct: stopRiskPct(rc2),
      riskSafetyScore: components.riskSafety,
      alignmentState: rc2.alignmentState || null,
      entryLow: finite(rc2.entryLow ?? native.entry),
      entryHigh: finite(rc2.entryHigh ?? native.entry),
      stopLoss: finite(rc2.stopLoss ?? native.stopLoss),
      target1: finite(rc2.target1 ?? native.target1),
      target2: finite(rc2.target2 ?? native.target2),
      roundTripCostPct: finite(rc2.roundTripCostPct) ?? (finite(rc2.structuralNetRR) !== null ? 0.60 : null),
      breakEvenTargetProbabilityPct: breakEvenTargetProbability({
        entryLow: finite(rc2.entryLow ?? native.entry),
        entryHigh: finite(rc2.entryHigh ?? native.entry),
        stopLoss: finite(rc2.stopLoss ?? native.stopLoss),
        target1: finite(rc2.target1 ?? native.target1),
        roundTripCostPct: finite(rc2.roundTripCostPct) ?? 0.60
      }),
      metaLabel: metaLabelByTicker.get(ticker) || metaLabelStatus(),
      nativeStatus: native.nativeStatus || 'NONE',
      morningStatus: morning?.lifecycleState || snapshot?.morningConfirmation?.status || 'NOT_PREPARED',
      reasonCodes: Array.isArray(rc2.reasonCodes) ? rc2.reasonCodes : [],
      nearMiss: rc2.nearMiss === true,
      formula: Object.freeze({ ...WEIGHTS })
    });
  }

  const percentileKeys = {
    technicalPercentile: 'technicalScore',
    researchPercentile: 'researchScore',
    liquidityPercentile: 'liquidityScore',
    supportResistancePercentile: 'supportResistanceScore',
    structuralRrPercentile: 'structuralRrScore',
    riskSafetyPercentile: 'riskSafetyScore',
    dataQualityPercentile: 'dataQualityScore'
  };
  const percentileMaps = Object.fromEntries(
    Object.entries(percentileKeys).map(([name, key]) => [name, percentileRanks(rows, key)])
  );

  rows.forEach((row, index) => {
    row.crossSectional = {};
    for (const [name] of Object.entries(percentileKeys)) {
      row.crossSectional[name] = percentileMaps[name].get(index) ?? null;
    }
    const cross = weightedScore({
      technical: row.crossSectional.technicalPercentile,
      research: row.crossSectional.researchPercentile,
      liquidity: row.crossSectional.liquidityPercentile,
      supportResistance: row.crossSectional.supportResistancePercentile,
      structuralRR: row.crossSectional.structuralRrPercentile,
      riskSafety: row.crossSectional.riskSafetyPercentile,
      dataQuality: row.crossSectional.dataQualityPercentile
    });
    row.crossSectionalScore = cross.score;
    row.crossSectionalCoveragePct = cross.coveragePct;
  });

  const crossOrder = [...rows]
    .sort((a, b) => b.crossSectionalScore - a.crossSectionalScore || a.ticker.localeCompare(b.ticker));
  crossOrder.forEach((row, index) => { row.crossSectionalRank = index + 1; });

  rows.sort((a, b) =>
    b.unifiedScore - a.unifiedScore ||
    Number(b.selectedByUcp) - Number(a.selectedByUcp) ||
    (b.researchScore ?? -1) - (a.researchScore ?? -1) ||
    a.ticker.localeCompare(b.ticker)
  );

  rows.forEach((row, index) => { row.unifiedRank = index + 1; });

  return Object.freeze({
    schemaVersion: 'rasheed-egx-unified-opportunity-board/v1',
    sessionDate: snapshot.sessionDate || ucp?.diagnostics?.rc2?.sessionDate || null,
    generatedAt: new Date().toISOString(),
    executionAllowed: false,
    weights: WEIGHTS,
    marketRegime: Object.freeze({
      regime: snapshot?.governance?.market?.regime || 'UNKNOWN',
      score: finite(snapshot?.governance?.market?.score),
      riskMultiplier: finite(snapshot?.governance?.market?.riskMultiplier),
      maxTradeRiskPct: finite(snapshot?.governance?.market?.maxTradeRiskPct),
      affectsHardGatesAutomatically: false,
      usedForContextOnly: true
    }),
    metaLabelPolicy: metaLabelStatus(),
    confidencePolicy: Object.freeze({
      displayed: true,
      usedInUnifiedScore: false,
      reason: 'ASTRA confidence currently duplicates technical score and would double-count the same signal.'
    }),
    rows: Object.freeze(rows.map(Object.freeze))
  });
}

module.exports = {
  RR68_ID,
  WEIGHTS,
  structuralRrScore,
  stopRiskPct,
  stopRiskSafety,
  nativeRiskSafety,
  combinedRiskSafety,
  weightedScore,
  percentileRanks,
  breakEvenTargetProbability,
  metaLabelStatus,
  buildUnifiedOpportunityBoard
};
