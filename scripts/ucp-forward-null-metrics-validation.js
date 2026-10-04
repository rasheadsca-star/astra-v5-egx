'use strict';

const assert = require('assert');
const {
  summarizeForwardLedger,
  evaluatePromotionEligibility
} = require('../engine/ucp/forward-governance');

const summary = summarizeForwardLedger({
  entries: [{
    sessionDate: '2026-10-01',
    capturedAt: '2026-10-01T22:44:17.332Z',
    outcomes: [],
    criticalBreaches: []
  }]
});

assert.strictEqual(summary.forwardSessions, 1);
assert.strictEqual(summary.resolvedTrades, 0);
assert.strictEqual(summary.profitFactor, null);
assert.strictEqual(summary.averageNetReturnPct, null);

const promotion = evaluatePromotionEligibility(summary);
assert.strictEqual(promotion.eligible, false);
assert.ok(promotion.blockers.includes('PROFIT_FACTOR_NOT_ESTABLISHED'));
assert.ok(promotion.blockers.includes('AVERAGE_NET_RETURN_NOT_ESTABLISHED'));
assert.ok(!promotion.blockers.includes('PROFIT_FACTOR_BELOW_POLICY'));
assert.ok(!promotion.blockers.includes('AVERAGE_NET_RETURN_NOT_POSITIVE'));
assert.strictEqual(promotion.automaticPromotionAllowed, false);
assert.strictEqual(promotion.executionAllowed, false);

console.log('Rasheed EGX UCP null forward metrics validation passed');
