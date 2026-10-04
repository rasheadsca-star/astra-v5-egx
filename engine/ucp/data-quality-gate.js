'use strict';

const DEFAULT_POLICY = Object.freeze({
  minimumCoveragePct: 90,
  minimumVerifiedCoveragePct: 90,
  requireSourceReady: true,
  requireCurrentSessionReady: true,
  requireExecutionGrade: true,
  maxCriticalErrors: 0
});

function asNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function percentage(numerator, denominator) {
  const top = asNonNegativeNumber(numerator);
  const bottom = asNonNegativeNumber(denominator);

  if (bottom <= 0) return null;
  return Number(((top / bottom) * 100).toFixed(2));
}

function evaluateDataQuality(input = {}, policy = DEFAULT_POLICY) {
  const expectedUniverseSize = asNonNegativeNumber(input.expectedUniverseSize);
  const acceptedRows = asNonNegativeNumber(input.acceptedRows);
  const verifiedRows = asNonNegativeNumber(
    input.verifiedRows ?? input.sourceSessionVerifiedRows
  );

  const coveragePct = Number.isFinite(Number(input.coveragePct))
    ? Number(input.coveragePct)
    : percentage(acceptedRows, expectedUniverseSize);

  const verifiedCoveragePct = Number.isFinite(Number(input.verifiedCoveragePct))
    ? Number(input.verifiedCoveragePct)
    : percentage(verifiedRows, expectedUniverseSize);

  const criticalErrors = Array.isArray(input.criticalErrors)
    ? input.criticalErrors.filter(Boolean)
    : [];

  const blockers = [];

  if (policy.requireSourceReady && input.sourceReady !== true) {
    blockers.push('SOURCE_NOT_READY');
  }

  if (policy.requireCurrentSessionReady && input.currentSessionReady !== true) {
    blockers.push('CURRENT_SESSION_NOT_READY');
  }

  if (policy.requireExecutionGrade && input.executionGrade !== true) {
    blockers.push('EXECUTION_GRADE_FALSE');
  }

  if (expectedUniverseSize <= 0) {
    blockers.push('EXPECTED_UNIVERSE_UNKNOWN');
  }

  if (
    !Number.isFinite(coveragePct) ||
    coveragePct < Number(policy.minimumCoveragePct)
  ) {
    blockers.push('COVERAGE_BELOW_POLICY');
  }

  if (
    !Number.isFinite(verifiedCoveragePct) ||
    verifiedCoveragePct < Number(policy.minimumVerifiedCoveragePct)
  ) {
    blockers.push('VERIFIED_COVERAGE_BELOW_POLICY');
  }

  if (criticalErrors.length > Number(policy.maxCriticalErrors)) {
    blockers.push('CRITICAL_DATA_ERRORS_PRESENT');
  }

  return Object.freeze({
    pass: blockers.length === 0,
    policy: Object.freeze({ ...policy }),
    metrics: Object.freeze({
      expectedUniverseSize,
      acceptedRows,
      verifiedRows,
      coveragePct,
      verifiedCoveragePct,
      sourceReady: input.sourceReady === true,
      currentSessionReady: input.currentSessionReady === true,
      executionGrade: input.executionGrade === true,
      criticalErrorCount: criticalErrors.length
    }),
    blockers: Object.freeze(blockers),
    quarantinedSymbols: Object.freeze(
      Array.isArray(input.quarantinedSymbols)
        ? [...new Set(input.quarantinedSymbols.filter(Boolean))]
        : []
    )
  });
}

module.exports = {
  DEFAULT_POLICY,
  evaluateDataQuality,
  percentage
};
