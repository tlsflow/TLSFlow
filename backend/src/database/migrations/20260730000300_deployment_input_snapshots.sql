-- 部署输入审计快照是只追加记录：计划后续编辑、Binding 变化和执行重试均不得覆盖历史解析结果。
create table deployment_input_snapshots (
  id text primary key,
  tenant_id text not null,
  deployment_plan_id text not null,
  deployment_plan_target_id text not null,
  revision integer not null check (revision > 0),
  snapshot jsonb not null,
  created_at timestamptz not null,
  created_by text not null,
  constraint uq_deployment_input_snapshots_target_revision
    unique (tenant_id, deployment_plan_target_id, revision),
  constraint ck_deployment_input_snapshots_v1 check (
    snapshot->>'apiVersion' = 'gcac.deployment-input-snapshot/v1'
    and snapshot->>'snapshotVersion' = '1'
    and jsonb_typeof(snapshot->'input') = 'object'
    and jsonb_typeof(snapshot->'sources') = 'object'
    and jsonb_typeof(snapshot->'sensitivePaths') = 'array'
    and jsonb_typeof(snapshot->'identity') = 'object'
    and jsonb_typeof(snapshot->'redaction') = 'object'
  )
);

create index idx_deployment_input_snapshots_plan
  on deployment_input_snapshots (tenant_id, deployment_plan_id, revision, created_at);

create function gcac_reject_deployment_input_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'deployment_input_snapshots are immutable';
end;
$$;

create trigger trg_deployment_input_snapshots_immutable
before update or delete on deployment_input_snapshots
for each row execute function gcac_reject_deployment_input_snapshot_mutation();
