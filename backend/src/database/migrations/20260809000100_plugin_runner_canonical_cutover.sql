-- 004.5 未发布数据切换到 Canonical Plugin ID 和进程级 Runner。
-- 本迁移只建立临时的版本绑定证据；Canonical ID 的实际改写由 00200 在去重后完成，避免撞击
-- core schema 的 (tenant_id, plugin_id, plugin_version) 唯一约束。
-- 该迁移只修正当前数据库记录，不修改任何已经存在的历史迁移文件。

create table if not exists plugin_runner_version_bindings (
  plugin_version_id varchar(128) primary key references unified_plugin_versions(id) on delete restrict,
  canonical_plugin_id varchar(192) not null,
  execution_mode varchar(32) not null check (execution_mode = 'isolated_process'),
  package_sha256 varchar(80) not null,
  manifest_sha256 varchar(80) not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

insert into plugin_runner_version_bindings (
  plugin_version_id, canonical_plugin_id, execution_mode, package_sha256, manifest_sha256, created_at, updated_at
)
select
  id,
  case plugin_id
  when 'builtin.linux.nginx.pem' then 'web.nginx'
  when 'builtin.windows.nginx.pem' then 'web.nginx'
  when 'builtin.windows.apache.pem' then 'web.apache'
  when 'builtin.workflow.apache-8444-cert-switch' then 'web.apache'
  when 'builtin.windows.iis.pfx' then 'web.iis'
  when 'builtin.windows.tomcat.pkcs12' then 'app.tomcat'
  when 'builtin.java.pkcs12' then 'app.java-keystore'
  when 'builtin.rabbitmq.pem' then 'app.rabbitmq'
  when 'builtin.windows.custom.certificate' then 'app.service-certificate-file'
  when 'builtin.windows-service.certificate-file' then 'app.service-certificate-file'
  when 'citrix.netscaler-adc' then 'device.citrix.netscaler-adc'
  when 'builtin.workflow.synology-dsm-cert-import' then 'device.synology-dsm'
  when 'builtin.cloud.aliyun.provider' then 'cloud.aliyun'
  when 'builtin.cloud.tencent.provider' then 'cloud.tencent'
  when 'builtin.cloud.huawei.provider' then 'cloud.huawei'
  when 'builtin.cloud.volcengine.provider' then 'cloud.volcengine'
  when 'openssl' then 'ca.openssl'
  when 'acme' then 'ca.acme'
  when 'acme-dns' then 'ca.acme-dns'
  when 'microsoft_adcs' then 'ca.microsoft-adcs'
  else null
  end,
  'isolated_process',
  package_sha256,
  manifest_sha256,
  created_at,
  updated_at
from unified_plugin_versions
where plugin_id in (
  'builtin.linux.nginx.pem', 'builtin.windows.nginx.pem', 'builtin.windows.apache.pem',
  'builtin.workflow.apache-8444-cert-switch', 'builtin.windows.iis.pfx', 'builtin.windows.tomcat.pkcs12',
  'builtin.java.pkcs12', 'builtin.rabbitmq.pem', 'builtin.windows.custom.certificate',
  'builtin.windows-service.certificate-file', 'citrix.netscaler-adc',
  'builtin.workflow.synology-dsm-cert-import', 'builtin.cloud.aliyun.provider',
  'builtin.cloud.tencent.provider', 'builtin.cloud.huawei.provider', 'builtin.cloud.volcengine.provider',
  'openssl', 'acme', 'acme-dns', 'microsoft_adcs'
)
  and status = 'ENABLED'
on conflict (plugin_version_id) do update set
  canonical_plugin_id = excluded.canonical_plugin_id,
  execution_mode = excluded.execution_mode,
  package_sha256 = excluded.package_sha256,
  manifest_sha256 = excluded.manifest_sha256,
  updated_at = excluded.updated_at;

create index if not exists idx_plugin_runner_version_bindings_canonical
  on plugin_runner_version_bindings (canonical_plugin_id, execution_mode);
