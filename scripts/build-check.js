const fs = require('fs');

const requiredFiles = [
  'app/dashboard/command-center.html',
  'app/dashboard/dashboard-page.js',
  'app/api/recommendations.js',
  'app/api/data-health.js',
  'app/api/system-health.js',
  'engine/runtime-pipeline.js',
  'data-engine/providers/egx-data-provider.js'
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));

if (missing.length) {
  console.error('ASTRA V4 build check failed');
  console.error('Missing files:', missing);
  process.exit(1);
}

console.log('ASTRA V4 build check passed');
console.log(`Verified ${requiredFiles.length} core files`);
