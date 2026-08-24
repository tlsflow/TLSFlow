-- 004.5：将 Plugin Runner 专用约束收回到 Runner 绑定边界。
-- 20260809000200 错误地把 Canonical Plugin ID 和 isolated_process Manifest
-- 约束直接施加到通用 PluginVersion 表，阻塞了合法的用户插件和 WORKFLOW_DSL。
-- 本迁移只修正约束归属，不放宽通用版本号、制品摘要或 Manifest 结构校验。

alter table unified_plugin_versions
  drop constraint if exists ck_unified_plugin_versions_canonical_id,
  drop constraint if exists ck_unified_plugin_versions_runner_manifest;
