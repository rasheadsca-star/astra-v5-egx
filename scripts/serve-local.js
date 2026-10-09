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
const APP_VERSION = String(require('../package.json').version||'').replace(/\.0$/,'');

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
    const parsed = new URL(req.url || '/', 'http://localhost');
    const urlPath = decodeURIComponent(parsed.pathname);
    const query = Object.fromEntries(parsed.searchParams.entries());
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
        return await handler({ method: req.method, url: req.url, headers: req.headers, query }, makeRes(nodeRes));
      }
      const publicStatic =
        urlPath === '/data/decision-cockpit.json' ||
        urlPath === '/data/prospective-evidence.json' ||
        urlPath === '/data/prediction-ledger.json' ||
        urlPath === '/data/walk-forward-validation.json' ||
        urlPath === '/data/model-governance.json' ||
        urlPath.startsWith('/data/technical/') ||
        urlPath.startsWith('/data/replay/') ||
        urlPath === '/docs/data/decision-cockpit.json' ||
        urlPath === '/docs/data/prospective-evidence.json' ||
        urlPath === '/docs/data/prediction-ledger.json' ||
        urlPath === '/docs/data/walk-forward-validation.json' ||
        urlPath === '/docs/data/model-governance.json' ||
        urlPath.startsWith('/docs/data/technical/') ||
        urlPath.startsWith('/docs/data/replay/');
      if(publicStatic){
        const rel=urlPath.replace(/^\//,'');
        const file=path.resolve(ROOT,rel);
        const allowedRoot=path.resolve(ROOT,urlPath.startsWith('/docs/')?'docs/data':'data');
        if(!file.startsWith(allowedRoot+path.sep) && file!==allowedRoot){
          nodeRes.statusCode=403;return nodeRes.end('Forbidden');
        }
        if(!fs.existsSync(file)||!fs.statSync(file).isFile()){
          nodeRes.statusCode=404;return nodeRes.end('Not found');
        }
        nodeRes.setHeader('Content-Type','application/json; charset=utf-8');
        nodeRes.setHeader('Cache-Control','no-store');
        return nodeRes.end(fs.readFileSync(file));
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
    console.log(`ASTRA V${APP_VERSION} يعمل على http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log('الإيقاف: Ctrl+C');
  });
}

module.exports = { createServer, resolveApi };
