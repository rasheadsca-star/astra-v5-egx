// ASTRA V4 Analysis Runtime
// Uses current market data plus historical sessions to produce explainable entry scores.

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function pctChange(from, to) {
  if (!from || !Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return ((to - from) / from) * 100;
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0;
}

function standardDeviation(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length < 2) return 0;
  const mean = average(valid);
  return Math.sqrt(average(valid.map((value) => (value - mean) ** 2)));
}

function calculateAtr(rows, period = 14) {
  if (rows.length < 2) return 0;

  const trueRanges = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const previousClose = rows[index - 1]?.close || row.close;

    trueRanges.push(
      Math.max(
        row.high - row.low,
        Math.abs(row.high - previousClose),
        Math.abs(row.low - previousClose)
      )
    );
  }

  return average(trueRanges.slice(-period));
}

function analyzeHistory(history = []) {
  const rows = history
    .filter((row) => Number(row?.close) > 0)
    .map((row) => ({
      date: row.date,
      open: Number(row.open || 0),
      high: Number(row.high || row.close || 0),
      low: Number(row.low || row.close || 0),
      close: Number(row.close || 0),
      volume: Number(row.volume || 0)
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (!rows.length) {
    return {
      sessionsUsed: 0,
      latestClose: 0,
      previousClose: 0,
      momentum: 50,
      trend: 50,
      volumeBehavior: 50,
      volatility: 50,
      volatilityPct: 0,
      fiveDayChangePct: 0,
      twentyDayChangePct: 0,
      averageVolume20: 0,
      latestVolume: 0,
      atr14: 0,
      recentLow20: 0,
      recentHigh20: 0
    };
  }

  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2] || latest;
  const last5 = rows.slice(-5);
  const last20 = rows.slice(-20);
  const closes20 = last20.map((row) => row.close);
  const returns = [];

  for (let index = 1; index < last20.length; index += 1) {
    returns.push(pctChange(last20[index - 1].close, last20[index].close));
  }

  const fiveDayChangePct = pctChange(
    last5[0]?.close || latest.close,
    latest.close
  );

  const twentyDayChangePct = pctChange(
    last20[0]?.close || latest.close,
    latest.close
  );

  const sma5 = average(last5.map((row) => row.close));
  const sma20 = average(closes20);
  const trendSpreadPct = pctChange(sma20, sma5);
  const volatilityPct = standardDeviation(returns);

  const averageVolume20 = average(last20.map((row) => row.volume));
  const volumeRatio = averageVolume20 > 0
    ? latest.volume / averageVolume20
    : 1;

  const momentum = clamp(50 + fiveDayChangePct * 8 + twentyDayChangePct * 2.5);
  const trend = clamp(50 + trendSpreadPct * 12 + twentyDayChangePct * 1.5);
  const volumeBehavior = clamp(50 + (volumeRatio - 1) * 40);
  const volatility = clamp(85 - volatilityPct * 12);

  return {
    sessionsUsed: rows.length,
    latestClose: latest.close,
    previousClose: previous.close,
    momentum,
    trend,
    volumeBehavior,
    volatility,
    volatilityPct,
    fiveDayChangePct,
    twentyDayChangePct,
    averageVolume20,
    latestVolume: latest.volume,
    atr14: calculateAtr(rows, 14),
    recentLow20: Math.min(...last20.map((row) => row.low)),
    recentHigh20: Math.max(...last20.map((row) => row.high))
  };
}

function analyze(snapshot) {
  const symbols = Array.isArray(snapshot?.symbols) ? snapshot.symbols : [];
  const histories = snapshot?.histories || {};

  const results = symbols.map((item) => {
    const symbol = item.symbol;
    const historyAnalysis = analyzeHistory(histories[symbol] || []);
    const historyPrice = historyAnalysis.latestClose;
    const price = Number(item.price || historyPrice || 0);

    const dailyChangePercent = Number(
      item.changePercent ??
      (historyAnalysis.previousClose > 0
        ? pctChange(historyAnalysis.previousClose, historyPrice)
        : 0)
    );

    const currentMomentum = clamp(50 + dailyChangePercent * 5);
    const momentum = historyAnalysis.sessionsUsed >= 2
      ? clamp(historyAnalysis.momentum * 0.8 + currentMomentum * 0.2)
      : currentMomentum;

    const trend = historyAnalysis.sessionsUsed >= 5
      ? historyAnalysis.trend
      : clamp(50 + dailyChangePercent * 4);

    const volume = Number(item.volume || historyAnalysis.latestVolume || 0);
    const liquidity = historyAnalysis.sessionsUsed >= 5
      ? historyAnalysis.volumeBehavior
      : volume > 0 ? 60 : 30;

    const volatility = historyAnalysis.sessionsUsed >= 5
      ? historyAnalysis.volatility
      : 50;

    const technicalScore = Math.round(
      momentum * 0.30 +
      trend * 0.30 +
      liquidity * 0.20 +
      volatility * 0.20
    );

    const riskLevel =
      technicalScore >= 80 && volatility >= 65 ? 'LOW' :
      technicalScore >= 60 && volatility >= 45 ? 'MEDIUM' :
      'HIGH';

    return {
      symbol,
      price,
      dailyChangePercent,
      momentum: Math.round(momentum),
      liquidity: Math.round(liquidity),
      trend: Math.round(trend),
      volatility: Math.round(volatility),
      volatilityPct: Number(historyAnalysis.volatilityPct.toFixed(3)),
      fiveDayChangePct: Number(historyAnalysis.fiveDayChangePct.toFixed(2)),
      twentyDayChangePct: Number(historyAnalysis.twentyDayChangePct.toFixed(2)),
      historySessions: historyAnalysis.sessionsUsed,
      latestVolume: historyAnalysis.latestVolume,
      averageVolume20: historyAnalysis.averageVolume20,
      atr14: Number(historyAnalysis.atr14.toFixed(4)),
      recentLow20: Number(historyAnalysis.recentLow20.toFixed(4)),
      recentHigh20: Number(historyAnalysis.recentHigh20.toFixed(4)),
      technicalScore,
      riskLevel,
      dataFreshness: item.dataFreshness || null,
      priceMatched: item.priceMatched === true,
      source: item.source || null,
      delayed: item.delayed === true,
      morningGate: item.morningGate || {
        confirmed: false,
        reasons: ['MORNING_NOT_PUBLISHED']
      },
      morningEvidence: item.morningEvidence || null,
      sessionPhase: item.sessionPhase || 'UNKNOWN'
    };
  });

  return {
    analyzedAt: new Date().toISOString(),
    results
  };
}

module.exports = { analyze, analyzeHistory };
