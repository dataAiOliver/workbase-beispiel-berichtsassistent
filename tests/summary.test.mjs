import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, requestSummary, seedReport, startApp, startFakeModel, waitForJob, withDb } from './helpers/harness.mjs';

describe('Zusammenfassung', () => {
  let fake;
  let app;
  before(async () => {
    fake = await startFakeModel();
    app = await startApp({ MODEL_ENDPOINT: fake.url });
  });
  after(async () => {
    await app?.stop();
    await fake?.close();
  });

  test('Zusammenfassung wird erstellt und im Auftrag gespeichert', async () => {
    const report = await seedReport(990101);
    fake.mode = 'ok';
    const job = await requestSummary(app.base, report.id);
    assert.ok(['queued', 'running'].includes(job.status));
    const done = await waitForJob(app.base, job.id);
    assert.equal(done.status, 'done');
    assert.equal(done.result.summary, fixture('expected-summary.json').summary);
    assert.equal(done.result.model_id, 'sim-summarize-v1');

    const sent = fake.requests.at(-1);
    assert.equal(sent.path, '/summarize');
    assert.deepEqual(sent.body, { report_id: report.id, text: report.body });

    const stored = await withDb((c) => c.query('select status, result from summary_jobs where id = $1', [job.id]));
    assert.equal(stored.rows[0].status, 'done');
    assert.deepEqual(stored.rows[0].result.key_points, fixture('expected-summary.json').key_points);
  });

  test('Modell-Timeout beendet den Auftrag mit Fehlerstatus', async () => {
    const report = await seedReport(990102, { title: 'Testbericht Timeout' });
    fake.mode = 'timeout';
    const started = Date.now();
    const job = await requestSummary(app.base, report.id);
    const final = await waitForJob(app.base, job.id, { timeoutMs: 6500 });
    assert.equal(final.status, 'failed', `Auftrag steht nach ${Math.round((Date.now() - started) / 1000)} s noch auf „${final.status}“`);
    assert.ok(Date.now() - started < 6500, 'Fehlerstatus muss innerhalb von ~6 s gesetzt sein');
    assert.ok(final.error, 'Fehlermeldung fehlt');
  });
});
