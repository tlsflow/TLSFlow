alter table unified_plugin_bindings
  add column if not exists credential_bindings jsonb not null default '{}'::jsonb;

alter table unified_plugin_bindings
  add constraint ck_unified_plugin_bindings_credential_bindings_object
  check (jsonb_typeof(credential_bindings) = 'object');

create index if not exists idx_unified_plugin_bindings_credential_bindings
  on unified_plugin_bindings using gin (credential_bindings);
