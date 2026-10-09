const pkg = require('../package.json');
const fs = require('fs');

const requiredFiles = [
  'app/dashboard/command-center.html',
  'app/dashboard/dashboard-page.js',
  'app/api/recommendations.js',
  'app/api/data-health.js',
  'app/api/system-health.js',
  'engine/runtime-pipeline.js',
  'data-engine/providers/egx-data-provider.js',
  'scripts/risk-state-override-engine.js',
  'scripts/archive-trust-snapshot.js',
  'scripts/walk-forward-validation.js',
  'scripts/model-governance-engine.js',
  'scripts/release-integrity-audit.js',
  'scripts/lib/technical-indicators.js',
  'scripts/run-node-validation-suite.js',
  'scripts/static-quality-validation.js',
  'config/node-validation-suite.json',
  'scripts/lib/operations-health.js',
  'scripts/operations-health-engine.js',
  'docs/health.html'
];

const missing = requiredFiles.filter((file) => !fs.existsSync(file));

if (missing.length) {
  console.error(`ASTRA V${pkg.version} build check failed`);
  console.error('Missing files:', missing);
  process.exit(1);
}

console.log(`ASTRA V${pkg.version} build check passed`);
console.log(`Verified ${requiredFiles.length} core files`);
