'use strict';

const DEFAULT_RC2_BASE_URL =
  process.env.UCP_RC2_BASE_URL ||
  'https://egx-tfe-v20-fusion-rc2.vercel.app';
const DEFAULT_RC2_SNAPSHOT_URL = process.env.UCP_RC2_SNAPSHOT_URL ||
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/data/rc2/current-session.json';

const EXPECTED_ENGINE = 'TFE_V20_FUSION_RC2';
const EXPECTED_RR68_CHALLENGER = 'TFE_V20_FUSION_RC2_RR68_CHALLENGER';
const REQUEST_TIMEOUT_MS = Number(process.env.UCP_RC2_TIMEOUT_MS || 20000);

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeScoreboardRow(item = {}) {
  return Object.freeze({
    ticker: item.ticker || null,
    sessionDate: item.sessionDate || null,
    eligible: item.eligible === true,
    publicationEligible: item.publicationEligible === true,
    qualityState: item.qualityState || null,
    publicationHold: item.publicationHold === true,
    coreScore: safeNumber(item.scores?.core ?? item.core),
    researchScore: safeNumber(item.scores?.research ?? item.research),
    liquidityScore: safeNumber(item.scores?.liquidity ?? item.liquidity),
    srScore: safeNumber(item.scores?.supportResistance ?? item.sr),
    dataQualityScore: safeNumber(item.scores?.dataQuality ?? item.quality),
    structuralNetRR: safeNumber(item.structuralNetRR ?? item.tradePlan?.structuralNetRR),
    alignmentState: item.alignmentState || item.tradePlan?.alignmentState || null,
    price: safeNumber(item.price),
    entryLow: safeNumber(item.tradePlan?.entryLow),
    entryHigh: safeNumber(item.tradePlan?.entryHigh),
    stopLoss: safeNumber(item.tradePlan?.stop),
    target1: safeNumber(item.tradePlan?.target1),
    target2: safeNumber(item.tradePlan?.target2),
    roundTripCostPct: safeNumber(item.tradePlan?.roundTripCostPct),
    reasonCodes: Object.freeze(Array.isArray(item.reasonCodes) ? [...item.reasonCodes] : []),
    nearMiss: item.nearMiss === true,
    gateDistance: safeNumber(item.gateDistance),
    closeness: safeNumber(item.closeness)
  });
}

function normalizeCandidate(item = {}) {
  const entryLow = safeNumber(item.tradePlan?.entryLow ?? item.entryLow ?? item.tradePlan?.entry ?? item.entry);
  const entryHigh = safeNumber(item.tradePlan?.entryHigh ?? item.entryHigh ?? item.tradePlan?.entry ?? item.entry);
  const explicitEntry = safeNumber(item.tradePlan?.entry ?? item.entry);
  const entry = explicitEntry ?? (
    entryLow !== null && entryHigh !== null ? Number(((entryLow + entryHigh) / 2).toFixed(6)) : entryLow ?? entryHigh
  );
  return Object.freeze({
    ticker: item.ticker || null,
    rank: Number.isFinite(Number(item.rank)) ? Number(item.rank) : null,
    candidateSource: item.candidateSource || EXPECTED_ENGINE,
    challengerResearchOnly: item.challengerResearchOnly === true,
    nameAr: item.nameAr || null,
    nameEn: item.nameEn || null,
    decision: item.decision || item.publicationState || 'RESEARCH_CANDIDATE',
    publicationState: item.publicationState || null,
    publicationEligible: item.publicationEligible === true,
    technicalEligible: item.technicalEligible === true,
    researchScore: safeNumber(item.scores?.research ?? item.researchScore),
    fusionRankScore: safeNumber(item.scores?.fusionRank ?? item.fusionRankScore),
    liquidityScore: safeNumber(item.scores?.liquidity ?? item.liquidityScore),
    srScore: safeNumber(item.scores?.supportResistance ?? item.srScore),
    structuralNetRR: safeNumber(item.tradePlan?.structuralNetRR ?? item.structuralNetRR),
    entryLow,
    entryHigh,
    entry,
    stopLoss: safeNumber(item.tradePlan?.stop ?? item.stopLoss),
    target1: safeNumber(item.tradePlan?.target1 ?? item.target1),
    target2: safeNumber(item.tradePlan?.target2 ?? item.target2),
    reasonCodes: Object.freeze(Array.isArray(item.reasonCodes) ? [...item.reasonCodes] : []),
    frozenPolicyReasonCodes: Object.freeze(Array.isArray(item.frozenPolicyReasonCodes) ? [...item.frozenPolicyReasonCodes] : []),
    qualityState: item.quality?.state || item.qualityState || null,
    publicationHold: item.quality?.publicationHold === true || item.publicationHold === true
  });
}

