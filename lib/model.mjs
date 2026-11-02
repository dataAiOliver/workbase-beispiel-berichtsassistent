// Modellfunktion „service_report_summary“: POST {MODEL_ENDPOINT}/summarize
export const URGENCIES = ['niedrig', 'mittel', 'hoch'];

export function modelEndpoint() {
  const base = process.env.MODEL_ENDPOINT;
  return base ? base.replace(/\/+$/, '') : null;
}

/** Wandelt die Antwort der Modellfunktion in das gespeicherte Ergebnisformat um. */
export function parseModelResponse(data) {
  const out = data?.output;
  if (!out || typeof out.summary !== 'string' || !out.summary.trim()) {
    throw new Error('Antwort der Modellfunktion enthält keine Zusammenfassung');
  }
  const usage = data.usage ?? (data.input_tokens != null || data.output_tokens != null ? data : null);
  return {
    summary: out.summary.trim(),
    key_points: Array.isArray(out.key_points) ? out.key_points.map((p) => String(p).trim()).filter(Boolean) : [],
    urgency: URGENCIES.includes(out.urgency) ? out.urgency : 'mittel',
    model_id: data.model_id ?? null,
    fixture_id: data.fixture_id ?? null,
    usage: usage ? { input_tokens: usage.input_tokens ?? null, output_tokens: usage.output_tokens ?? null } : null,
  };
}

export async function summarizeReport(report) {
  const res = await fetch(`${modelEndpoint()}/summarize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ report_id: report.id, text: report.body }),
  });
  if (!res.ok) throw new Error('Modellfunktion antwortet mit Status ' + res.status);
  const data = await res.json();
  console.log(JSON.stringify({ msg: 'model response', model: data.model_id }));
  return parseModelResponse(data);
}
