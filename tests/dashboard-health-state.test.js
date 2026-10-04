// ASTRA V4 dashboard health state validation

function resolveState({ dataHealth = {}, health = {} }) {
  if (!health || health.status === 'OFFLINE') return 'OFFLINE';
  if (dataHealth.status === 'READY' && !dataHealth.stale) return 'LIVE';
  if (dataHealth.stale) return 'DEGRADED';
  return 'WAITING';
}

const cases = [
  [{ dataHealth: { status: 'READY', stale: false }, health: {} }, 'LIVE'],
  [{ dataHealth: { status: 'READY', stale: true }, health: {} }, 'DEGRADED'],
  [{ dataHealth: { status: 'WAITING' }, health: {} }, 'WAITING'],
  [{ dataHealth: {}, health: { status: 'OFFLINE' } }, 'OFFLINE']
];

for (const [input, expected] of cases) {
  if (resolveState(input) !== expected) {
    throw new Error(`Expected ${expected}`);
  }
}

console.log('Dashboard health state validation passed');
