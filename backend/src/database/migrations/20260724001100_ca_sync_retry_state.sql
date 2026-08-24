alter table pg_ca_sync_runs
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column next_attempt_at timestamptz;

create index idx_ca_sync_runs_dispatchable
  on pg_ca_sync_runs (status, next_attempt_at, created_at)
  where status = 'queued';
