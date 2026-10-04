'use strict';

const fs = require('fs');
const path = require('path');

const FORWARD_POLICY = Object.freeze({
  version: 'ucp-forward-promotion/v1',
  minForwardSessions: 30,
  minResolvedTrades: 30,
  minObservedCalendarDays: 90,
  minProfitFactor: 1.20,
  minAverageNetReturnPct: 0,
  maxCriticalBreaches: 0,
  automaticPromotionAllowed: false,
  automaticExecutionAllowed: false,
  sameBarAmbiguity: 'STOP_FIRST',
  roundTripCostPct: 0.60,
  entryExpirySessions: 3,
  maxHoldSessions: 10
});

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function calendarDays(firstDate, lastDate) {
  const first = Date.parse((dateOnly(firstDate) || '') + 'T00:00:00Z');
  const last = Date.parse((dateOnly(lastDate) || '') + 'T00:00:00Z');
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 0;
  return Math.floor((last - first) / 86400000) + 1;
}

function flattenOutcomes(entries = []) {
  return entries.flatMap((entry) => Array.isArray(entry?.outcomes) ? entry.outcomes : []);
}

function summarizeForwardLedger(ledger = {}) {
  const entries = Array.isArray(ledger.entries) ? ledger.entries : [];
  const outcomes = flattenOutcomes(entries);
  const sessionDates = [...new Set(entries.map((entry) => entry?.targetSessionDate || entry?.sessionDate).filter(Boolean))];
  const resolved = outcomes.filter((item) => ['TARGET1', 'STOP', 'TIME_EXIT'].includes(item?.outcome));
  const wins = resolved.filter((item) => Number(item.netReturnPct) > 0);
  const losses = resolved.filter((item) => Number(item.netReturnPct) <= 0);
  const notEntered = outcomes.filter((item) => item?.outcome === 'NOT_ENTERED');
  const open = outcomes.filter((item) => item?.outcome === 'OPEN');
  const returns = resolved.map((item) => finite(item.netReturnPct)).filter((value) => value !== null);
  const grossProfit = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const averageNetReturnPct = returns.length
    ? Number((returns.reduce((sum, value) => sum + value, 0) / returns.length).toFixed(4))
    : null;
  // Cap the no-loss case so the metric stays JSON-safe while remaining clearly above policy.
  const profitFactor = grossLoss > 0
    ? Number((grossProfit / grossLoss).toFixed(4))
    : grossProfit > 0 ? 999 : null;
  const dates = entries
    .flatMap((entry) => [entry?.sessionDate, entry?.targetSessionDate, entry?.capturedAt, ...(entry?.outcomes || []).map((item) => item?.resolvedAt || item?.exitSession)])
    .map(dateOnly)
    .filter(Boolean)
    .sort();
  const criticalBreaches = entries.reduce((count, entry) => {
    const breaches = Array.isArray(entry?.criticalBreaches) ? entry.criticalBreaches : [];
    return count + breaches.length;
  }, 0);

  return Object.freeze({
    forwardSessions: sessionDates.length,
    resolvedTrades: resolved.length,
    wins: wins.length,
    losses: losses.length,
    notEntered: notEntered.length,
    open: open.length,
    averageNetReturnPct,
    profitFactor,
    observedCalendarDays: dates.length ? calendarDays(dates[0], dates[dates.length - 1]) : 0,
    criticalBreaches
  });
}

function evaluatePromotionEligibility(summary = {}, policy = FORWARD_POLICY) {
  const blockers = [];
  const forwardSessions = Number(summary.forwardSessions || 0);
  const resolvedTrades = Number(summary.resolvedTrades || 0);
  const observedCalendarDays = Number(summary.observedCalendarDays || 0);
  const criticalBreaches = Number(summary.criticalBreaches || 0);
  const profitFactor = finite(summary.profitFactor);
  const averageNetReturnPct = finite(summary.averageNetReturnPct);

  if (forwardSessions < policy.minForwardSessions) blockers.push('MIN_FORWARD_SESSIONS_NOT_MET');
  if (resolvedTrades < policy.minResolvedTrades) blockers.push('MIN_RESOLVED_TRADES_NOT_MET');
  if (observedCalendarDays < policy.minObservedCalendarDays) blockers.push('MIN_CALENDAR_DAYS_NOT_MET');
  if (profitFactor === null) blockers.push('PROFIT_FACTOR_NOT_ESTABLISHED');
  else if (profitFactor < policy.minProfitFactor) blockers.push('PROFIT_FACTOR_BELOW_POLICY');
  if (averageNetReturnPct === null) blockers.push('AVERAGE_NET_RETURN_NOT_ESTABLISHED');
  else if (averageNetReturnPct <= policy.minAverageNetReturnPct) blockers.push('AVERAGE_NET_RETURN_NOT_POSITIVE');
  if (criticalBreaches > policy.maxCriticalBreaches) blockers.push('CRITICAL_GOVERNANCE_BREACH_PRESENT');

  const eligible = blockers.length === 0;
  return Object.freeze({
    eligible,
    automaticPromotionAllowed: false,
    executionAllowed: false,
    status: eligible ? 'MANUAL_CHAMPION_REVIEW_REQUIRED' : 'FORWARD_VALIDATION_REQUIRED',
    blockers: Object.freeze(blockers),
    policy
  });
}

function loadForwardLedger(filePath = path.join(process.cwd(), 'data', 'ucp', 'forward-ledger.json')) {
  try {
    const ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const summary = summarizeForwardLedger(ledger);
    const promotion = evaluatePromotionEligibility(summary);
    return Object.freeze({
      available: true,
      schemaVersion: ledger.schemaVersion || null,
      updatedAt: ledger.updatedAt || null,
      entries: Array.isArray(ledger.entries) ? ledger.entries : [],
      summary,
      promotion
    });
  } catch (error) {
    const summary = summarizeForwardLedger({ entries: [] });
    return Object.freeze({
      available: false,
      updatedAt: null,
      entries: Object.freeze([]),
      summary,
      promotion: evaluatePromotionEligibility(summary),
      error: error?.message || 'FORWARD_LEDGER_UNAVAILABLE'
    });
  }
}

module.exports = {
  FORWARD_POLICY,
  summarizeForwardLedger,
  evaluatePromotionEligibility,
  loadForwardLedger
};
