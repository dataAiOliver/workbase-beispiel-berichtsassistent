# Elbservice Berichtsassistent

Internes Werkzeug der Elbservice (technischer Gebäudeservice rund um Hamburg). Techniker
erfassen nach jedem Einsatz einen **Servicebericht** (Kälteanlage, Brandmeldeanlage, Aufzug,
Lüftung …). Im Berichtsassistenten lässt sich jeder Bericht per Klick auf **„Zusammenfassen“**
von einer Modellfunktion zusammenfassen: kurze Zusammenfassung, wichtigste Punkte und eine
Einschätzung der Dringlichkeit (`niedrig | mittel | hoch`).

Alle Daten sind synthetisch.

## Start

```bash
npm install
cp .env.example .env   # nur Platzhalter
PORT=4200 DATABASE_URL=postgres://… MODEL_ENDPOINT=http://127.0.0.1:4900/models/service-report node server.mjs
```

| Variable | Bedeutung |
| --- | --- |
| `PORT` | Pflicht. HTTP-Port |
| `HOST` | Default `127.0.0.1` |
| `DATABASE_URL` | PostgreSQL-Verbindung (Rolle ist Eigentümerin der Datenbank) |
| `MODEL_ENDPOINT` | Basis-URL der Modellfunktion (lokaler Simulator der Plattform) |
| `WORKBASE_PROJECT`, `WORKBASE_STAGE`, `WORKBASE_DATASET_LABEL` | werden in der Fußzeile angezeigt |
| `WORKBASE_COMMIT` | Fallback, falls `git rev-parse HEAD` nicht möglich ist |

Beim Start wendet die App `db/schema.sql` und alle neuen Migrationen aus `db/migrations/` an.

## Modellfunktion `service_report_summary`

Die App ruft die Modellfunktion per HTTP auf:

```
POST {MODEL_ENDPOINT}/summarize
content-type: application/json

{"report_id": 17, "text": "<Berichtstext>"}
```

Antwort (200):

```json
{"model_id": "sim-summarize-v1", "fixture_id": "fx-…",
 "output": {"summary": "…", "key_points": ["…"], "urgency": "niedrig|mittel|hoch"}}
```

Token-/Usage-Angaben sind optional und fehlen beim Simulator; die UI zeigt dann
„Tokenverbrauch nicht verfügbar“. Fehlerantworten: `500 {"error":"simulated_error"}`,
`504 {"error":"upstream_timeout"}`.

## Ablauf

1. `POST /api/reports/:id/summarize` legt einen Auftrag in `summary_jobs` an (`queued`) und antwortet `202`.
2. Der Auftrag wird im Hintergrund abgearbeitet (`running` → `done` bzw. `failed`).
3. Die Oberfläche fragt `GET /api/jobs/:id` jede Sekunde ab und zeigt Ergebnis oder Status.

## API

| Methode & Pfad | Beschreibung |
| --- | --- |
| `GET /api/reports` | Berichte (neueste zuerst) mit letztem Auftrag |
| `GET /api/reports/:id` | Bericht mit Text und den letzten Aufträgen |
| `POST /api/reports/:id/summarize` | Zusammenfassung anfordern → `202 {job}` |
| `GET /api/jobs/:id` | Auftragsstatus und Ergebnis |
| `GET /api/meta` | Projekt, Stage, Datenstand, Commit |
| `GET /__health` | `{"ok":true,"project","stage","commit","dataset"}` |
| `POST /__workbase/telemetry` | `204` |

## Datenmodell

* `service_reports(id, report_no, technician, customer, site, equipment, visited_on, title, body, created_at)`
* `summary_jobs(id uuid, report_id, status queued|running|done|failed, result jsonb, error, trace_id, created_at, updated_at)`

## Tests und Build

```bash
DATABASE_URL=postgres://… npm test   # node:test, echte Datenbank, Fake-Modellfunktion im Test
npm run build                       # Syntaxprüfung + dist/ mit gehashten Assets
```

Die Tests starten die App als Kindprozess und eine kleine Fake-Modellfunktion
(`tests/helpers/harness.mjs`, Modi `ok`, `error`, `timeout`). Bericht:
`$WORKBASE_TEST_REPORT` (Default `.workbase/test-report.json`).
