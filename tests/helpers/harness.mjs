// Testumgebung: echte Datenbank (DATABASE_URL), App als Kindprozess, Fake-Modellfunktion per node:http.
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from '../../lib/db.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const fixture = (name) => JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', name), 'utf8'));

export async function withDb(fn) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ist für die Tests erforderlich');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Legt (wiederholbar) einen Testbericht mit fester Id an. */
export async function seedReport(id, overrides = {}) {
  return withDb(async (client) => {
    await migrate(client);
    const r = {
      report_no: `TEST-${id}`,
      technician: 'Testtechniker',
      customer: 'Testkunde GmbH',
      site: 'Teststraße 1, 21073 Hamburg',
      equipment: 'Kälteanlage',
      visited_on: '2026-11-12',
      title: 'Testbericht Kälteanlage',
      body: 'Verflüssiger gereinigt, Hochdruck wieder im Sollbereich. Lüftermotor mit Lagergeräusch.',
      ...overrides,
    };
    await client.query(
      `insert into service_reports (id, report_no, technician, customer, site, equipment, visited_on, title, body)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (id) do update set report_no = excluded.report_no, title = excluded.title, body = excluded.body`,
      [id, r.report_no, r.technician, r.customer, r.site, r.equipment, r.visited_on, r.title, r.body],
    );
    return { id, ...r };
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Fake der Modellfunktion (Vertrag wie der Plattform-Simulator).
 * mode: 'ok' | 'error' (500) | 'timeout' (hält ~8 s, dann 504)
 */
export async function startFakeModel({ mode = 'ok', holdMs = 8000 } = {}) {
  const requests = [];
  const timers = new Set();
  const fake = { mode, requests, url: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const entry = { method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      requests.push(entry);
      const send = (status, body) => {
        if (res.destroyed) return;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'POST' || req.url !== '/summarize') return send(404, { error: 'not_found' });
      if (fake.mode === 'error') return send(500, { error: 'simulated_error' });
      if (fake.mode === 'timeout') {
        const t = setTimeout(() => { timers.delete(t); send(504, { error: 'upstream_timeout' }); }, holdMs);
        timers.add(t);
        return;
      }
      send(200, fixture('model-response.sim-summarize-v1.json'));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.close = () => new Promise((resolve) => {
    for (const t of timers) clearTimeout(t);
    server.closeAllConnections();
    server.close(() => resolve());
  });
  return fake;
}

/** Startet `node server.mjs` mit eigener Umgebung und sammelt stdout-Zeilen. */
export async function startApp(env = {}) {
  const port = await freePort();
  const lines = [];
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', WORKBASE_STAGE: 'test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      lines.push(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`App beendet sich beim Start: ${stderr}`);
    try {
      const res = await fetch(`${base}/__health`);
      if (res.ok) break;
    } catch { /* startet noch */ }
    if (Date.now() > deadline) throw new Error('App startet nicht innerhalb von 15 s');
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    lines,
    stop: () => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }),
  };
}

/** Fragt den Auftrag ab, bis er done/failed ist oder die Frist abläuft; liefert den letzten Stand. */
export async function waitForJob(base, jobId, { timeoutMs = 6500, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let job;
  for (;;) {
    const res = await fetch(`${base}/api/jobs/${jobId}`);
    job = (await res.json()).job;
    if (job.status === 'done' || job.status === 'failed' || Date.now() > deadline) return job;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function requestSummary(base, reportId, headers = {}) {
  const res = await fetch(`${base}/api/reports/${reportId}/summarize`, { method: 'POST', headers });
  if (res.status !== 202) throw new Error(`summarize antwortet mit ${res.status}: ${await res.text()}`);
  return (await res.json()).job;
}
