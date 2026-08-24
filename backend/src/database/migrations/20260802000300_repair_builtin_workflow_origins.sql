-- 迁移目的：修复历史启动流程先创建 user 模板、后创建内置插件 Binding 导致的来源误标。
-- 只依据 BUILTIN 插件、SYSTEM 所有权和实际 Binding 关系修复，不按工作流名称猜测来源。

update pg_documents template
   set payload = jsonb_set(
                   jsonb_set(
                     jsonb_set(template.payload, '{origin}', to_jsonb('plugin_internal'::text), true),
                     '{ownerType}', to_jsonb('SYSTEM'::text), true
                   ),
                   '{ownerId}', to_jsonb('SYSTEM'::text), true
                 ),
       updated_at = now()
 where template.namespace = 'workflow.templates'
   and exists (
     select 1
       from unified_plugin_workflow_bindings binding
       join unified_plugin_versions plugin
         on plugin.id = binding.plugin_version_id
      where binding.workflow_template_id = template.document_id
        and plugin.source = 'BUILTIN'
        and plugin.owner_type = 'SYSTEM'
        and binding.owner_type = 'SYSTEM'
        and binding.owner_id is null
   )
   and coalesce(template.payload->>'origin', 'user') <> 'plugin_internal';
