-- 004.3：退休源码已删除的内置 CA 插件残留版本记录。
-- ca-acme / ca-acme-dns / ca-openssl 三套内置插件包已随源码清理删除，
-- 但此前部署导入 unified_plugin_versions 的 BUILTIN 版本记录仍保留在数据库中；
-- 插件目录从该表读取非 RETIRED 记录，导致目录继续展示已退役插件。
-- 本迁移前向作废这些记录及其关联绑定，不修改任何历史迁移。

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260816-RCA-' || md5(version.id),
  '20260816000200', 'unified_plugin_versions', '', version.id,
  'UPDATE', 'RETIRED_REMOVED_BUILTIN_CA_PLUGIN',
  jsonb_build_object('pluginId', version.plugin_id, 'pluginVersion', version.plugin_version, 'previousStatus', version.status)
from unified_plugin_versions version
where version.plugin_id in ('ca.acme', 'ca.acme-dns', 'ca.openssl')
  and version.status <> 'RETIRED'
on conflict do nothing;

update unified_plugin_versions version
set status = 'RETIRED',
    validation_report = jsonb_set(
      case when jsonb_typeof(version.validation_report) = 'object'
        then version.validation_report
        else jsonb_build_object('originalValidationReport', version.validation_report)
      end,
      '{removedBuiltinCaPlugin}',
      jsonb_build_object('status', 'RETIRED', 'reason', 'REMOVED_BUILTIN_CA_PLUGIN_PACKAGE'),
      true
    ),
    updated_at = now()
where version.plugin_id in ('ca.acme', 'ca.acme-dns', 'ca.openssl')
  and version.status <> 'RETIRED';

-- 关联能力分配与插件绑定一并作废（与旧插件版本清退口径一致）。
insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260816-RCA-' || md5(assignment.id),
  '20260816000200', 'plugin_capability_assignments', '', assignment.id,
  'UPDATE', 'DISABLED_REMOVED_CA_ASSIGNMENT',
  jsonb_build_object('pluginVersionId', assignment.plugin_version_id, 'previousStatus', assignment.status)
from plugin_capability_assignments assignment
join unified_plugin_versions version on version.id = assignment.plugin_version_id
where version.plugin_id in ('ca.acme', 'ca.acme-dns', 'ca.openssl')
  and assignment.status <> 'DISABLED'
on conflict do nothing;

update plugin_capability_assignments assignment
set status = 'DISABLED', updated_at = now()
from unified_plugin_versions version
where version.id = assignment.plugin_version_id
  and version.plugin_id in ('ca.acme', 'ca.acme-dns', 'ca.openssl')
  and assignment.status <> 'DISABLED';

insert into database_forward_cleanup_audits (
  audit_id, migration_version, source_table, source_namespace, source_id, cleanup_action, reason, metadata
)
select
  'P2-F-DB-20260816-RCA-' || md5(binding.id),
  '20260816000200', 'unified_plugin_bindings', '', binding.id,
  'UPDATE', 'DISABLED_REMOVED_CA_BINDING',
  jsonb_build_object('pluginVersionId', binding.plugin_version_id, 'previousStatus', binding.status)
from unified_plugin_bindings binding
join unified_plugin_versions version on version.id = binding.plugin_version_id
where version.plugin_id in ('ca.acme', 'ca.acme-dns', 'ca.openssl')
  and binding.status <> 'DISABLED'
on conflict do nothing;

update unified_plugin_bindings binding
set status = 'DISABLED', updated_at = now()
from unified_plugin_versions version
where version.id = binding.plugin_version_id
  and version.plugin_id in ('ca.acme', 'ca.acme-dns', 'ca.openssl')
  and binding.status <> 'DISABLED';
