-- 旧 workflow-templates 接口继续保留兼容，但新 workflows 接口必须能排除旧逻辑记录。
-- 已被统一插件绑定引用的模板属于 plugin，其余既有模板属于 legacy。

update pg_documents template
   set payload = jsonb_set(
         template.payload,
         '{origin}',
         to_jsonb(
           case
             when exists (
               select 1
                 from unified_plugin_workflow_bindings binding
                where binding.workflow_template_id = template.document_id
             ) then 'plugin'
             else 'legacy'
           end
         ),
         true
       ),
       updated_at = now()
 where template.namespace = 'workflow.templates'
   and not template.payload ? 'origin';
