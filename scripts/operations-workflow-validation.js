'use strict';
const fs=require('fs'),assert=require('assert');

const watch=fs.readFileSync('.github/workflows/operations-watch.yml','utf8');
const daily=fs.readFileSync('.github/workflows/daily-egx-data-refresh.yml','utf8');
const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const health=fs.readFileSync('docs/health.html','utf8');

assert.match(watch,/issues:\s*write/);
assert.match(watch,/workflow_run:/);
assert.match(watch,/Daily EGX Data Refresh/);
assert.match(watch,/issues\.create/);
assert.match(watch,/issues\.update/);
assert.match(watch,/state:'closed'/);
assert.doesNotMatch(watch,/git push/);
assert.match(daily,/operations-health-engine\.js --summary/);
assert.match(daily,/data\/operations-health\.json/);
assert.ok((vercel.rewrites||[]).some(x=>x.source==='/health'&&x.destination==='/docs/health.html'));
assert.match(health,/data\/operations-health\.json/);
assert.match(health,/Automatic execution OFF/);

console.log(JSON.stringify({ok:true,workflow:'ASTRA Operations Watch',healthRoute:'/health',issuesPermission:'write'},null,2));
