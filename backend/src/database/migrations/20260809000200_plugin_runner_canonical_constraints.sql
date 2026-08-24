-- 004.5：Plugin Runner canonical cutover 的前向收口。
-- 20260809000100 已经写入初始绑定；本迁移追加真实租户、版本和制品快照，清退旧入口并固定新合同。
-- 无法证明身份、版本或制品完整性的记录保留原始数据，但退出可执行状态并进入拒绝台账。

alter table plugin_runner_version_bindings
  add column if not exists tenant_id varchar(128),
  add column if not exists plugin_version varchar(64),
  add column if not exists resource_sha256 jsonb,
  add column if not exists protocol_version varchar(64);

create table if not exists plugin_runner_cutover_rejections (
  plugin_version_id varchar(128) primary key references unified_plugin_versions(id) on delete restrict,
  tenant_id varchar(128) not null,
  canonical_plugin_id varchar(192),
  reason varchar(64) not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

-- 内置资源哈希允许历史的裸十六进制形式，但新 Runner 只接受固定前缀形式。
update unified_plugin_resources resource
set resource_sha256 = 'sha256:' || resource.resource_sha256
where resource.resource_sha256 ~ '^[0-9a-f]{64}$';

update unified_plugin_versions version
set package_sha256 = case
      when version.package_sha256 ~ '^[0-9a-f]{64}$' then 'sha256:' || version.package_sha256
      else version.package_sha256
    end,
    manifest_sha256 = case
      when version.manifest_sha256 ~ '^[0-9a-f]{64}$' then 'sha256:' || version.manifest_sha256
      else version.manifest_sha256
    end,
    resource_sha256 = case
      when jsonb_typeof(version.resource_sha256) = 'object' then coalesce((
        select jsonb_object_agg(resource_item.key, case
          when resource_item.value ~ '^[0-9a-f]{64}$' then 'sha256:' || resource_item.value
          else resource_item.value
        end)
        from jsonb_each_text(
          case when jsonb_typeof(version.resource_sha256) = 'object'
            then version.resource_sha256
            else '{}'::jsonb
          end
        ) resource_item
      ), '{}'::jsonb)
      else version.resource_sha256
    end
where version.package_sha256 ~ '^[0-9a-f]{64}$'
   or version.manifest_sha256 ~ '^[0-9a-f]{64}$'
   or jsonb_typeof(version.resource_sha256) = 'object';

-- 旧别名只在一次性清退时映射；运行时只允许下面 17 个 canonical Plugin ID。
create temporary table if not exists gcac_plugin_runner_id_map (
  source_plugin_id varchar(192) primary key,
  canonical_plugin_id varchar(192) not null
) on commit drop;

truncate gcac_plugin_runner_id_map;

insert into gcac_plugin_runner_id_map (source_plugin_id, canonical_plugin_id)
values
  ('web.nginx', 'web.nginx'),
  ('builtin.linux.nginx.pem', 'web.nginx'),
  ('builtin.windows.nginx.pem', 'web.nginx'),
  ('nginx.json', 'web.nginx'),
  ('windows-nginx.json', 'web.nginx'),
  ('web.apache', 'web.apache'),
  ('builtin.windows.apache.pem', 'web.apache'),
  ('builtin.workflow.apache-8444-cert-switch', 'web.apache'),
  ('apache.json', 'web.apache'),
  ('windows-apache.json', 'web.apache'),
  ('apache-8444-cert-switch.json', 'web.apache'),
  ('web.iis', 'web.iis'),
  ('builtin.windows.iis.pfx', 'web.iis'),
  ('windows.iis', 'web.iis'),
  ('iis.json', 'web.iis'),
  ('app.tomcat', 'app.tomcat'),
  ('builtin.windows.tomcat.pkcs12', 'app.tomcat'),
  ('linux.tomcat', 'app.tomcat'),
  ('tomcat.json', 'app.tomcat'),
  ('windows-tomcat.json', 'app.tomcat'),
  ('app.java-keystore', 'app.java-keystore'),
  ('builtin.java.pkcs12', 'app.java-keystore'),
  ('app.rabbitmq', 'app.rabbitmq'),
  ('builtin.rabbitmq.pem', 'app.rabbitmq'),
  ('app.service-certificate-file', 'app.service-certificate-file'),
  ('builtin.windows.custom.certificate', 'app.service-certificate-file'),
  ('builtin.windows-service.certificate-file', 'app.service-certificate-file'),
  ('device.citrix.netscaler-adc', 'device.citrix.netscaler-adc'),
  ('citrix.netscaler-adc', 'device.citrix.netscaler-adc'),
  ('device.synology-dsm', 'device.synology-dsm'),
  ('builtin.workflow.synology-dsm-cert-import', 'device.synology-dsm'),
  ('synology-dsm-cert-import.json', 'device.synology-dsm'),
  ('cloud.aliyun', 'cloud.aliyun'),
  ('builtin.cloud.aliyun.provider', 'cloud.aliyun'),
  ('cloud.tencent', 'cloud.tencent'),
  ('builtin.cloud.tencent.provider', 'cloud.tencent'),
  ('cloud.huawei', 'cloud.huawei'),
  ('builtin.cloud.huawei.provider', 'cloud.huawei'),
  ('cloud.volcengine', 'cloud.volcengine'),
  ('builtin.cloud.volcengine.provider', 'cloud.volcengine'),
  ('ca.openssl', 'ca.openssl'),
  ('openssl', 'ca.openssl'),
  ('ca.acme', 'ca.acme'),
  ('acme', 'ca.acme'),
  ('ca.microsoft-adcs', 'ca.microsoft-adcs'),
  ('microsoft_adcs', 'ca.microsoft-adcs'),
  ('ca.acme-dns', 'ca.acme-dns'),
  ('acme-dns', 'ca.acme-dns');

create temporary table if not exists gcac_plugin_runner_duplicate_versions (
  plugin_version_id varchar(128) primary key,
  canonical_plugin_id varchar(192) not null
) on commit drop;

truncate gcac_plugin_runner_duplicate_versions;

-- 同租户、同 canonical、同版本只保留一条可执行候选；其余记录保留为不可执行审计数据。
insert into gcac_plugin_runner_duplicate_versions (plugin_version_id, canonical_plugin_id)
select candidate.plugin_version_id, candidate.canonical_plugin_id
from (
  select
    version.id as plugin_version_id,
    id_map.canonical_plugin_id,
    row_number() over (
      partition by version.tenant_id, id_map.canonical_plugin_id, version.plugin_version
      order by
        case when version.plugin_id = id_map.canonical_plugin_id then 0 else 1 end,
        case when version.status = 'ENABLED' then 0 else 1 end,
        version.created_at,
        version.id
    ) as candidate_rank
  from unified_plugin_versions version
  join gcac_plugin_runner_id_map id_map
    on id_map.source_plugin_id = version.plugin_id
  where version.status not in ('RETIRED', 'QUARANTINED')
) candidate
where candidate.candidate_rank > 1;

delete from plugin_runner_version_bindings binding
where exists (
  select 1
  from gcac_plugin_runner_duplicate_versions duplicate_version
  where duplicate_version.plugin_version_id = binding.plugin_version_id
);

update unified_plugin_bindings binding
set status = 'DISABLED',
    updated_at = now()
from gcac_plugin_runner_duplicate_versions duplicate_version
where duplicate_version.plugin_version_id = binding.plugin_version_id
  and binding.status <> 'DISABLED';

update plugin_capability_assignments assignment
set status = 'DISABLED',
    updated_at = now()
from gcac_plugin_runner_duplicate_versions duplicate_version
where duplicate_version.plugin_version_id = assignment.plugin_version_id
  and assignment.status <> 'DISABLED';

update unified_plugin_versions version
set status = 'QUARANTINED',
    validation_report = jsonb_set(
      case when jsonb_typeof(version.validation_report) = 'object'
        then version.validation_report
        else jsonb_build_object('originalValidationReport', version.validation_report)
      end,
      '{pluginRunnerCutover}',
      jsonb_build_object('status', 'QUARANTINED', 'reason', 'DUPLICATE_CANONICAL_VERSION'),
      true
    ),
    updated_at = now()
from gcac_plugin_runner_duplicate_versions duplicate_version
where duplicate_version.plugin_version_id = version.id;

insert into plugin_runner_cutover_rejections (
  plugin_version_id, tenant_id, canonical_plugin_id, reason, created_at, updated_at
)
select duplicate_version.plugin_version_id,
       version.tenant_id,
       duplicate_version.canonical_plugin_id,
       'DUPLICATE_CANONICAL_VERSION',
       version.created_at,
       now()
from gcac_plugin_runner_duplicate_versions duplicate_version
join unified_plugin_versions version on version.id = duplicate_version.plugin_version_id
on conflict (plugin_version_id) do update set
  tenant_id = excluded.tenant_id,
  canonical_plugin_id = excluded.canonical_plugin_id,
  reason = excluded.reason,
  updated_at = excluded.updated_at;

-- 只改写明确登记的旧别名。已经是 canonical ID 的记录必须保留原 Manifest 供完整性校验，不能被迁移强行修复。
update unified_plugin_versions version
set plugin_id = id_map.canonical_plugin_id,
    manifest = case
      when jsonb_typeof(version.manifest) = 'object' then jsonb_set(
        jsonb_set(
          jsonb_set(version.manifest, '{pluginId}', to_jsonb(id_map.canonical_plugin_id), true),
          '{canonicalPluginId}',
          to_jsonb(id_map.canonical_plugin_id),
          true
        ),
        '{executionMode}',
        to_jsonb('isolated_process'::text),
        true
      )
      else version.manifest
    end,
    updated_at = now()
from gcac_plugin_runner_id_map id_map
where version.plugin_id = id_map.source_plugin_id
  and id_map.source_plugin_id <> id_map.canonical_plugin_id
  and version.status = 'ENABLED'
  and not exists (
    select 1
    from gcac_plugin_runner_duplicate_versions duplicate_version
    where duplicate_version.plugin_version_id = version.id
  );

-- 00100 的空字段和裸摘要只在能与真实 PluginVersion 对上的情况下补齐；已有冲突值原样保留并进入隔离。
update plugin_runner_version_bindings binding
set tenant_id = case
      when binding.tenant_id is null then version.tenant_id
      else binding.tenant_id
    end,
    plugin_version = case
      when binding.plugin_version is null then version.plugin_version
      else binding.plugin_version
    end,
    package_sha256 = case
      when binding.package_sha256 = version.package_sha256
        or (version.package_sha256 like 'sha256:%' and binding.package_sha256 = substr(version.package_sha256, 8))
        then version.package_sha256
      else binding.package_sha256
    end,
    manifest_sha256 = case
      when binding.manifest_sha256 = version.manifest_sha256
        or (version.manifest_sha256 like 'sha256:%' and binding.manifest_sha256 = substr(version.manifest_sha256, 8))
        then version.manifest_sha256
      else binding.manifest_sha256
    end,
    resource_sha256 = case
      when binding.resource_sha256 is null then coalesce(version.resource_sha256, '{}'::jsonb)
      else binding.resource_sha256
    end,
    protocol_version = coalesce(binding.protocol_version, 'gcac.plugin-runner/v1'),
    updated_at = now()
from unified_plugin_versions version
where version.id = binding.plugin_version_id;

-- 已使用 canonical ID 的真实 PluginVersion 只有在证据完整且处于 ENABLED 状态时才建立 Runner 绑定。
insert into plugin_runner_version_bindings (
  tenant_id, plugin_version_id, canonical_plugin_id, plugin_version, execution_mode,
  protocol_version, package_sha256, manifest_sha256, resource_sha256,
  created_at, updated_at
)
select
  version.tenant_id,
  version.id,
  version.plugin_id,
  version.plugin_version,
  'isolated_process',
  'gcac.plugin-runner/v1',
  version.package_sha256,
  version.manifest_sha256,
  coalesce(version.resource_sha256, '{}'::jsonb),
  version.created_at,
  version.updated_at
from unified_plugin_versions version
where version.status = 'ENABLED'
  and exists (
    select 1
    from gcac_plugin_runner_id_map id_map
    where id_map.source_plugin_id = version.plugin_id
      and id_map.canonical_plugin_id = version.plugin_id
  )
  and jsonb_typeof(version.manifest) = 'object'
  and version.manifest->>'pluginId' = version.plugin_id
  and version.manifest->>'canonicalPluginId' = version.plugin_id
  and version.manifest->>'executionMode' = 'isolated_process'
  and version.manifest->>'version' = version.plugin_version
  and version.plugin_version ~ '^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$'
  and version.package_sha256 ~ '^sha256:[a-f0-9]{64}$'
  and version.manifest_sha256 ~ '^sha256:[a-f0-9]{64}$'
  and jsonb_typeof(version.resource_sha256) = 'object'
  and not exists (
    select 1
    from jsonb_each_text(
      case when jsonb_typeof(version.resource_sha256) = 'object'
        then version.resource_sha256
        else '{}'::jsonb
      end
    ) resource_item
    where resource_item.value is null
       or resource_item.value !~ '^sha256:[a-f0-9]{64}$'
  )
  and not exists (
    select 1
    from unified_plugin_resources resource
    where resource.plugin_version_id = version.id
      and resource.resource_sha256 !~ '^sha256:[a-f0-9]{64}$'
  )
on conflict (plugin_version_id) do nothing;

-- 非 ENABLED 版本不能留下 Runner 绑定；它们仍可作为历史记录保留，但不会成为新执行入口。
delete from plugin_runner_version_bindings binding
using unified_plugin_versions version
where version.id = binding.plugin_version_id
  and version.status <> 'ENABLED';

create temporary table if not exists gcac_plugin_runner_rejected_versions (
  plugin_version_id varchar(128) primary key,
  reason varchar(64) not null
) on commit drop;

truncate gcac_plugin_runner_rejected_versions;

-- 记录所有无法满足新合同的 PluginVersion，包含没有绑定但仍可能被新路径读取的 canonical 记录。
insert into gcac_plugin_runner_rejected_versions (plugin_version_id, reason)
select version.id,
  case
    when length(trim(version.tenant_id)) = 0 then 'TENANT_INVALID'
    when version.plugin_version !~ '^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$' then 'PLUGIN_VERSION_INVALID'
    when jsonb_typeof(version.manifest) <> 'object' then 'MANIFEST_INVALID'
    when version.package_sha256 !~ '^sha256:[a-f0-9]{64}$' then 'PACKAGE_HASH_INVALID'
    when version.manifest_sha256 !~ '^sha256:[a-f0-9]{64}$' then 'MANIFEST_HASH_INVALID'
    when jsonb_typeof(version.resource_sha256) <> 'object' then 'RESOURCE_HASH_INVALID'
    when exists (
      select 1
      from jsonb_each_text(
        case when jsonb_typeof(version.resource_sha256) = 'object'
          then version.resource_sha256
          else '{}'::jsonb
        end
      ) resource_item
      where resource_item.value is null
         or resource_item.value !~ '^sha256:[a-f0-9]{64}$'
    ) then 'RESOURCE_HASH_INVALID'
    when exists (
      select 1
      from unified_plugin_resources resource
      where resource.plugin_version_id = version.id
        and resource.resource_sha256 !~ '^sha256:[a-f0-9]{64}$'
    ) then 'RESOURCE_HASH_INVALID'
    when not exists (
      select 1
      from gcac_plugin_runner_id_map id_map
      where id_map.source_plugin_id = version.plugin_id
        and id_map.canonical_plugin_id = version.plugin_id
    ) then 'CANONICAL_ID_INVALID'
    when version.manifest->>'pluginId' is distinct from version.plugin_id then 'MANIFEST_PLUGIN_ID_INVALID'
    when version.manifest->>'canonicalPluginId' is distinct from version.plugin_id then 'MANIFEST_CANONICAL_ID_INVALID'
    when version.manifest->>'executionMode' is distinct from 'isolated_process' then 'EXECUTION_MODE_INVALID'
    when version.manifest->>'version' is distinct from version.plugin_version then 'MANIFEST_VERSION_INVALID'
    when binding.plugin_version_id is not null and binding.tenant_id is distinct from version.tenant_id then 'TENANT_BINDING_INVALID'
    when binding.plugin_version_id is not null and binding.canonical_plugin_id is distinct from version.plugin_id then 'CANONICAL_BINDING_INVALID'
    when binding.plugin_version_id is not null and binding.plugin_version is distinct from version.plugin_version then 'PLUGIN_VERSION_BINDING_INVALID'
    when binding.plugin_version_id is not null and binding.execution_mode is distinct from 'isolated_process' then 'EXECUTION_MODE_BINDING_INVALID'
    when binding.plugin_version_id is not null and binding.protocol_version is distinct from 'gcac.plugin-runner/v1' then 'PROTOCOL_VERSION_INVALID'
    when binding.plugin_version_id is not null and binding.package_sha256 is distinct from version.package_sha256 then 'PACKAGE_HASH_BINDING_INVALID'
    when binding.plugin_version_id is not null and binding.manifest_sha256 is distinct from version.manifest_sha256 then 'MANIFEST_HASH_BINDING_INVALID'
    when binding.plugin_version_id is not null and binding.resource_sha256 is distinct from coalesce(version.resource_sha256, '{}'::jsonb) then 'RESOURCE_HASH_BINDING_INVALID'
    else 'PLUGIN_VERSION_NOT_CANONICAL'
  end
from unified_plugin_versions version
left join plugin_runner_version_bindings binding
  on binding.plugin_version_id = version.id
where version.status not in ('RETIRED', 'QUARANTINED')
  and (
    version.plugin_version !~ '^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$'
    or jsonb_typeof(version.manifest) <> 'object'
    or version.package_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or version.manifest_sha256 !~ '^sha256:[a-f0-9]{64}$'
    or jsonb_typeof(version.resource_sha256) <> 'object'
    or exists (
      select 1
      from jsonb_each_text(
        case when jsonb_typeof(version.resource_sha256) = 'object'
          then version.resource_sha256
          else '{}'::jsonb
        end
      ) resource_item
      where resource_item.value is null
         or resource_item.value !~ '^sha256:[a-f0-9]{64}$'
    )
    or exists (
      select 1
      from unified_plugin_resources resource
      where resource.plugin_version_id = version.id
        and resource.resource_sha256 !~ '^sha256:[a-f0-9]{64}$'
    )
    or binding.plugin_version_id is not null
    and (
      binding.tenant_id is distinct from version.tenant_id
      or binding.canonical_plugin_id is distinct from version.plugin_id
      or binding.plugin_version is distinct from version.plugin_version
      or binding.execution_mode is distinct from 'isolated_process'
      or binding.protocol_version is distinct from 'gcac.plugin-runner/v1'
      or binding.package_sha256 is distinct from version.package_sha256
      or binding.manifest_sha256 is distinct from version.manifest_sha256
      or binding.resource_sha256 is distinct from coalesce(version.resource_sha256, '{}'::jsonb)
    )
    or not exists (
      select 1
      from gcac_plugin_runner_id_map id_map
      where id_map.source_plugin_id = version.plugin_id
        and id_map.canonical_plugin_id = version.plugin_id
    )
    or (
      exists (
        select 1
        from gcac_plugin_runner_id_map id_map
        where id_map.source_plugin_id = version.plugin_id
          and id_map.canonical_plugin_id = version.plugin_id
      )
      and (
        version.manifest->>'pluginId' is distinct from version.plugin_id
        or version.manifest->>'canonicalPluginId' is distinct from version.plugin_id
        or version.manifest->>'executionMode' is distinct from 'isolated_process'
        or version.manifest->>'version' is distinct from version.plugin_version
      )
    )
  )
on conflict (plugin_version_id) do update set reason = excluded.reason;

delete from plugin_runner_version_bindings binding
where exists (
  select 1
  from gcac_plugin_runner_rejected_versions rejected
  where rejected.plugin_version_id = binding.plugin_version_id
);

insert into plugin_runner_cutover_rejections (
  plugin_version_id, tenant_id, canonical_plugin_id, reason, created_at, updated_at
)
select rejected.plugin_version_id,
       version.tenant_id,
       case when id_map.canonical_plugin_id = version.plugin_id then version.plugin_id else id_map.canonical_plugin_id end,
       rejected.reason,
       version.created_at,
       now()
from gcac_plugin_runner_rejected_versions rejected
join unified_plugin_versions version on version.id = rejected.plugin_version_id
left join gcac_plugin_runner_id_map id_map on id_map.source_plugin_id = version.plugin_id
on conflict (plugin_version_id) do update set
  tenant_id = excluded.tenant_id,
  canonical_plugin_id = excluded.canonical_plugin_id,
  reason = excluded.reason,
  updated_at = excluded.updated_at;

update unified_plugin_versions version
set status = 'QUARANTINED',
    validation_report = jsonb_set(
      case when jsonb_typeof(version.validation_report) = 'object'
        then version.validation_report
        else jsonb_build_object('originalValidationReport', version.validation_report)
      end,
      '{pluginRunnerCutover}',
      jsonb_build_object('status', 'QUARANTINED', 'reason', rejected.reason),
      true
    ),
    updated_at = now()
from gcac_plugin_runner_rejected_versions rejected
where rejected.plugin_version_id = version.id;

-- 未绑定的旧 Runtime 不再拥有执行资格；原 PluginVersion 与旧关系保留，旧关系降为 DISABLED。
create temporary table if not exists gcac_plugin_runner_unbound_versions (
  plugin_version_id varchar(128) primary key
) on commit drop;

truncate gcac_plugin_runner_unbound_versions;

insert into gcac_plugin_runner_unbound_versions (plugin_version_id)
select version.id
from unified_plugin_versions version
where version.runtime in ('AGENT_ATOMIC', 'WORKFLOW_DSL', 'TRUSTED_JS')
  and not exists (
    select 1
    from plugin_runner_version_bindings binding
    where binding.plugin_version_id = version.id
  )
on conflict (plugin_version_id) do nothing;

update unified_plugin_versions version
set status = 'RETIRED',
    updated_at = now()
from gcac_plugin_runner_unbound_versions unbound
where unbound.plugin_version_id = version.id
  and version.status not in ('RETIRED', 'QUARANTINED');

update unified_plugin_bindings binding
set status = 'DISABLED',
    updated_at = now()
from gcac_plugin_runner_unbound_versions unbound
where unbound.plugin_version_id = binding.plugin_version_id
  and binding.status <> 'DISABLED';

update plugin_capability_assignments assignment
set status = 'DISABLED',
    updated_at = now()
from gcac_plugin_runner_unbound_versions unbound
where unbound.plugin_version_id = assignment.plugin_version_id
  and assignment.status <> 'DISABLED';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'uq_unified_plugin_versions_tenant_id'
  ) then
    alter table unified_plugin_versions
      add constraint uq_unified_plugin_versions_tenant_id unique (tenant_id, id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_plugin_runner_version_bindings_tenant_version'
  ) then
    alter table plugin_runner_version_bindings
      add constraint fk_plugin_runner_version_bindings_tenant_version
      foreign key (tenant_id, plugin_version_id)
      references unified_plugin_versions (tenant_id, id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_unified_plugin_versions_plugin_version'
  ) then
    alter table unified_plugin_versions
      add constraint ck_unified_plugin_versions_plugin_version
      check (
        status in ('RETIRED', 'QUARANTINED')
        or plugin_version ~ '^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$'
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_unified_plugin_versions_package_sha256'
  ) then
    alter table unified_plugin_versions
      add constraint ck_unified_plugin_versions_package_sha256
      check (status in ('RETIRED', 'QUARANTINED') or package_sha256 ~ '^sha256:[a-f0-9]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_unified_plugin_versions_manifest_sha256'
  ) then
    alter table unified_plugin_versions
      add constraint ck_unified_plugin_versions_manifest_sha256
      check (status in ('RETIRED', 'QUARANTINED') or manifest_sha256 ~ '^sha256:[a-f0-9]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_unified_plugin_versions_manifest_object'
  ) then
    alter table unified_plugin_versions
      add constraint ck_unified_plugin_versions_manifest_object
      check (status in ('RETIRED', 'QUARANTINED') or jsonb_typeof(manifest) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_unified_plugin_versions_resource_hashes'
  ) then
    alter table unified_plugin_versions
      add constraint ck_unified_plugin_versions_resource_hashes
      check (status in ('RETIRED', 'QUARANTINED') or jsonb_typeof(resource_sha256) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_unified_plugin_versions_canonical_id'
  ) then
    alter table unified_plugin_versions
      add constraint ck_unified_plugin_versions_canonical_id
      check (
        status in ('RETIRED', 'QUARANTINED')
        or plugin_id in (
          'web.nginx', 'web.apache', 'web.iis', 'app.tomcat', 'app.java-keystore',
          'app.rabbitmq', 'app.service-certificate-file', 'device.citrix.netscaler-adc',
          'device.synology-dsm', 'cloud.aliyun', 'cloud.tencent', 'cloud.huawei',
          'cloud.volcengine', 'ca.openssl', 'ca.acme', 'ca.microsoft-adcs', 'ca.acme-dns'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_unified_plugin_versions_runner_manifest'
  ) then
    alter table unified_plugin_versions
      add constraint ck_unified_plugin_versions_runner_manifest
      check (
        status in ('RETIRED', 'QUARANTINED')
        or (
          manifest->>'pluginId' = plugin_id
          and manifest->>'canonicalPluginId' = plugin_id
          and manifest->>'executionMode' = 'isolated_process'
          and manifest->>'version' = plugin_version
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_plugin_runner_version_bindings_tenant'
  ) then
    alter table plugin_runner_version_bindings
      add constraint ck_plugin_runner_version_bindings_tenant
      check (length(trim(tenant_id)) > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_plugin_runner_version_bindings_canonical_id'
  ) then
    alter table plugin_runner_version_bindings
      add constraint ck_plugin_runner_version_bindings_canonical_id
      check (canonical_plugin_id in (
        'web.nginx', 'web.apache', 'web.iis', 'app.tomcat', 'app.java-keystore',
        'app.rabbitmq', 'app.service-certificate-file', 'device.citrix.netscaler-adc',
        'device.synology-dsm', 'cloud.aliyun', 'cloud.tencent', 'cloud.huawei',
        'cloud.volcengine', 'ca.openssl', 'ca.acme', 'ca.microsoft-adcs', 'ca.acme-dns'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_plugin_runner_version_bindings_plugin_version'
  ) then
    alter table plugin_runner_version_bindings
      add constraint ck_plugin_runner_version_bindings_plugin_version
      check (plugin_version ~ '^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_plugin_runner_version_bindings_package_hash'
  ) then
    alter table plugin_runner_version_bindings
      add constraint ck_plugin_runner_version_bindings_package_hash
      check (package_sha256 ~ '^sha256:[a-f0-9]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_plugin_runner_version_bindings_manifest_hash'
  ) then
    alter table plugin_runner_version_bindings
      add constraint ck_plugin_runner_version_bindings_manifest_hash
      check (manifest_sha256 ~ '^sha256:[a-f0-9]{64}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_plugin_runner_version_bindings_resource_hashes'
  ) then
    alter table plugin_runner_version_bindings
      add constraint ck_plugin_runner_version_bindings_resource_hashes
      check (jsonb_typeof(resource_sha256) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'ck_plugin_runner_version_bindings_protocol'
  ) then
    alter table plugin_runner_version_bindings
      add constraint ck_plugin_runner_version_bindings_protocol
      check (execution_mode = 'isolated_process' and protocol_version = 'gcac.plugin-runner/v1');
  end if;
end
$$;

alter table plugin_runner_version_bindings
  alter column tenant_id set not null,
  alter column plugin_version set not null,
  alter column resource_sha256 set default '{}'::jsonb,
  alter column resource_sha256 set not null,
  alter column protocol_version set default 'gcac.plugin-runner/v1',
  alter column protocol_version set not null;

create unique index if not exists uq_plugin_runner_version_bindings_tenant_identity
  on plugin_runner_version_bindings (tenant_id, canonical_plugin_id, plugin_version);

create index if not exists idx_plugin_runner_version_bindings_tenant
  on plugin_runner_version_bindings (tenant_id, canonical_plugin_id, plugin_version_id);

create or replace function gcac_plugin_runner_binding_guard()
returns trigger
language plpgsql
as $$
declare
  source_version unified_plugin_versions%rowtype;
begin
  select * into source_version
  from unified_plugin_versions
  where id = new.plugin_version_id;

  if not found then
    raise exception 'Plugin Runner binding references a missing PluginVersion';
  end if;
  if source_version.status <> 'ENABLED' then
    raise exception 'Plugin Runner binding references a non-enabled PluginVersion';
  end if;
  if new.tenant_id is distinct from source_version.tenant_id then
    raise exception 'Plugin Runner binding tenant does not match PluginVersion tenant';
  end if;
  if new.canonical_plugin_id is distinct from source_version.plugin_id
     or source_version.manifest->>'canonicalPluginId' is distinct from source_version.plugin_id
     or source_version.manifest->>'pluginId' is distinct from source_version.plugin_id then
    raise exception 'Plugin Runner binding canonical Plugin ID does not match PluginVersion';
  end if;
  if new.plugin_version is distinct from source_version.plugin_version
     or source_version.manifest->>'version' is distinct from source_version.plugin_version then
    raise exception 'Plugin Runner binding PluginVersion is not fixed to the manifest version';
  end if;
  if new.package_sha256 is distinct from source_version.package_sha256
     or new.manifest_sha256 is distinct from source_version.manifest_sha256
     or new.resource_sha256 is distinct from coalesce(source_version.resource_sha256, '{}'::jsonb) then
    raise exception 'Plugin Runner binding artifact hash snapshot does not match PluginVersion';
  end if;
  if jsonb_typeof(new.resource_sha256) <> 'object' then
    raise exception 'Plugin Runner binding contains an invalid resource hash snapshot';
  end if;
  if exists (
    select 1
    from jsonb_each_text(new.resource_sha256) resource_item
    where resource_item.value is null
       or resource_item.value !~ '^sha256:[a-f0-9]{64}$'
  ) then
    raise exception 'Plugin Runner binding contains an invalid resource hash snapshot';
  end if;
  if new.execution_mode <> 'isolated_process'
     or new.protocol_version <> 'gcac.plugin-runner/v1' then
    raise exception 'Plugin Runner binding uses a retired execution contract';
  end if;
  if tg_op = 'UPDATE' and (
    old.tenant_id is distinct from new.tenant_id
    or old.plugin_version_id is distinct from new.plugin_version_id
    or old.canonical_plugin_id is distinct from new.canonical_plugin_id
    or old.plugin_version is distinct from new.plugin_version
    or old.execution_mode is distinct from new.execution_mode
    or old.protocol_version is distinct from new.protocol_version
    or old.package_sha256 is distinct from new.package_sha256
    or old.manifest_sha256 is distinct from new.manifest_sha256
    or old.resource_sha256 is distinct from new.resource_sha256
  ) then
    raise exception 'Plugin Runner binding identity, version, protocol or hash is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plugin_runner_binding_guard on plugin_runner_version_bindings;
create trigger trg_plugin_runner_binding_guard
before insert or update on plugin_runner_version_bindings
for each row execute function gcac_plugin_runner_binding_guard();

create or replace function gcac_plugin_runner_version_guard()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from plugin_runner_version_bindings
    where plugin_version_id = old.id
  ) and (
    old.id is distinct from new.id
    or old.tenant_id is distinct from new.tenant_id
    or old.plugin_id is distinct from new.plugin_id
    or old.plugin_version is distinct from new.plugin_version
    or old.runtime is distinct from new.runtime
    or old.manifest is distinct from new.manifest
    or old.package_sha256 is distinct from new.package_sha256
    or old.manifest_sha256 is distinct from new.manifest_sha256
    or old.resource_sha256 is distinct from new.resource_sha256
  ) then
    raise exception 'Bound PluginVersion identity, runtime, manifest or artifact hash is immutable';
  end if;
  if new.status <> 'ENABLED' then
    delete from plugin_runner_version_bindings
    where plugin_version_id = old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_plugin_runner_version_guard on unified_plugin_versions;
create trigger trg_plugin_runner_version_guard
before update on unified_plugin_versions
for each row execute function gcac_plugin_runner_version_guard();

-- 旧 Package、Provider Registry 和 Agent Mount 不再是新 Runner 的数据源。
do $$
begin
  if to_regclass('public.plugin_packages') is not null then
    execute $sql$
      update plugin_packages
      set status = 'UNINSTALLED',
          deleted_at = coalesce(deleted_at, now()),
          updated_at = now(),
          version = version + 1
      where status <> 'UNINSTALLED'
    $sql$;
  end if;

  if to_regclass('public.provider_registry') is not null then
    execute $sql$
      update provider_registry
      set status = 'DEPRECATED',
          deleted_at = coalesce(deleted_at, now()),
          updated_at = now(),
          version = version + 1
      where status <> 'DEPRECATED'
    $sql$;
  end if;

  if to_regclass('public.pg_documents') is not null then
    execute $sql$
      delete from pg_documents
      where namespace = 'plugins:agent-packages'
    $sql$;
    execute $sql$
      update pg_documents
      set payload = jsonb_set(
        jsonb_set(payload, '{installStatus}', to_jsonb('retired'::text), true),
        '{gcacCutover}',
        jsonb_build_object('status', 'RETIRED', 'reason', 'PLUGIN_RUNNER_CANONICAL_CUTOVER'),
        true
      ),
      updated_at = now()
      where namespace = 'plugins:packages'
        and payload->>'installStatus' is distinct from 'retired'
    $sql$;
    execute $sql$
      update pg_documents
      set payload = jsonb_set(
        jsonb_set(payload, '{status}', to_jsonb('retired'::text), true),
        '{gcacCutover}',
        jsonb_build_object('status', 'RETIRED', 'reason', 'PLUGIN_RUNNER_CANONICAL_CUTOVER'),
        true
      ),
      updated_at = now()
      where namespace = 'plugins:catalog-activations'
        and payload->>'status' is distinct from 'retired'
    $sql$;
    execute $sql$
      update pg_documents
      set payload = jsonb_set(
        jsonb_set(payload, '{status}', to_jsonb('retired'::text), true),
        '{gcacCutover}',
        jsonb_build_object('status', 'RETIRED', 'reason', 'PLUGIN_RUNNER_CANONICAL_CUTOVER'),
        true
      ),
      updated_at = now()
      where namespace = 'plugins:executions'
        and lower(coalesce(payload->>'status', '')) in (
          'pending', 'queued', 'running', 'started', 'dispatched', 'retrying', 'cancelling'
        )
        and (
          coalesce(nullif(payload->>'protocolVersion', ''), nullif(payload->>'protocol', ''), '')
              <> 'gcac.plugin-runner/v1'
          or (
            payload ? 'pluginPackageId'
          )
        )
    $sql$;
  end if;
end
$$;

drop table if exists agent_plugin_mounts;
