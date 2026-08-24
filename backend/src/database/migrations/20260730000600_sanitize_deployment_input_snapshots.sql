-- 历史快照曾错误保存完整运行输入、Contract 和 Binding，必须一次性删除敏感副本。
drop trigger if exists trg_deployment_input_snapshots_immutable on deployment_input_snapshots;

alter table deployment_input_snapshots
  add column if not exists sealed_runtime_payload jsonb;

update deployment_input_snapshots
   set snapshot = snapshot
     - 'resolvedInput'
     - 'resolvedDeploymentInput'
     - 'contract'
     - 'effectiveBinding';

-- 旧快照无法从脱敏副本恢复完整运行材料。保留审计记录，但移除计划目标上的可执行引用，
-- 让旧 DRAFT 显式重新编译、旧终态计划在重跑时失败关闭，而不是回查当前 Binding。
do $$
begin
  if to_regclass('public.pg_documents') is not null then
    update pg_documents
       set payload = jsonb_set(
         payload,
         '{strategyPayload}',
         (coalesce(payload->'strategyPayload', '{}'::jsonb) - 'deploymentInputSnapshotRef')
           || jsonb_build_object(
             'deploymentInputSnapshotInvalidated',
             jsonb_build_object(
               'reason', 'SEALED_RUNTIME_PAYLOAD_REQUIRED',
               'migratedAt', '2026-07-30T00:00:00.000Z'
             )
           ),
         true
       ),
       updated_at = now()
     where namespace = 'deployment-plans:targets'
       and payload #>> '{strategyPayload,deploymentInputSnapshotRef,snapshotId}' in (
         select id from deployment_input_snapshots where sealed_runtime_payload is null
       );
  end if;
end;
$$;

alter table deployment_input_snapshots
  drop constraint if exists ck_deployment_input_snapshots_v1;

alter table deployment_input_snapshots
  add constraint ck_deployment_input_snapshots_v1 check (
    snapshot->>'apiVersion' = 'gcac.deployment-input-snapshot/v1'
    and snapshot->>'snapshotVersion' = '1'
    and jsonb_typeof(snapshot->'input') = 'object'
    and jsonb_typeof(snapshot->'sources') = 'object'
    and jsonb_typeof(snapshot->'sensitivePaths') = 'array'
    and jsonb_typeof(snapshot->'identity') = 'object'
    and jsonb_typeof(snapshot->'redaction') = 'object'
    and not snapshot ? 'resolvedInput'
    and not snapshot ? 'resolvedDeploymentInput'
    and not snapshot ? 'contract'
    and not snapshot ? 'effectiveBinding'
    and (
      sealed_runtime_payload is null
      or (
        jsonb_typeof(sealed_runtime_payload) = 'object'
        and sealed_runtime_payload->>'algorithm' = 'aes-256-gcm'
        and sealed_runtime_payload ? 'encryptedData'
        and sealed_runtime_payload ? 'encryptedDek'
        and sealed_runtime_payload ? 'authTag'
      )
    )
  );

create trigger trg_deployment_input_snapshots_immutable
before update or delete on deployment_input_snapshots
for each row execute function gcac_reject_deployment_input_snapshot_mutation();

-- 旧执行步骤复制过完整运行输入和证书产物；递归删除运行材料容器和敏感键，
-- 防止 Workflow 嵌套 Binding、SecretRef 或证书材料绕过顶层字段清理。
create or replace function gcac_sanitize_execution_input_snapshot(value jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  sanitized jsonb;
begin
  if value is null then
    return null;
  end if;
  if jsonb_typeof(value) = 'array' then
    select coalesce(jsonb_agg(gcac_sanitize_execution_input_snapshot(item)), '[]'::jsonb)
      into sanitized
      from jsonb_array_elements(value) item;
    return sanitized;
  end if;
  if jsonb_typeof(value) = 'object' then
    select coalesce(jsonb_object_agg(entry.key, gcac_sanitize_execution_input_snapshot(entry.value)), '{}'::jsonb)
      into sanitized
      from jsonb_each(value) entry
     where entry.key not in (
       'resolvedInput',
       'resolvedDeploymentInput',
       'deploymentArtifact',
       'artifact',
       'effectiveInputBindings',
       'inputBindings',
       'workflowCertificateMaterials'
     )
       and entry.key !~* '(password|passphrase|token|secret|private.?key|pfx|pkcs.?12|jks|credential)';
    return sanitized;
  end if;
  return value;
end;
$$;

do $$
begin
  if to_regclass('public.pg_execution_steps') is not null then
    execute $sql$
      update pg_execution_steps
         set input_snapshot = gcac_sanitize_execution_input_snapshot(input_snapshot)
    $sql$;
  end if;
end;
$$;

drop function gcac_sanitize_execution_input_snapshot(jsonb);
