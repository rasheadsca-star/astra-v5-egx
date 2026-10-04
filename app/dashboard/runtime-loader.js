import { getDashboardData } from './api-client.js';

export async function loadDashboard() {
  const data = await getDashboardData();
  return {
    engine: data.engine || 'UNKNOWN',
    recommendations: data.recommendations || []
  };
}
