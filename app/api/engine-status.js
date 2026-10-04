export function getEngineStatus() {
  return {
    dataEngine: 'READY',
    analysisEngine: 'READY',
    recommendationEngine: 'READY',
    lastUpdate: new Date().toISOString()
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');

  res.status(200).json({
    success: true,
    environment: 'production',
    ...getEngineStatus()
  });
}
