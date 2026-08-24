alter table unified_plugin_versions
  drop constraint if exists unified_plugin_versions_runtime_check;

alter table unified_plugin_versions
  add constraint unified_plugin_versions_runtime_check
  check (runtime in ('AGENT_ATOMIC', 'WORKFLOW_DSL', 'TRUSTED_JS'));
