// ASTRA V4 dashboard status card component contract

export function createStatusCard(title, status, details = {}, systemHealth = {}) {
  return {
    title,
    status,
    details,
    system: {
      healthy: systemHealth.healthy ?? null,
      pipeline: systemHealth.pipeline || null,
      dataEngine: systemHealth.dataEngine || null,
      liveFeed: systemHealth.liveFeed || null,
      recommendations: systemHealth.recommendations ?? null
    },
    dataState: details.dataState || details.status || systemHealth.pipeline || 'UNKNOWN',
    lastUpdate: details.lastUpdate || details.updatedAt || systemHealth.checkedAt || null
  };
}
