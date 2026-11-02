import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { seedReport, startApp } from './helpers/harness.mjs';

describe('API und Betrieb', () => {
  let app;
  before(async () => {
    await seedReport(990001, { title: 'Testbericht Liste', equipment: 'Aufzug' });
    app = await startApp({ MODEL_ENDPOINT: 'http://127.0.0.1:9/unused' });
  });
  after(async () => {
    await app?.stop();
  });

  test('Berichtsliste und Detail liefern den Testbericht', async () => {
    const list = await (await fetch(`${app.base}/api/reports`)).json();
    const item = list.reports.find((r) => r.id === 990001);
    assert.ok(item, 'Testbericht fehlt in der Liste');
    assert.equal(item.equipment, 'Aufzug');
    const detail = await (await fetch(`${app.base}/api/reports/990001`)).json();
    assert.equal(detail.report.title, 'Testbericht Liste');
    assert.ok(Array.isArray(detail.report.jobs));
    assert.equal((await fetch(`${app.base}/api/reports/123456789`)).status, 404);
  });

  test('Health-Endpunkt meldet ausgelieferten Commit', async () => {
    const res = await fetch(`${app.base}/__health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(body.commit === null || /^[0-9a-f]{40}$/.test(body.commit));
    const t = await fetch(`${app.base}/__workbase/telemetry`, { method: 'POST', body: '{}' });
    assert.equal(t.status, 204);
  });
});
