-- Spec 033.3：将历史工作流 Secret 身份和 Citrix 旧绑定硬切到全局 CredentialProfile。

with legacy_workflow_secrets as (
  select document_id secret_id,
         payload,
         coalesce(nullif(payload->'metadata'->>'tenantId', ''), '00000000-0000-0000-0000-000000000000') tenant_id,
         case payload->'metadata'->>'workflowCredentialKind'
           when 'username_password' then 'USERNAME_PASSWORD'
           when 'ssh_key' then 'SSH_KEY'
           when 'curl_bearer' then 'BEARER_TOKEN'
           when 'curl_api_key' then 'API_KEY'
         end credential_kind,
         case payload->>'type'
           when 'password' then 'password'
           when 'ssh_key' then 'privateKey'
           when 'api_token' then 'token'
         end slot_name
    from pg_documents
   where namespace = 'security.secrets'
     and payload->'metadata'->>'workflowCredential' = 'true'
), inserted_profiles as (
  insert into credential_profiles (
    id, tenant_id, name, kind, scope_type, scope_id, username, delivery,
    secret_slots, metadata, status, version, created_by, created_at, updated_at
  )
  select 'cred_cutover_' || substr(md5(tenant_id || ':' || secret_id), 1, 24),
         tenant_id,
         coalesce(nullif(payload->>'name', ''), secret_id) || ' [' || right(secret_id, 8) || ']',
         credential_kind,
         case when payload->>'scopeType' in ('global','team','zone','host','plugin') then payload->>'scopeType' else 'global' end,
         case when payload->>'scopeType' in ('team','zone','host','plugin') then nullif(payload->>'scopeId', '') end,
         nullif(payload->'metadata'->>'username', ''),
         case when credential_kind = 'API_KEY' then jsonb_strip_nulls(jsonb_build_object(
           'location', nullif(payload->'metadata'->>'apiKeyIn', ''),
           'name', nullif(payload->'metadata'->>'apiKeyName', '')
         )) else '{}'::jsonb end,
         jsonb_build_object(slot_name, 'secret://' || (payload->>'type') || '/' || secret_id || '#current'),
         jsonb_build_object('migratedFrom', 'workflowCredential', 'migratedFromSecretId', secret_id),
         case
           when credential_kind in ('USERNAME_PASSWORD','SSH_KEY') and coalesce(payload->'metadata'->>'username', '') = '' then 'error'
           else 'active'
         end,
         1,
         coalesce(nullif(payload->>'createdBy', ''), 'system_migration'),
         coalesce((payload->>'createdAt')::timestamptz, now()),
         now()
    from legacy_workflow_secrets
   where credential_kind is not null and slot_name is not null
  on conflict (id) do nothing
  returning id
)
update pg_documents secret
   set payload = jsonb_set(
         secret.payload,
         '{metadata}',
         coalesce(secret.payload->'metadata', '{}'::jsonb)
           - 'workflowCredential'
           - 'workflowCredentialKind'
           - 'username'
           - 'apiKeyName'
           - 'apiKeyIn',
         true
       ),
       updated_at = now()
 where secret.namespace = 'security.secrets'
   and secret.payload->'metadata'->>'workflowCredential' = 'true';

with citrix_legacy_bindings as (
  select binding.id binding_id,
         binding.tenant_id,
         binding.secret_bindings->>'credential' secret_ref,
         nullif(binding.variable_bindings->>'credentialUsername', '') username
    from unified_plugin_bindings binding
    join unified_plugin_versions version on version.id = binding.plugin_version_id
   where version.plugin_id = 'citrix.netscaler-adc'
     and coalesce(binding.secret_bindings->>'credential', '') <> ''
), inserted_citrix_profiles as (
  insert into credential_profiles (
    id, tenant_id, name, kind, scope_type, username, delivery, secret_slots,
    metadata, status, version, created_by, created_at, updated_at
  )
  select 'cred_cutover_' || substr(md5(tenant_id || ':citrix:' || binding_id), 1, 24),
         tenant_id,
         'Citrix ADC [' || right(binding_id, 8) || ']',
         'USERNAME_PASSWORD',
         'global',
         username,
         '{}'::jsonb,
         jsonb_build_object('password', secret_ref),
         jsonb_build_object('migratedFrom', 'citrixLegacyBinding', 'pluginBindingId', binding_id),
         case when username is null or secret_ref !~ '^secret://password/[A-Za-z0-9_-]+#(current|v[0-9]+)$' then 'error' else 'active' end,
         1,
         'system_migration',
         now(),
         now()
    from citrix_legacy_bindings
  on conflict (id) do nothing
  returning id
)
update unified_plugin_bindings binding
   set credential_bindings = jsonb_set(
         binding.credential_bindings,
         '{credential}',
         jsonb_build_object('credentialId', 'cred_cutover_' || substr(md5(binding.tenant_id || ':citrix:' || binding.id), 1, 24)),
         true
       ),
       variable_bindings = binding.variable_bindings - 'credentialUsername',
       secret_bindings = binding.secret_bindings - 'credential',
       status = case
         when coalesce(binding.variable_bindings->>'credentialUsername', '') = ''
           or binding.secret_bindings->>'credential' !~ '^secret://password/[A-Za-z0-9_-]+#(current|v[0-9]+)$'
         then 'ERROR'
         else binding.status
       end,
       version = binding.version + 1,
       updated_at = now()
  from unified_plugin_versions plugin
 where plugin.id = binding.plugin_version_id
   and plugin.plugin_id = 'citrix.netscaler-adc'
   and coalesce(binding.secret_bindings->>'credential', '') <> '';

update pg_service_assets asset
   set metadata = jsonb_set(
         asset.metadata,
         '{deploymentStrategy,workflow}',
         coalesce(asset.metadata->'deploymentStrategy'->'workflow', '{}'::jsonb) - 'credentialRefs',
         true
       ),
       version = asset.version + 1,
       updated_at = now()
 where asset.asset_kind = 'APPLICATION'
   and asset.metadata->'deploymentStrategy'->'workflow' ? 'credentialRefs';
