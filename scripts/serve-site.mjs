#!/usr/bin/env node
/**
 * Minimal static file server for the site/ directory.
 * Usage: node scripts/serve-site.mjs [port]
 */
import { createServer } from 'http';
import { createReadStream, existsSync, statSync } from 'fs';
import { join, extname } from 'path';

const PORT = parseInt(process.argv[2] || '8080', 10);
const ROOT = new URL('../site', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let filePath = join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);

  // Prevent path traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Serve index.html for directories
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const ct = MIME[extname(filePath)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': ct });
  createReadStream(filePath).pipe(res);
}).listen(PORT, () => {
  console.log(`Site: http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard.html`);
});
