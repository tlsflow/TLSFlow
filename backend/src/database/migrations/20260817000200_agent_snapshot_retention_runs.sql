-- 001.6：记录 Agent 快照保留 dry-run 和分批清理结果。
-- 运行审计与历史事实分开，删除服务不会把完整 payload 写入审计表。
create table if not exists pg_agent_snapshot_retention_runs (
  run_id text primary key,
  policy_version text not null,
  mode text not null check (mode in ('DRY_RUN', 'EXECUTE')),
  status text not null check (status in ('DRY_RUN', 'RUNNING', 'COMPLETED', 'FAILED')),
  regular_retention_days integer not null check (regular_retention_days > 0),
  full_web_retention_days integer not null check (full_web_retention_days > 0),
  regular_cutoff_at timestamptz not null,
  full_web_cutoff_at timestamptz not null,
  candidate_count integer not null default 0 check (candidate_count >= 0),
  candidate_bytes bigint not null default 0 check (candidate_bytes >= 0),
  protected_current_count integer not null default 0 check (protected_current_count >= 0),
  protected_audit_count integer not null default 0 check (protected_audit_count >= 0),
  invalid_count integer not null default 0 check (invalid_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  deleted_count integer not null default 0 check (deleted_count >= 0),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pg_agent_snapshot_retention_runs_status
  on pg_agent_snapshot_retention_runs (status, updated_at desc);
