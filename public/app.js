// Elbservice Berichtsassistent – Berichte ansehen und zusammenfassen lassen
const $ = (sel) => document.querySelector(sel);
const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
const dateTimeFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const JOB_LABEL = { queued: 'Wartet', running: 'Läuft', done: 'Zusammengefasst', failed: 'Fehlgeschlagen' };
const URGENCY_LABEL = { niedrig: 'Dringlichkeit niedrig', mittel: 'Dringlichkeit mittel', hoch: 'Dringlichkeit hoch' };
const POLL_MS = 1000;

const state = {
  reports: [],
  query: '',
  listError: null,
  current: null, // vollständiger Bericht inkl. jobs
  detailError: null,
  detailLoading: false,
  job: null, // aktueller Auftrag
  starting: false,
  pollTimer: null,
  tickTimer: null,
};

// ---------- Telemetrie ----------
function beacon(event, data = {}) {
  try {
    const body = JSON.stringify({ event, severity: data.severity ?? 'info', outcome: data.outcome ?? 'ok', duration_ms: data.duration_ms ?? null, trace_id: data.trace_id ?? null, message: data.message ?? event, attrs: data.attrs ?? {} });
    navigator.sendBeacon?.('/__workbase/telemetry', new Blob([body], { type: 'application/json' }));
  } catch { /* ignorieren */ }
}
window.addEventListener('error', (e) => beacon('ui.error', { severity: 'error', outcome: 'error', message: String(e.message) }));
window.addEventListener('unhandledrejection', (e) => beacon('ui.error', { severity: 'error', outcome: 'error', message: String(e.reason?.message ?? e.reason) }));

// ---------- Hilfen ----------
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { accept: 'application/json', ...(options.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.message || `Anfrage fehlgeschlagen (${res.status})`), { status: res.status });
  return body;
}

function secondsSince(iso) {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
}

function formatElapsed(s) {
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

// ---------- Liste ----------
function filteredReports() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.reports;
  return state.reports.filter((r) => [r.report_no, r.title, r.customer, r.site, r.equipment, r.technician].some((v) => String(v).toLowerCase().includes(q)));
}

function renderList() {
  const el = $('#report-list');
  el.setAttribute('aria-busy', 'false');
  if (state.listError) {
    el.innerHTML = `<li class="state is-error"><h3>Berichte nicht verfügbar</h3><p>${esc(state.listError)}</p><button class="btn btn-secondary" data-action="reload-list">Erneut laden</button></li>`;
    $('#report-count').textContent = 'Keine Verbindung';
    return;
  }
  const items = filteredReports();
  $('#report-count').textContent = state.query ? `${items.length} von ${state.reports.length} Berichten` : `${state.reports.length} Berichte, neueste zuerst`;
  if (!items.length) {
    el.innerHTML = `<li class="state"><h3>${state.reports.length ? 'Keine Treffer' : 'Noch keine Berichte'}</h3><p>${state.reports.length ? 'Suchbegriff anpassen oder leeren.' : 'Sobald Techniker Berichte erfassen, erscheinen sie hier.'}</p></li>`;
    return;
  }
  const currentId = state.current?.id;
  el.innerHTML = items.map((r) => `<li class="report-item" data-testid="report-item">
      <a href="#/bericht/${r.id}" ${r.id === currentId ? 'aria-current="true"' : ''}>
        <div class="ri-top"><span class="ri-no">${esc(r.report_no)}</span><span>${dateFmt.format(new Date(r.visited_on))}</span></div>
        <div class="ri-title">${esc(r.title)}</div>
        <div class="ri-meta">${esc(r.customer)} · ${esc(r.site)}</div>
        <div class="ri-foot"><span class="equip">${esc(r.equipment)}</span>${r.latest_job ? `<span class="pill pill-${esc(r.latest_job.status)}">${JOB_LABEL[r.latest_job.status] ?? esc(r.latest_job.status)}</span>` : ''}</div>
      </a>
    </li>`).join('');
}

async function loadReports() {
  try {
    const body = await api('/api/reports');
    state.reports = body.reports;
    state.listError = null;
  } catch (err) {
    state.listError = err.message;
  }
  renderList();
}

