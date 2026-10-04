const state = {
  status: 'INITIALIZED',
  data: false,
  engine: false,
  recommendations: false,
  updatedAt: new Date().toISOString()
};

console.log(JSON.stringify(state, null, 2));
