export async function loadEngineStatus() {
  const response = await fetch('/api/engine-status');
  if (!response.ok) throw new Error('Engine status unavailable');
  return response.json();
}

export async function loadRecommendations() {
  const response = await fetch('/api/recommendations');
  if (!response.ok) throw new Error('Recommendations unavailable');
  return response.json();
}
