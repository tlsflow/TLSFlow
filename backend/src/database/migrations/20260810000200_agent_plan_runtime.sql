-- Agent Plan 是受 Agent v2 编译器处理的声明式运行时；只扩展当前约束，不修改历史迁移。
alter table unified_plugin_versions
  drop constraint if exists unified_plugin_versions_runtime_check;

alter table unified_plugin_versions
  add constraint unified_plugin_versions_runtime_check
  check (runtime in ('AGENT_PLAN', 'WORKFLOW_DSL', 'TRUSTED_JS'));
