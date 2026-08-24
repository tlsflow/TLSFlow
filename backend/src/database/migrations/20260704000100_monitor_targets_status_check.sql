do $$
begin
  if exists (
    select 1
    from pg_monitor_targets
    where status not in ('active', 'paused')
  ) then
    raise exception 'pg_monitor_targets.status 存在非法值，不能添加状态约束';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'pg_monitor_targets'
      and c.conname = 'pg_monitor_targets_status_check'
  ) then
    alter table pg_monitor_targets
      add constraint pg_monitor_targets_status_check
      check (status in ('active', 'paused'));
  end if;
end $$;
