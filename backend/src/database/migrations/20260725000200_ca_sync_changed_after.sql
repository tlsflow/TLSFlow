alter table pg_ca_sync_runs
  add column changed_after timestamptz;

create index idx_ca_sync_runs_auto_schedule
  on pg_ca_sync_runs (ca_id, object_type, updated_at desc);
