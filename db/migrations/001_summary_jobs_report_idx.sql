-- Letzter Auftrag je Bericht wird in der Liste angezeigt.
create index if not exists summary_jobs_report_created_idx on summary_jobs (report_id, created_at desc);
