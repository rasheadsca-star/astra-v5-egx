// ASTRA V4 Dashboard page controller
// Connects dashboard UI contracts with API data.

import { buildDashboardState } from './dashboard-model.js';
import { createStatusCard } from './components/status-card.js';
import { createRecommendationCard } from './components/recommendation-card.js';

function resolveEngineStatus(health = {}, dataHealth = {}, systemHealth = {}) {
  if (systemHealth?.healthy === false) {
    return 'OFFLINE';
  }

  if (dataHealth?.status === 'WAITING' || dataHealth?.status === 'NO_LIVE_SNAPSHOT') {
    return 'WAITING';
  }

  if (dataHealth?.stale === true) {
    return 'DEGRADED';
  }

  if (health?.status === 'OFFLINE' || health?.success === false) {
    return 'OFFLINE';
  }

  if (dataHealth?.live === true || dataHealth?.status === 'READY') {
    return 'LIVE';
  }

  return 'UNKNOWN';
}

export async function loadDashboard() {
  const [healthResponse, recommendationsResponse, dataHealthResponse, systemHealthResponse] = await Promise.all([
    fetch('/api/engine-status', { cache: 'no-store' }),
    fetch('/api/recommendations', { cache: 'no-store' }),
    fetch('/api/data-health', { cache: 'no-store' }),
    fetch('/api/system-health', { cache: 'no-store' })
  ]);

  const health = await healthResponse.json();
  const recommendations = await recommendationsResponse.json();
  const dataHealth = await dataHealthResponse.json();
  const systemHealth = await systemHealthResponse.json();

  const state = buildDashboardState({
    health,
    recommendations,
    dataHealth,
    systemHealth
  });

  const engineStatus = resolveEngineStatus(health, dataHealth, systemHealth);

  return {
    status: createStatusCard('ASTRA Engine', engineStatus, {
      ...state.health,
      systemHealth,
      dataState: dataHealth.status || 'UNKNOWN',
      lastUpdate: dataHealth.lastUpdate || dataHealth.updatedAt || systemHealth.checkedAt || null
    }),
    engineStatus,
    systemHealth,
    dataStatus: dataHealth,
    recommendations: state.opportunities.map(createRecommendationCard),
    updatedAt: dataHealth.lastUpdate || dataHealth.updatedAt || systemHealth.checkedAt || new Date().toISOString()
  };
}
