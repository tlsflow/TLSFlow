-- 20260810000100：将 Plugin Runner 专用版本约束限制在内置 Agent Atomic 版本。
-- 20260809000200 将这些约束直接施加于通用版本表，错误阻塞了用户插件、Workflow DSL 和 Trusted JS。
-- 本迁移保留约束及 17 个 Canonical Plugin ID，只修正约束适用的数据语义。

alter table unified_plugin_versions
  drop constraint if exists ck_unified_plugin_versions_plugin_version,
  drop constraint if exists ck_unified_plugin_versions_package_sha256,
  drop constraint if exists ck_unified_plugin_versions_manifest_sha256,
  drop constraint if exists ck_unified_plugin_versions_manifest_object,
  drop constraint if exists ck_unified_plugin_versions_resource_hashes,
  drop constraint if exists ck_unified_plugin_versions_canonical_id,
  drop constraint if exists ck_unified_plugin_versions_runner_manifest;

alter table unified_plugin_versions
  add constraint ck_unified_plugin_versions_plugin_version
  check (
    not (source = 'BUILTIN' and runtime = 'AGENT_ATOMIC')
    or status in ('RETIRED', 'QUARANTINED')
    or plugin_version ~ '^[0-9]+[.][0-9]+[.][0-9]+([-][0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$'
  ),
  add constraint ck_unified_plugin_versions_package_sha256
  check (
    not (source = 'BUILTIN' and runtime = 'AGENT_ATOMIC')
    or status in ('RETIRED', 'QUARANTINED')
    or package_sha256 ~ '^sha256:[a-f0-9]{64}$'
  ),
  add constraint ck_unified_plugin_versions_manifest_sha256
  check (
    not (source = 'BUILTIN' and runtime = 'AGENT_ATOMIC')
    or status in ('RETIRED', 'QUARANTINED')
    or manifest_sha256 ~ '^sha256:[a-f0-9]{64}$'
  ),
  add constraint ck_unified_plugin_versions_manifest_object
  check (
    not (source = 'BUILTIN' and runtime = 'AGENT_ATOMIC')
    or status in ('RETIRED', 'QUARANTINED')
    or jsonb_typeof(manifest) = 'object'
  ),
  add constraint ck_unified_plugin_versions_resource_hashes
  check (
    not (source = 'BUILTIN' and runtime = 'AGENT_ATOMIC')
    or status in ('RETIRED', 'QUARANTINED')
    or jsonb_typeof(resource_sha256) = 'object'
  ),
  add constraint ck_unified_plugin_versions_canonical_id
  check (
    not (source = 'BUILTIN' and runtime = 'AGENT_ATOMIC')
    or status in ('RETIRED', 'QUARANTINED')
    or plugin_id in (
      'web.nginx', 'web.apache', 'web.iis', 'app.tomcat', 'app.java-keystore',
      'app.rabbitmq', 'app.service-certificate-file', 'device.citrix.netscaler-adc',
      'device.synology-dsm', 'cloud.aliyun', 'cloud.tencent', 'cloud.huawei',
      'cloud.volcengine', 'ca.openssl', 'ca.acme', 'ca.microsoft-adcs', 'ca.acme-dns'
    )
  ),
  add constraint ck_unified_plugin_versions_runner_manifest
  check (
    not (source = 'BUILTIN' and runtime = 'AGENT_ATOMIC')
    or status in ('RETIRED', 'QUARANTINED')
    or (
      manifest->>'pluginId' = plugin_id
      and manifest->>'canonicalPluginId' = plugin_id
      and manifest->>'executionMode' = 'isolated_process'
      and manifest->>'version' = plugin_version
    )
  );
