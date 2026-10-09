'use strict';

// التحقق من الخادم المحلي: اللوحة و/api/quant و404 وحجب المسارات الخارجية.
const assert = require('assert');
const http = require('http');
const { createServer, resolveApi } = require('./serve-local');
const pkg = require('../package.json');

function get(port, p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ code: res.statusCode, type: res.headers['content-type'] || '', body }));
    }).on('error', reject);
  });
}

(async () => {
  assert.ok(resolveApi('/api/quant'));
  assert.strictEqual(resolveApi('/api/../package'), null);
  assert.strictEqual(resolveApi('/api/..%2f..%2fpackage'), null);
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const home = await get(port, '/');
    assert.strictEqual(home.code, 200); assert.match(home.type, /text\/html/); assert.ok(home.body.includes(`ASTRA V${pkg.version} Decision Cockpit`));
    const q = await get(port, '/api/quant');
    assert.strictEqual(q.code, 200); assert.match(q.type, /application\/json/);
    const body = JSON.parse(q.body);
    assert.strictEqual(body.executionAllowed, false); assert.ok(['READY', 'MISALIGNED', 'STALE', 'UNAVAILABLE', 'INVALID'].includes(body.status));
    assert.strictEqual((await get(port, '/api/nope')).code, 404);
    assert.strictEqual((await get(port, '/package.json')).code, 404);
    assert.strictEqual((await get(port, '/data/quant/signals.json')).code, 404);
  } finally {
    server.close();
  }
  console.log('ASTRA local server validation passed');
})().catch((e) => { console.error(e); process.exit(1); });