// ---------- Detail ----------
function renderDetail() {
  const el = $('#detail');
  const back = '<a class="back" href="#/">← Alle Berichte</a>';
  if (state.detailLoading) {
    el.innerHTML = `${back}<div class="skeleton" style="width:30%"></div><div class="skeleton" style="width:60%;height:22px"></div><div class="skeleton" style="width:90%"></div><div class="skeleton" style="width:80%"></div>`;
    return;
  }
  if (state.detailError) {
    el.innerHTML = `${back}<div class="state is-error"><h3>Bericht konnte nicht geladen werden</h3><p>${esc(state.detailError)}</p></div>`;
    return;
  }
  const r = state.current;
  if (!r) {
    el.innerHTML = `<div class="state"><h3>Bericht auswählen</h3><p>Links einen Servicebericht wählen, um ihn zu lesen und zusammenfassen zu lassen.</p></div>`;
    return;
  }
  const paragraphs = r.body.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join('');
  el.innerHTML = `${back}
    <header class="detail-head">
      <p class="eyebrow">${esc(r.report_no)} · ${esc(r.equipment)}</p>
      <h2>${esc(r.title)}</h2>
      <dl class="facts">
        <div><dt>Kunde</dt><dd>${esc(r.customer)}</dd></div>
        <div><dt>Objekt</dt><dd>${esc(r.site)}</dd></div>
        <div><dt>Techniker</dt><dd>${esc(r.technician)}</dd></div>
        <div><dt>Einsatz am</dt><dd>${dateFmt.format(new Date(r.visited_on))}</dd></div>
      </dl>
    </header>
    <div class="detail-grid">
      <article class="card report-text">
        <div class="card-head"><h3>Bericht des Technikers</h3><small>${r.body.length.toLocaleString('de-DE')} Zeichen</small></div>
        <div class="prose">${paragraphs}</div>
      </article>
      <section class="card summary" aria-labelledby="summary-title">
        <div class="card-head"><h3 id="summary-title">Zusammenfassung</h3><small>Modellfunktion</small></div>
        <div class="summary-body" id="summary-body" data-testid="summary"></div>
        <div id="summary-history"></div>
      </section>
    </div>`;
  renderSummary();
}

const ICON_SPARK = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" fill="currentColor"/></svg>';

function summarizeButton(label = 'Zusammenfassen', kind = 'btn-primary') {
  return `<button type="button" class="btn ${kind} btn-block" data-action="summarize" ${state.starting ? 'disabled' : ''}>${ICON_SPARK.replace('width="24" height="24"', 'width="16" height="16"')}${esc(label)}</button>`;
}

