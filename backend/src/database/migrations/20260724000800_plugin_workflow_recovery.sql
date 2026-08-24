create table if not exists plugin_workflow_ledgers (
  id text primary key,
  tenant_id text not null,
  execution_run_id text not null,
  execution_step_id text not null,
  deployment_plan_target_id text,
  plugin_version_id text not null,
  workflow_version_id text not null,
  capability_key text not null,
  target_hash varchar(64) not null,
  plan_hash varchar(64) not null,
  input_hash varchar(64) not null,
  status varchar(32) not null check (status in ('ACTIVE','COMPLETED','ROLLBACK_RUNNING','ROLLED_BACK','MANUAL_INTERVENTION')),
  recovery_classification varchar(32) not null default 'RESUMABLE'
    check (recovery_classification in ('RESUMABLE','ROLLBACK_REQUIRED','MANUAL_INTERVENTION')),
  completed_step_ids jsonb not null default '[]'::jsonb,
  compensation_step_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, execution_run_id, execution_step_id)
);

create table if not exists plugin_workflow_checkpoints (
  id text primary key,
  tenant_id text not null,
  ledger_id text not null references plugin_workflow_ledgers(id) on delete cascade,
  checkpoint_name text not null,
  workflow_step_name text not null,
  capture jsonb not null,
  capture_hash varchar(64) not null,
  required_for_rollback boolean not null default false,
  created_at timestamptz not null,
  unique (ledger_id, checkpoint_name)
);

create table if not exists plugin_resource_locks (
  id text primary key,
  tenant_id text not null,
  resource_key text not null,
  lock_mode varchar(8) not null check (lock_mode in ('READ','WRITE')),
  owner_run_id text not null,
  owner_step_id text not null,
  fencing_token bigint not null,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, resource_key, owner_run_id, owner_step_id)
);

create index if not exists idx_plugin_workflow_ledgers_recovery
  on plugin_workflow_ledgers (tenant_id, status, recovery_classification, updated_at);

create index if not exists idx_plugin_workflow_checkpoints_ledger
  on plugin_workflow_checkpoints (tenant_id, ledger_id, created_at);

create index if not exists idx_plugin_resource_locks_active
  on plugin_resource_locks (tenant_id, resource_key, expires_at);