function validateResearchPermissions(permissions = {}) {
  return (
    permissions.researchOnly === true &&
    permissions.executionAllowed === false &&
    permissions.productionAllocation === false &&
    permissions.automaticOrders === false &&
    permissions.automaticChampionPromotion === false
  );
}

function unavailableChallenger(error = null, published = false) {
  return Object.freeze({
    published,
    available: false,
    status: published ? 'CHALLENGER_BLOCKED' : 'NOT_PUBLISHED',
    id: EXPECTED_RR68_CHALLENGER,
    baseEngine: EXPECTED_ENGINE,
    mode: 'RESEARCH_ONLY',
    sessionDate: null,
    sessionAligned: false,
    researchOnly: true,
    executionAllowed: false,
    automaticPromotionAllowed: false,
    candidates: Object.freeze([]),
    error
  });
}

function normalizeRr68Challenger(raw = null, parentSession = null, expectedSession = null) {
  if (!raw || typeof raw !== 'object') return unavailableChallenger(null, false);

  try {
    if (raw.id !== EXPECTED_RR68_CHALLENGER) throw new Error('RR68_CHALLENGER_ID_MISMATCH');
    if (raw.baseEngine !== EXPECTED_ENGINE) throw new Error('RR68_CHALLENGER_BASE_ENGINE_MISMATCH');
    if (raw.mode !== 'RESEARCH_ONLY' || raw.researchOnly !== true) throw new Error('RR68_CHALLENGER_NOT_RESEARCH_ONLY');
    if (raw.executionAllowed !== false || raw.automaticPromotionAllowed !== false) throw new Error('RR68_CHALLENGER_PERMISSION_BREACH');

    const frozenRr = safeNumber(raw?.policyDiff?.minStructuralNetRR?.frozenChampion);
    const challengerRr = safeNumber(raw?.policyDiff?.minStructuralNetRR?.challenger);
    if (frozenRr !== 0.70 || challengerRr !== 0.68) throw new Error('RR68_CHALLENGER_POLICY_MISMATCH');
    if (raw?.policyDiff?.allOtherHardGates !== 'UNCHANGED') throw new Error('RR68_CHALLENGER_SCOPE_MISMATCH');

    const sessionDate = raw.sessionDate || parentSession || null;
    const sessionAligned = Boolean(
      sessionDate &&
      (!parentSession || sessionDate === parentSession) &&
      (!expectedSession || sessionDate === expectedSession)
    );
    if (!sessionAligned) throw new Error('RR68_CHALLENGER_SESSION_MISMATCH');

    const candidates = [];
    for (const item of Array.isArray(raw.candidates) ? raw.candidates : []) {
      if (!validateResearchPermissions(item.permissions || {})) throw new Error(`RR68_CHALLENGER_CANDIDATE_PERMISSION_BREACH:${item.ticker || 'UNKNOWN'}`);
      if (item.quality?.publicationHold === true || item.publicationHold === true) throw new Error(`RR68_CHALLENGER_PUBLICATION_HOLD:${item.ticker || 'UNKNOWN'}`);
      if (safeNumber(item.tradePlan?.structuralNetRR ?? item.structuralNetRR) < 0.68) throw new Error(`RR68_CHALLENGER_RR_BELOW_POLICY:${item.ticker || 'UNKNOWN'}`);
      const frozenReasons = Array.isArray(item.frozenPolicyReasonCodes) ? item.frozenPolicyReasonCodes : [];
      if (!frozenReasons.length || frozenReasons.some((reason) => reason !== 'STRUCTURAL_RR_LOW')) {
        throw new Error(`RR68_CHALLENGER_NOT_INCREMENTAL_RR_ONLY:${item.ticker || 'UNKNOWN'}`);
      }

      const entryLow = safeNumber(item.tradePlan?.entryLow);
      const entryHigh = safeNumber(item.tradePlan?.entryHigh);
      const stop = safeNumber(item.tradePlan?.stop);
      const target1 = safeNumber(item.tradePlan?.target1);
      if (!(entryLow > 0 && entryHigh >= entryLow && stop > 0 && stop < entryLow && target1 > entryLow)) {
        throw new Error(`RR68_CHALLENGER_TRADE_PLAN_INVALID:${item.ticker || 'UNKNOWN'}`);
      }

      candidates.push(normalizeCandidate({
        ...item,
        candidateSource: EXPECTED_RR68_CHALLENGER,
        challengerResearchOnly: true
      }));
    }

    return Object.freeze({
      published: true,
      available: true,
      status: 'RESEARCH_CHALLENGER_READY',
      id: EXPECTED_RR68_CHALLENGER,
      baseEngine: EXPECTED_ENGINE,
      mode: 'RESEARCH_ONLY',
      sessionDate,
      sessionAligned: true,
      researchOnly: true,
      executionAllowed: false,
      automaticPromotionAllowed: false,
      historicalEvidenceRef: raw.historicalEvidenceRef || null,
      policyDiff: Object.freeze({
        minStructuralNetRR: Object.freeze({
          frozenChampion: frozenRr,
          challenger: challengerRr,
          delta: safeNumber(raw?.policyDiff?.minStructuralNetRR?.delta)
        }),
        allOtherHardGates: 'UNCHANGED'
      }),
      candidates: Object.freeze(candidates),
      error: null
    });
  } catch (error) {
    return unavailableChallenger(error?.message || 'RR68_CHALLENGER_CONTRACT_FAILED', true);
  }
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${url}${url.includes('?') ? '&' : '?'}ucp=${Date.now()}`, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Rasheed-EGX-UCP/1.1-RC2-Shadow'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`RC2_HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function sessionMatches(sessionDate, expectedSession, sourceAligned = true) {
  if (!sessionDate || sourceAligned === false) return false;
  return expectedSession ? sessionDate === expectedSession : true;
}

function normalizePersistedSnapshot(payload = {}, expectedSession = null) {
  if (payload?.engine !== EXPECTED_ENGINE) throw new Error('RC2_ENGINE_ID_MISMATCH');
  if (payload?.mode !== 'RESEARCH_ONLY') throw new Error('RC2_MODE_NOT_RESEARCH_ONLY');
  if (!validateResearchPermissions(payload?.permissions)) throw new Error('RC2_PERMISSION_CONTRACT_VIOLATION');
  const sessionDate = payload.sessionDate || null;
  const sessionAligned = sessionMatches(sessionDate, expectedSession, payload.sessionAligned !== false);
  const candidates = Array.isArray(payload.recommendations) ? payload.recommendations.map(normalizeCandidate) : [];
  const marketScoreboard = Array.isArray(payload?.calibrationDiagnostics?.marketScoreboard)
    ? payload.calibrationDiagnostics.marketScoreboard.map(normalizeScoreboardRow).filter((item) => item.ticker)
    : [];
  const challenger = normalizeRr68Challenger(
    payload?.calibrationDiagnostics?.challenger || null,
    sessionDate,
    expectedSession
  );
  return Object.freeze({
    available: true,
    status: sessionAligned ? 'SHADOW_READY' : 'SHADOW_SESSION_MISMATCH',
    engineId: EXPECTED_ENGINE,
    mode: payload.mode,
    schemaVersion: payload.schemaVersion || null,
    sourceCommit: payload.sourceCommit || null,
    generatedAt: payload.generatedAt || null,
    sessionDate,
    expectedSession,
    sessionAligned,
    permissions: Object.freeze({ ...payload.permissions }),
    universe: Object.freeze({
      mode: 'PERSISTED_CURRENT_SESSION',
      sessionDate,
      currentVerifiedCandidates: safeNumber(payload.summary?.scanned),
      alphaDataBranch: null,
      overlayBranch: null
    }),
    summary: Object.freeze({
      scanned: safeNumber(payload.summary?.scanned),
      technicalEligibleTotal: safeNumber(payload.summary?.technicalEligibleTotal),
      publicationEligibleTotal: safeNumber(payload.summary?.publicationEligibleTotal),
      withheldForPriceReconciliation: safeNumber(payload.summary?.withheldForPriceReconciliation),
      rejected: safeNumber(payload.summary?.rejected),
      returned: candidates.length,
      marketSymbols: safeNumber(payload.summary?.marketSymbols)
    }),
    rejectionReasonCounts: Object.freeze({ ...(payload.rejectionReasonCounts || {}) }),
    rejectedSample: Object.freeze(Array.isArray(payload.rejectedSample) ? payload.rejectedSample.slice(0, 50).map(Object.freeze) : []),
    candidates: Object.freeze(sessionAligned ? candidates : []),
    marketScoreboard: Object.freeze(sessionAligned ? marketScoreboard : []),
    challenger: sessionAligned ? challenger : unavailableChallenger('RR68_CHALLENGER_PARENT_SESSION_MISMATCH', challenger.published),
    endpoint: DEFAULT_RC2_SNAPSHOT_URL,
    sourceType: 'PERSISTED_CURRENT_SESSION'
  });
}

function normalizeLiveScan(payload = {}, expectedSession = null, baseUrl = DEFAULT_RC2_BASE_URL) {
  if (payload?.ok !== true) throw new Error('RC2_RESPONSE_NOT_OK');
  if (payload?.engine !== EXPECTED_ENGINE) throw new Error('RC2_ENGINE_ID_MISMATCH');
  if (payload?.mode !== 'RESEARCH_ONLY') throw new Error('RC2_MODE_NOT_RESEARCH_ONLY');
  if (!validateResearchPermissions(payload?.permissions)) throw new Error('RC2_PERMISSION_CONTRACT_VIOLATION');
  const sessionDate = payload.universe?.sessionDate || null;
  const sessionAligned = sessionMatches(sessionDate, expectedSession, true);
  const candidates = Array.isArray(payload.recommendations) ? payload.recommendations.map(normalizeCandidate) : [];
  return Object.freeze({
    available: true,
    status: sessionAligned ? 'SHADOW_READY' : 'SHADOW_SESSION_MISMATCH',
    engineId: EXPECTED_ENGINE,
    mode: payload.mode,
    schemaVersion: payload.schemaVersion || null,
    sourceCommit: payload.sourceCommit || null,
    generatedAt: payload.generatedAt || null,
    sessionDate,
    expectedSession,
    sessionAligned,
    permissions: Object.freeze({ ...payload.permissions }),
    universe: Object.freeze({
      mode: payload.universe?.mode || null,
      sessionDate,
      currentVerifiedCandidates: safeNumber(payload.universe?.currentVerifiedCandidates),
      alphaDataBranch: payload.universe?.alphaDataBranch || null,
      overlayBranch: payload.universe?.overlayBranch || null
    }),
    summary: Object.freeze({
      scanned: safeNumber(payload.summary?.scanned),
      technicalEligibleTotal: safeNumber(payload.summary?.technicalEligibleTotal),
      publicationEligibleTotal: safeNumber(payload.summary?.publicationEligibleTotal),
      withheldForPriceReconciliation: safeNumber(payload.summary?.withheldForPriceReconciliation),
      rejected: safeNumber(payload.summary?.rejected),
      returned: candidates.length
    }),
    rejectionReasonCounts: Object.freeze({ ...(payload.rejectionReasonCounts || {}) }),
    rejectedSample: Object.freeze(Array.isArray(payload.rejectedSample) ? payload.rejectedSample.slice(0, 50).map(Object.freeze) : []),
    candidates: Object.freeze(sessionAligned ? candidates : []),
    marketScoreboard: Object.freeze([]),
    challenger: unavailableChallenger('RR68_CHALLENGER_REQUIRES_PERSISTED_SNAPSHOT', false),
    endpoint: baseUrl.replace(/\/$/, ''),
    sourceType: 'LIVE_SCAN_FALLBACK'
  });
}

async function loadRc2ShadowScan({
  fetchImpl = global.fetch,
  baseUrl = DEFAULT_RC2_BASE_URL,
  snapshotUrl = DEFAULT_RC2_SNAPSHOT_URL,
  expectedSession = null,
  limit = 20
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return Object.freeze({
      available: false,
      status: 'SHADOW_UNAVAILABLE',
      engineId: EXPECTED_ENGINE,
      sessionAligned: false,
      error: 'FETCH_NOT_AVAILABLE',
      candidates: Object.freeze([]),
      marketScoreboard: Object.freeze([]),
      challenger: unavailableChallenger('FETCH_NOT_AVAILABLE', false)
    });
  }

  let persistedError = null;
  try {
    const persisted = await fetchJson(snapshotUrl, fetchImpl);
    const normalized = normalizePersistedSnapshot(persisted, expectedSession);
    if (normalized.sessionAligned) return normalized;
    persistedError = new Error('RC2_PERSISTED_SESSION_MISMATCH');
  } catch (error) {
    persistedError = error;
  }

  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const url = baseUrl.replace(/\/$/, '') + `/api/index?route=scan&limit=${safeLimit}`;
  try {
    const payload = await fetchJson(url, fetchImpl);
    return normalizeLiveScan(payload, expectedSession, baseUrl);
  } catch (error) {
    return Object.freeze({
      available: false,
      status: 'SHADOW_UNAVAILABLE',
      engineId: EXPECTED_ENGINE,
      mode: 'RESEARCH_ONLY',
      sourceCommit: null,
      sessionDate: null,
      expectedSession,
      sessionAligned: false,
      error: error?.name === 'AbortError'
        ? 'RC2_TIMEOUT'
        : error?.message || persistedError?.message || 'RC2_SHADOW_ERROR',
      candidates: Object.freeze([]),
      marketScoreboard: Object.freeze([]),
      challenger: unavailableChallenger('RC2_SHADOW_UNAVAILABLE', false),
      endpoint: baseUrl.replace(/\/$/, '')
    });
  }
}

module.exports = {
  DEFAULT_RC2_BASE_URL,
  DEFAULT_RC2_SNAPSHOT_URL,
  EXPECTED_ENGINE,
  EXPECTED_RR68_CHALLENGER,
  loadRc2ShadowScan,
  normalizeCandidate,
  normalizeScoreboardRow,
  normalizePersistedSnapshot,
  normalizeLiveScan,
  normalizeRr68Challenger,
  unavailableChallenger,
  sessionMatches,
  validateResearchPermissions
};
