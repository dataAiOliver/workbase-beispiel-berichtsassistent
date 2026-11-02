// Führt alle node:test-Tests aus und schreibt den Workbase-Testbericht.
import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = resolve(root, process.env.WORKBASE_TEST_REPORT || '.workbase/test-report.json');
const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join(root, 'tests', f));

const started = performance.now();
const tests = [];
const suites = new Map(); // file -> [names nach Ebene]
const rel = (f) => (f ? relative(root, f).replaceAll('\\', '/') : null);
const clean = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

function record(data, status) {
  if (data.details?.type === 'suite') return;
  const stack = suites.get(data.file) ?? [];
  const err = data.details?.error;
  const cause = err?.cause ?? err;
  tests.push({
    suite: stack.slice(0, data.nesting).filter(Boolean).join(' › ') || rel(data.file),
    name: data.name,
    file: rel(data.file),
    status,
    duration_ms: Math.round(data.details?.duration_ms ?? 0),
    error: status === 'failed' ? clean(cause?.message ?? err?.message ?? 'Test fehlgeschlagen').split('\n').slice(0, 6).join('\n').slice(0, 600) : null,
  });
}

let failedRun = false;
const stream = run({ files, concurrency: 1, timeout: 60_000 });
stream.on('test:start', (data) => {
  const stack = suites.get(data.file) ?? [];
  stack[data.nesting] = data.name;
  stack.length = data.nesting + 1;
  suites.set(data.file, stack);
});
stream.on('test:pass', (data) => record(data, data.skip || data.todo ? 'skipped' : 'passed'));
stream.on('test:fail', (data) => {
  failedRun = true;
  record(data, 'failed');
});
stream.compose(spec).pipe(process.stdout);

stream.on('end', () => {
  const report = {
    tool: 'node:test',
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => t.status === 'failed').length,
    skipped: tests.filter((t) => t.status === 'skipped').length,
    duration_ms: Math.round(performance.now() - started),
    tests,
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nTestbericht: ${relative(root, reportPath)} (${report.passed} bestanden, ${report.failed} fehlgeschlagen, ${report.skipped} übersprungen)`);
  process.exitCode = failedRun || report.failed ? 1 : 0;
});
