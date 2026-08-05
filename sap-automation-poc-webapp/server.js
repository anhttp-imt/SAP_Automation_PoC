// Static file server for the SAP Automation PoC Web App (with MongoDB backend).
// Must run on http://localhost:8787 - this exact origin is whitelisted in the
// extension's manifest.json "externally_connectable.matches".
const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./db');

// Routes
const reportsRoutes = require('./routes/reports');
const objectsRoutes = require('./routes/objects');
const testcasesRoutes = require('./routes/testcases');
const testsuitesRoutes = require('./routes/testsuites');

const PORT = 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Route handlers in order
const routes = [reportsRoutes, objectsRoutes, testcasesRoutes, testsuitesRoutes];

const server = http.createServer(async (req, res) => {
  // Try each route module
  for (const route of routes) {
    if (await route.handle(req, res, { parseBody, sendJSON })) {
      return;
    }
  }

  // ---- Static File Serving ----
  const urlPath = req.url.split('?')[0];
  const safePath = path.normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' };
    // Disable caching for JS/CSS/HTML during development
    if (['.js', '.css', '.html'].includes(ext)) {
      headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, proxy-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

// Connect to database (MongoDB or JSON fallback) on startup
db.connect();

server.listen(PORT, () => {
  console.log(`SAP Automation PoC Web App: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await db.close();
  server.close(() => process.exit(0));
});

process.on('SIGTERM', async () => {
  await db.close();
  server.close(() => process.exit(0));
});