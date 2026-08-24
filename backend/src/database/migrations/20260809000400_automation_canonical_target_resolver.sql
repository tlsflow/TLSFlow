-- 自动化目标解析器一次性收口。当前项目未正式发布，旧目标选择器记录直接作废，禁止运行期猜测转换。
create temporary table gcac_legacy_automation_ids on commit drop as
select distinct automation_id
from automation_versions
where target_resolver is null
   or target_resolver->>'type' = 'legacy_target_selector';

delete from automation_run_action_results
where run_id in (
  select id from automation_runs
  where automation_id in (select automation_id from gcac_legacy_automation_ids)
);

delete from automation_run_targets
where run_id in (
  select id from automation_runs
  where automation_id in (select automation_id from gcac_legacy_automation_ids)
);

delete from automation_trigger_deliveries
where automation_id in (select automation_id from gcac_legacy_automation_ids);

delete from automation_runs
where automation_id in (select automation_id from gcac_legacy_automation_ids);

delete from automation_versions
where automation_id in (select automation_id from gcac_legacy_automation_ids)
  and (target_resolver is null or target_resolver->>'type' = 'legacy_target_selector');

update automation_definitions definition
set current_version = versions.max_version,
    updated_at = now(),
    version = definition.version + 1
from (
  select automation_id, max(version) as max_version
  from automation_versions
  group by automation_id
) versions
where definition.id = versions.automation_id
  and definition.id in (select automation_id from gcac_legacy_automation_ids)
  and definition.current_version not in (
    select automation_versions.version
    from automation_versions
    where automation_versions.automation_id = definition.id
  );

delete from automation_definitions definition
where definition.id in (select automation_id from gcac_legacy_automation_ids)
  and not exists (
    select 1 from automation_versions version
    where version.automation_id = definition.id
  );

alter table automation_versions
  drop column if exists target_selector;

alter table automation_versions
  alter column target_resolver set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'automation_versions_target_resolver_type_check'
  ) then
    alter table automation_versions
      add constraint automation_versions_target_resolver_type_check
      check (target_resolver->>'type' = 'certificate_version_targets');
  end if;
end
$$;
