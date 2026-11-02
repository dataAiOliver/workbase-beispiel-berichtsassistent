// Zusammenfassungsaufträge: anlegen und im Hintergrund abarbeiten
import { randomUUID } from 'node:crypto';
import { summarizeReport } from './model.mjs';
import { publicJob } from './reports.mjs';

export async function startSummary(pool, report) {
  const { rows } = await pool.query(
    `insert into summary_jobs (report_id, status, trace_id) values ($1, 'queued', $2) returning *`,
    [report.id, randomUUID()],
  );
  const job = rows[0];
  setImmediate(() => runJob(pool, job, report));
  return publicJob(job);
}

async function runJob(pool, job, report) {
  console.log('[summarize] Auftrag ' + job.id + ' für Bericht ' + report.report_no + ' gestartet');
  try {
    await pool.query(`update summary_jobs set status = 'running', updated_at = now() where id = $1`, [job.id]);
    const result = await summarizeReport(report);
    await pool.query(
      `update summary_jobs set status = 'done', result = $2, updated_at = now() where id = $1`,
      [job.id, result],
    );
    console.log('[summarize] fertig', job.id);
  } catch (err) {
    console.log('Zusammenfassung fehlgeschlagen:', err.message);
  }
}
