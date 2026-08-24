-- 插件 Workflow 绑定必须使用工作流版本的规范化 contentHash。
-- 旧版本发布器曾写入插件资源原始 JSON 文本哈希，导致来源查询误判为哈希不一致。
update unified_plugin_workflow_bindings binding
   set workflow_content_sha256 = version.payload->>'contentHash'
  from pg_documents version
 where version.namespace = 'workflow.template_versions'
   and version.document_id = binding.workflow_version_id
   and coalesce(version.payload->>'contentHash', '') <> ''
   and binding.workflow_content_sha256 <> version.payload->>'contentHash';