function renderSummary() {
  const el = $('#summary-body');
  if (!el) return;
  const job = state.job;
  if (!job) {
    el.innerHTML = `<div class="summary-empty">
        <div class="icon">${ICON_SPARK}</div>
        <h4>Noch keine Zusammenfassung</h4>
        <p>Der Assistent fasst den Bericht in wenigen Sätzen zusammen, nennt die wichtigsten Punkte und schätzt die Dringlichkeit ein.</p>
        ${summarizeButton()}
      </div>`;
  } else if (job.status === 'queued' || job.status === 'running') {
    el.innerHTML = `<div class="progress" data-testid="job-status" data-status="${esc(job.status)}">
        <div class="spinner" aria-hidden="true"></div>
        <div><strong>Zusammenfassung wird erstellt …</strong><span id="elapsed">seit ${formatElapsed(secondsSince(job.created_at))}</span></div>
      </div>`;
  } else if (job.status === 'done' && job.result) {
    const res = job.result;
    const tokens = res.usage && (res.usage.input_tokens != null || res.usage.output_tokens != null)
      ? `${res.usage.input_tokens ?? '–'} → ${res.usage.output_tokens ?? '–'} Tokens`
      : 'Tokenverbrauch nicht verfügbar';
    el.innerHTML = `<div data-testid="job-status" data-status="done">
        <span class="urgency urgency-${esc(res.urgency)}">${URGENCY_LABEL[res.urgency] ?? esc(res.urgency)}</span>
        <p class="summary-text">${esc(res.summary)}</p>
        ${res.key_points?.length ? `<ul class="key-points">${res.key_points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <div class="model-meta"><span>Modell <code>${esc(res.model_id ?? 'unbekannt')}</code></span>${res.fixture_id ? `<span>Fixture <code>${esc(res.fixture_id)}</code></span>` : ''}<span>${tokens}</span><span>${dateTimeFmt.format(new Date(job.updated_at))} Uhr</span></div>
        ${summarizeButton('Neu zusammenfassen', 'btn-secondary')}
      </div>`;
  } else {
    el.innerHTML = `<div data-testid="job-status" data-status="failed">
        <div class="alert" role="alert"><strong>Zusammenfassung fehlgeschlagen</strong><p>${esc(job.error || 'Unbekannter Fehler')}</p></div>
        ${summarizeButton()}
      </div>`;
  }
  renderHistory();
}

function renderHistory() {
  const el = $('#summary-history');
  if (!el) return;
  const older = (state.current?.jobs ?? []).filter((j) => j.id !== state.job?.id);
  el.innerHTML = older.length
    ? `<div class="history"><h4>Frühere Aufträge</h4><ul>${older.slice(0, 5).map((j) => `<li><span>${dateTimeFmt.format(new Date(j.created_at))} Uhr</span><span class="pill pill-${esc(j.status)}">${JOB_LABEL[j.status] ?? esc(j.status)}</span></li>`).join('')}</ul></div>`
    : '';
}

function stopPolling() {
  clearTimeout(state.pollTimer);
  clearInterval(state.tickTimer);
  state.pollTimer = null;
  state.tickTimer = null;
}

function watchJob(job) {
  stopPolling();
  state.job = job;
  renderSummary();
  if (job.status !== 'queued' && job.status !== 'running') return;
  state.tickTimer = setInterval(() => {
    const el = $('#elapsed');
    if (el && state.job) el.textContent = `seit ${formatElapsed(secondsSince(state.job.created_at))}`;
  }, 1000);
  const poll = async () => {
    try {
      const { job: next } = await api(`/api/jobs/${job.id}`);
      if (state.job?.id !== job.id) return;
      state.job = next;
      if (next.status === 'done' || next.status === 'failed') {
        stopPolling();
        renderSummary();
        beacon('ui.summary.finished', { outcome: next.status === 'done' ? 'ok' : 'error', duration_ms: secondsSince(next.created_at) * 1000, trace_id: next.trace_id, message: `Zusammenfassung ${next.status}` });
        loadReports();
        return;
      }
    } catch { /* nächster Versuch */ }
    state.pollTimer = setTimeout(poll, POLL_MS);
  };
  state.pollTimer = setTimeout(poll, POLL_MS);
}

async function startSummary() {
  if (!state.current || state.starting) return;
  state.starting = true;
  renderSummary();
  try {
    const { job } = await api(`/api/reports/${state.current.id}/summarize`, { method: 'POST' });
    beacon('ui.summary.start', { message: 'Zusammenfassung angefordert', trace_id: job.trace_id, attrs: { report_id: state.current.id } });
    state.current.jobs = [job, ...(state.current.jobs ?? [])];
    watchJob(job);
  } catch (err) {
    state.job = { id: null, status: 'failed', error: err.message };
    renderSummary();
  } finally {
    state.starting = false;
    renderSummary();
  }
}

async function openReport(id) {
  stopPolling();
  state.detailLoading = true;
  state.detailError = null;
  state.job = null;
  document.body.classList.add('view-detail');
  if (isMobile()) window.scrollTo(0, 0);
  else $('#detail').scrollTop = 0;
  renderDetail();
  try {
    const { report } = await api(`/api/reports/${id}`);
    state.current = report;
  } catch (err) {
    state.current = null;
    state.detailError = err.message;
  }
  state.detailLoading = false;
  renderDetail();
  renderList();
  if (state.current?.jobs?.[0]) watchJob(state.current.jobs[0]);
}

function route() {
  const m = location.hash.match(/^#\/bericht\/(\d+)/);
  if (m) return openReport(Number(m[1]));
  stopPolling();
  document.body.classList.remove('view-detail');
  if (!isMobile() && state.reports[0]) {
    location.replace(`#/bericht/${state.reports[0].id}`);
    return;
  }
  state.current = null;
  renderDetail();
  renderList();
}

async function loadMeta() {
  try {
    const m = await api('/api/meta');
    const parts = [];
    if (m.stage) parts.push(`<span class="badge stage">Stage ${esc(m.stage)}</span>`);
    if (m.dataset) parts.push(`<span class="badge">Datenstand ${esc(m.dataset)}</span>`);
    parts.push(`<span class="badge">Commit <code>${m.commit ? esc(m.commit.slice(0, 7)) : 'unbekannt'}</code></span>`);
    if (!m.model_configured) parts.push('<span class="badge">Modellfunktion nicht konfiguriert</span>');
    $('#footer-meta').innerHTML = parts.join('');
  } catch { /* egal */ }
}

// ---------- Ereignisse ----------
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  renderList();
});
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="summarize"]')) startSummary();
  if (e.target.closest('[data-action="reload-list"]')) loadReports();
});
window.addEventListener('hashchange', route);

$('#report-list').innerHTML = `<li class="list-skeleton">${'<div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton" style="width:40%;margin-bottom:22px"></div>'.repeat(4)}</li>`;
loadMeta();
await loadReports();
route();
