-- Spec 033.3：修复已补全但仍残留 error 状态的迁移凭据。
-- 凭据修复后先转换为 disabled，必须由管理员明确启用，避免自动影响现有设备和工作流。

with recoverable_profiles as (
  select profile.id
    from credential_profiles profile
   where profile.status = 'error'
     and profile.metadata->>'migratedFrom' in ('workflowCredential', 'citrixLegacyBinding')
     and case profile.kind
       when 'USERNAME_PASSWORD' then
         coalesce(trim(profile.username), '') <> ''
         and profile.secret_slots->>'password' ~ '^secret://password/[A-Za-z0-9_-]+#(current|v[0-9]+)$'
       when 'SSH_KEY' then
         coalesce(trim(profile.username), '') <> ''
         and profile.secret_slots->>'privateKey' ~ '^secret://ssh_key/[A-Za-z0-9_-]+#(current|v[0-9]+)$'
       when 'BEARER_TOKEN' then
         profile.secret_slots->>'token' ~ '^secret://api_token/[A-Za-z0-9_-]+#(current|v[0-9]+)$'
       when 'API_KEY' then
         profile.secret_slots->>'token' ~ '^secret://api_token/[A-Za-z0-9_-]+#(current|v[0-9]+)$'
         and profile.delivery->>'location' in ('header', 'query', 'cookie')
         and coalesce(trim(profile.delivery->>'name'), '') <> ''
       else false
     end
     and exists (
       select 1
         from pg_documents secret
        where secret.namespace = 'security.secrets'
          and secret.document_id = substring(
            case profile.kind
              when 'USERNAME_PASSWORD' then profile.secret_slots->>'password'
              when 'SSH_KEY' then profile.secret_slots->>'privateKey'
              else profile.secret_slots->>'token'
            end
            from '^secret://[A-Za-z0-9_]+/([^#]+)#(current|v[0-9]+)$'
          )
     )
)
update credential_profiles profile
   set status = 'disabled',
       version = profile.version + 1,
       metadata = profile.metadata || jsonb_build_object(
         'recoveredFromErrorAt', now(),
         'recoveryReason', 'credential_profile_complete'
       ),
       updated_at = now()
  from recoverable_profiles recoverable
 where profile.id = recoverable.id;
