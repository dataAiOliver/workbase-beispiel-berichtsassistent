-- Elbservice Berichtsassistent – Basisschema (idempotent)
create table if not exists service_reports (
  id integer primary key,
  report_no text not null unique,
  technician text not null,
  customer text not null,
  site text not null,
  equipment text not null,
  visited_on date not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists summary_jobs (
  id uuid primary key default gen_random_uuid(),
  report_id integer not null references service_reports(id),
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  result jsonb,
  error text,
  trace_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
