import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { URGENCIES, parseModelResponse } from '../lib/model.mjs';
import { fixture } from './helpers/harness.mjs';

describe('Modellvertrag', () => {
  test('Ergebnisstruktur entspricht Fixture', () => {
    const parsed = parseModelResponse(fixture('model-response.sim-summarize-v1.json'));
    assert.deepEqual(parsed, fixture('expected-summary.json'));
    assert.equal(typeof parsed.summary, 'string');
    assert.ok(Array.isArray(parsed.key_points) && parsed.key_points.every((p) => typeof p === 'string'));
    assert.ok(URGENCIES.includes(parsed.urgency));
  });

  test('Tokenangaben werden übernommen, wenn vorhanden', () => {
    const parsed = parseModelResponse({ ...fixture('model-response.sim-summarize-v1.json'), usage: { input_tokens: 412, output_tokens: 61 } });
    assert.deepEqual(parsed.usage, { input_tokens: 412, output_tokens: 61 });
  });

  test('Antwort ohne Zusammenfassung wird abgelehnt', () => {
    assert.throws(() => parseModelResponse({ model_id: 'sim-summarize-v1', output: { key_points: [] } }));
  });
});
