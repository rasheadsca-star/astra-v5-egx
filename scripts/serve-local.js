'use strict';

// خادم محلي بلا اعتمادات: يعرض لوحة القيادة ويوجّه /api/* إلى نفس معالجات Vercel.
//   npm start            ->  http://localhost:3000
//   PORT=8080 npm start
// بدونه لا تعمل اللوحة بفتح الملف مباشرة لأنها تستدعي /api/*.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DASHBOARD = path.join(ROOT, 'app', 'dashboard', 'command-center.html');

function makeRes(nodeRes) {
  const res = {
    setHeader: (k, v) => nodeRes.setHeader(k, v),
    status(code) {
      nodeRes.statusCode = code;
      return {
        json(body) { nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8'); nodeRes.end(JSON.stringify(body)); },
        send(body) { nodeRes.end(typeof body === 'string' ? body : JSON.stringify(body)); },
        end(body) { nodeRes.end(body); }
      };
    }
  };
  return res;
}

function resolveApi(urlPath) {
  const name = urlPath.replace(/^\/api\//, '').replace(/\/+$/, '');
  if (!/^[a-z0-9-]+$/i.test(name)) return null;
  const file = path.join(ROOT, 'api', name + '.js');
  return fs.existsSync(file) ? file : null;
}

function createServer() {
  return http.createServer(async (req, nodeRes) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    try {
      if (urlPath === '/' || urlPath === '/index.html') {
        nodeRes.setHeader('Content-Type', 'text/html; charset=utf-8');
        nodeRes.setHeader('Cache-Control', 'no-store');
        return nodeRes.end(fs.readFileSync(DASHBOARD));
      }
      if (urlPath.startsWith('/api/')) {
        const file = resolveApi(urlPath);
        if (!file) { nodeRes.statusCode = 404; return nodeRes.end(JSON.stringify({ error: 'NOT_FOUND' })); }
        const handler = require(file);
        return await handler({ method: req.method, url: req.url, headers: req.headers, query: {} }, makeRes(nodeRes));
      }
      nodeRes.statusCode = 404;
      return nodeRes.end('Not found');
    } catch (error) {
      nodeRes.statusCode = 500;
      nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
      return nodeRes.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`ASTRA V5 يعمل على http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log('الإيقاف: Ctrl+C');
  });
}

module.exports = { createServer, resolveApi };
