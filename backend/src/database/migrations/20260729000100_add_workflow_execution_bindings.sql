create table if not exists workflow_execution_bindings (
  id text primary key,
  tenant_id text not null,
  workflow_template_id text not null,
  workflow_version_selection text not null,
  workflow_version_id text,
  runner text not null,
  gateway_id text,
  connection_bindings jsonb not null default '{}'::jsonb,
  variable_bindings jsonb not null default '{}'::jsonb,
  credential_bindings jsonb not null default '{}'::jsonb,
  certificate_artifact_bindings jsonb not null default '{}'::jsonb,
  status text not null default 'ACTIVE',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_workflow_execution_bindings_version_selection check (workflow_version_selection in ('PINNED','LATEST_PUBLISHED')),
  constraint ck_workflow_execution_bindings_version check ((workflow_version_selection='PINNED' and workflow_version_id is not null) or (workflow_version_selection='LATEST_PUBLISHED' and workflow_version_id is null)),
  constraint ck_workflow_execution_bindings_runner check (runner in ('CONTROL_PLANE','GATEWAY')),
  constraint ck_workflow_execution_bindings_gateway check ((runner='GATEWAY' and gateway_id is not null) or (runner='CONTROL_PLANE' and gateway_id is null)),
  constraint ck_workflow_execution_bindings_status check (status in ('ACTIVE','DISABLED')),
  constraint ck_workflow_execution_bindings_json check (jsonb_typeof(connection_bindings)='object' and jsonb_typeof(variable_bindings)='object' and jsonb_typeof(credential_bindings)='object' and jsonb_typeof(certificate_artifact_bindings)='object')
);

create index if not exists idx_workflow_execution_bindings_tenant_status on workflow_execution_bindings (tenant_id, status);
create index if not exists idx_workflow_execution_bindings_template on workflow_execution_bindings (tenant_id, workflow_template_id);
