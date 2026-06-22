#!/usr/bin/env node
// Zero-dep static server for the built mini-app (apps/miniapp/dist), used to
// serve the React SPA on the browser (coffee.robinco.dev via Cloudflare Tunnel).
// SPA fallback to index.html; hash routing needs no special rewrites.
//   PORT=3020 node apps/miniapp/scripts/serve-static.mjs apps/miniapp/dist
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const DIST = process.argv[2] || 'dist';
const PORT = Number(process.env.PORT || 3020);
const HOST = process.env.HOST || '127.0.0.1';
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, rel);
    let s = null;
    try { s = await stat(file); } catch { /* missing */ }
    if (!s || s.isDirectory()) file = join(DIST, 'index.html'); // SPA fallback
    const isHtml = extname(file) === '.html';
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      'cache-control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(500);
    res.end('server error');
  }
}).listen(PORT, HOST, () => console.log(`brewdial web: serving ${DIST} on http://${HOST}:${PORT}`));
