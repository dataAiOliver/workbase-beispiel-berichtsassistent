// Serviceberichte und Zusammenfassungsaufträge
export async function listReports(pool) {
  const { rows } = await pool.query(
    `select r.id, r.report_no, r.technician, r.customer, r.site, r.equipment, r.visited_on, r.title,
            left(r.body, 180) as excerpt, length(r.body) as length,
            j.id as job_id, j.status as job_status, j.updated_at as job_updated_at
       from service_reports r
       left join lateral (
         select id, status, updated_at from summary_jobs where report_id = r.id order by created_at desc limit 1
       ) j on true
      order by r.visited_on desc, r.id desc`,
  );
  return rows.map(({ job_id, job_status, job_updated_at, ...r }) => ({
    ...r,
    latest_job: job_id ? { id: job_id, status: job_status, updated_at: job_updated_at } : null,
  }));
}

export async function getReport(pool, id) {
  const { rows } = await pool.query('select * from service_reports where id = $1', [id]);
  if (!rows[0]) return null;
  const jobs = await pool.query(
    'select * from summary_jobs where report_id = $1 order by created_at desc limit 10',
    [id],
  );
  return { ...rows[0], jobs: jobs.rows.map(publicJob) };
}

export async function getJob(pool, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { rows } = await pool.query('select * from summary_jobs where id = $1', [id]);
  return rows[0] ? publicJob(rows[0]) : null;
}

export function publicJob(row) {
  return {
    id: row.id,
    report_id: row.report_id,
    status: row.status,
    result: row.result,
    error: row.error,
    trace_id: row.trace_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
