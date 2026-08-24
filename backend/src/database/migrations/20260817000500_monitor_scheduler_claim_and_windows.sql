-- 001.6：监控调度以持久化到期时间和租户时间窗账本为准。
-- 目标的下次执行时间与批次账本都由同一事务维护，避免多实例重复入队。
alter table pg_monitor_targets
  add column if not exists next_run_at timestamptz;

update pg_monitor_targets target
   set next_run_at = coalesce(
     (
       select max(result.checked_at) + (target.interval_seconds * interval '1 second')
         from pg_monitor_probe_results result
        where result.tenant_id = target.tenant_id
          and result.monitor_target_id = target.id
     ),
     now()
   )
 where target.next_run_at is null;

alter table pg_monitor_targets
  alter column next_run_at set not null;

create index if not exists idx_pg_monitor_targets_due_scheduler
  on pg_monitor_targets (next_run_at asc, tenant_id, id)
  where deleted_at is null and status = 'active';

create table if not exists pg_monitor_scheduler_windows (
  tenant_id text not null,
  window_start timestamptz not null,
  task_id text,
  candidate_count integer not null check (candidate_count >= 0),
  target_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(target_ids) = 'array'),
  status text not null check (status in ('CLAIMED', 'ENQUEUED', 'FAILED')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, window_start)
);

create index if not exists idx_pg_monitor_scheduler_windows_recovery
  on pg_monitor_scheduler_windows (status, updated_at asc)
  where task_id is null;
