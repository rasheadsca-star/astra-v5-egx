'use strict';

// ASTRA V5 — Quant adapter / API contract validation (fail-closed behaviour).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildQuantBoard, validateCandidate, loadQuantBoard, SCHEMA } = require('../engine/ucp/quant-adapter');
const handler = require('../app/api/quant');

function candidate(over = {}) {
  return {
    ticker: 'ABCD', rank: 1, tier: 'C', entryLow: 99, entryHigh: 101, close: 100, stop: 96.5, target1: 103, target2: 106,
    stopPct: 3.5, target1Pct: 3, target2Pct: 6, rr1: 0.86, rr2: 1.7, sizePct: 4, horizonSessions: 10, manage: 'x', setups: [],
    liquidity: { tier: 'عالية', turnoverM: 30, maxPositionEgp: 1500000 }, notes: [], ...over
  };
}
function payload(over = {}) {
  return {
    schemaVersion: SCHEMA, session: '2026-10-01', expectedSession: '2026-10-01', stale: false, regime: 'هابط',
    permissions: { researchOnly: true, executionAllowed: false, productionAllocation: false, automaticOrders: false },
    candidates: [candidate()], plan: { top: { hit1: 66 } }, evidence: {}, promotion: { eligible: false, status: 'FORWARD_VALIDATION_REQUIRED' }, forward: {}, generatedAt: 'x', ...over
  };
}
function call(fn) {
  return new Promise((resolve) => {
    const out = { headers: {} };
    fn({}, { setHeader: (k, v) => { out.headers[k] = v; }, status: (c) => ({ json: (b) => resolve({ code: c, body: b, headers: out.headers }) }) });
  });
}

async function main() {
  // 1) حمولة سليمة ومحاذية
  let b = buildQuantBoard({ payload: payload(), expectedSession: '2026-10-01' });
  assert.strictEqual(b.status, 'READY'); assert.strictEqual(b.candidates.length, 1); assert.strictEqual(b.sessionAligned, true);
  assert.strictEqual(b.executionAllowed, false); assert.strictEqual(b.candidates[0].executionAllowed, false);

  // 2) جلسة غير محاذية لجلسة ASTRA => لا مرشحين، الأسباب ظاهرة، العدد المحجوب محفوظ
  b = buildQuantBoard({ payload: payload({ session: '2026-09-30' }), expectedSession: '2026-10-01' });
  assert.strictEqual(b.status, 'MISALIGNED'); assert.deepStrictEqual(b.candidates, []); assert.strictEqual(b.withheldCount, 1);
  assert.ok(b.reasons.includes('QUANT_SESSION_NOT_ALIGNED')); assert.strictEqual(b.sessionDate, '2026-09-30');

  // 3) بيانات متقادمة => STALE ولا مرشحين
  b = buildQuantBoard({ payload: payload({ stale: true }), expectedSession: '2026-10-01' });
  assert.strictEqual(b.status, 'STALE'); assert.strictEqual(b.candidates.length, 0);

  // 4) مخطط خاطئ / صلاحيات مخالفة => INVALID
  assert.strictEqual(buildQuantBoard({ payload: payload({ schemaVersion: 'x' }), expectedSession: '2026-10-01' }).status, 'INVALID');
  for (const key of ['executionAllowed', 'automaticOrders', 'productionAllocation']) {
    const bad = payload(); bad.permissions[key] = true;
    const r = buildQuantBoard({ payload: bad, expectedSession: '2026-10-01' });
    assert.strictEqual(r.status, 'INVALID'); assert.ok(r.reasons.includes('QUANT_PERMISSION_BREACH')); assert.strictEqual(r.executionAllowed, false);
  }

  // 5) غياب الحمولة أو غياب الجلسة المتوقعة => لا مرشحين
  assert.strictEqual(buildQuantBoard({ payload: null, expectedSession: '2026-10-01' }).status, 'UNAVAILABLE');
  b = buildQuantBoard({ payload: payload({ expectedSession: null }), expectedSession: null });
  assert.strictEqual(b.candidates.length, 0); assert.ok(b.reasons.includes('EXPECTED_SESSION_MISSING'));

  // 6) مرشح بمستويات منهارة (مثل سهم 0.71 ج بخانتين عشريتين) يُرفض وحده
  assert.deepStrictEqual(validateCandidate(candidate({ target1: 101 })), ['TARGET1_NOT_ABOVE_ENTRY']);
  assert.ok(validateCandidate(candidate({ stop: 99.5 })).includes('STOP_NOT_BELOW_ENTRY'));
  assert.ok(validateCandidate(candidate({ ticker: 'bad sym' })).includes('TICKER_INVALID'));
  assert.ok(validateCandidate(candidate({ liquidity: {} })).includes('LIQUIDITY_TIER_MISSING'));
  b = buildQuantBoard({ payload: payload({ candidates: [candidate(), candidate({ ticker: 'WXYZ', target1: 100.5 })] }), expectedSession: '2026-10-01' });
  assert.strictEqual(b.status, 'READY'); assert.strictEqual(b.candidates.length, 1); assert.strictEqual(b.rejectedCandidates[0].ticker, 'WXYZ');

  // 7) ملف على القرص + جلسة ASTRA القانونية
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-'));
  const f = path.join(dir, 'signals.json'); const c = path.join(dir, 'canonical.json');
  fs.writeFileSync(f, JSON.stringify(payload())); fs.writeFileSync(c, JSON.stringify({ source: { expectedSession: '2026-10-01' } }));
  assert.strictEqual(loadQuantBoard({ file: f, canonicalFile: c }).status, 'READY');
  fs.writeFileSync(c, JSON.stringify({ source: { expectedSession: '2026-10-02' } }));
  assert.strictEqual(loadQuantBoard({ file: f, canonicalFile: c }).status, 'MISALIGNED');
  assert.strictEqual(loadQuantBoard({ file: path.join(dir, 'none.json'), canonicalFile: c }).status, 'UNAVAILABLE');

  // 8) نقطة الـAPI: دائماً 200، بلا تخزين مؤقت، executionAllowed=false
  const res = await call(handler);
  assert.strictEqual(res.code, 200); assert.strictEqual(res.body.executionAllowed, false); assert.match(res.headers['Cache-Control'], /no-store/);

  // 9) عقد البيانات المنشورة فعلاً في المستودع
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'quant', 'signals.json'), 'utf8'));
  assert.strictEqual(real.schemaVersion, SCHEMA); assert.strictEqual(real.permissions.executionAllowed, false);
  assert.ok(real.promotion.policy.minForwardSessions >= 30);
  for (const cand of real.candidates) assert.deepStrictEqual(validateCandidate(cand), [], cand.ticker);

  console.log('ASTRA quant adapter validation passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
