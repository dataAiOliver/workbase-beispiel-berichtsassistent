// Elbservice Berichtsassistent – HTTP-Server (node:http)
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool, migrate } from './lib/db.mjs';
import { getJob, getReport, listReports } from './lib/reports.mjs';
import { startSummary } from './lib/jobs.mjs';
import { modelEndpoint } from './lib/model.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT);
const HOST = process.env.HOST || '127.0.0.1';
if (!PORT) {
  console.error('PORT ist nicht gesetzt.');
  process.exit(1);
}

function resolveCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return process.env.WORKBASE_COMMIT || null;
  }
}

const META = {
  project: process.env.WORKBASE_PROJECT || 'elbservice-support',
  stage: process.env.WORKBASE_STAGE || null,
  dataset: process.env.WORKBASE_DATASET_LABEL || null,
  commit: resolveCommit(),
};

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
let dbReady = false;

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) return sendJson(res, 404, { error: 'not_found' });
  try {
    const body = await readFile(join(PUBLIC, rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    if (!extname(rel)) {
      res.writeHead(200, { 'content-type': TYPES['.html'] });
      return res.end(await readFile(join(PUBLIC, 'index.html')));
    }
    sendJson(res, 404, { error: 'not_found' });
  }
}

function db(res) {
  const pool = getPool();
  if (!pool || !dbReady) {
    sendJson(res, 503, { error: 'database_unavailable', message: 'Die Berichtsdatenbank ist nicht erreichbar.' });
    return null;
  }
  return pool;
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;

  if (pathname === '/__health') return sendJson(res, 200, { ok: true, ...META });
  if (pathname === '/__workbase/telemetry' && req.method === 'POST') {
    req.resume();
    res.writeHead(204);
    return res.end();
  }
  console.log(req.method + ' ' + pathname);
  if (pathname === '/api/meta') return sendJson(res, 200, { ...META, model_configured: Boolean(modelEndpoint()) });

  if (pathname === '/api/reports' && req.method === 'GET') {
    const pool = db(res);
    if (!pool) return;
    return sendJson(res, 200, { reports: await listReports(pool) });
  }
  let m = pathname.match(/^\/api\/reports\/(\d+)$/);
  if (m && req.method === 'GET') {
    const pool = db(res);
    if (!pool) return;
    const report = await getReport(pool, Number(m[1]));
    return report ? sendJson(res, 200, { report }) : sendJson(res, 404, { error: 'not_found', message: 'Bericht nicht gefunden' });
  }
  m = pathname.match(/^\/api\/reports\/(\d+)\/summarize$/);
  if (m && req.method === 'POST') {
    req.resume();
    const pool = db(res);
    if (!pool) return;
    if (!modelEndpoint()) return sendJson(res, 503, { error: 'model_not_configured', message: 'Die Modellfunktion ist nicht konfiguriert.' });
    const report = await getReport(pool, Number(m[1]));
    if (!report) return sendJson(res, 404, { error: 'not_found', message: 'Bericht nicht gefunden' });
    const job = await startSummary(pool, report);
    return sendJson(res, 202, { job });
  }
  m = pathname.match(/^\/api\/jobs\/([0-9a-f-]+)$/i);
  if (m && req.method === 'GET') {
    const pool = db(res);
    if (!pool) return;
    const job = await getJob(pool, m[1]);
    return job ? sendJson(res, 200, { job }) : sendJson(res, 404, { error: 'not_found', message: 'Auftrag nicht gefunden' });
  }
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found' });
  return serveStatic(res, pathname);
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.log(JSON.stringify({ level: 'error', msg: err.message }));
    if (!res.headersSent) sendJson(res, 500, { error: 'internal_error', message: 'Interner Fehler' });
    else res.end();
  });
});

async function start() {
  const pool = getPool();
  if (pool) {
    try {
      const client = await pool.connect();
      try {
        await migrate(client);
        dbReady = true;
      } finally {
        client.release();
      }
    } catch (err) {
      console.log('Datenbank nicht erreichbar', err.message);
    }
  }
  server.listen(PORT, HOST, () => console.log(`Berichtsassistent läuft auf http://${HOST}:${PORT}`));
}

function shutdown() {
  server.close();
  closePool().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
