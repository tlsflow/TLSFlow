create table pg_ca_external_observations (
  id text primary key,
  tenant_id text not null,
  provider_id text not null,
  ca_id text not null,
  object_type text not null check (object_type in ('request', 'issuance', 'revocation', 'template')),
  external_object_id text not null,
  external_parent_id text,
  normalized_status text not null check (normalized_status in ('pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown')),
  source_status text,
  source_revision text,
  subject_common_name text,
  serial_number text,
  template_external_id text,
  requested_by_display text,
  submitted_at timestamptz,
  issued_at timestamptz,
  revoked_at timestamptz,
  not_before timestamptz,
  not_after timestamptz,
  raw_summary jsonb not null,
  observed_at timestamptz not null,
  first_observed_at timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint uq_ca_external_observation unique (tenant_id, provider_id, ca_id, object_type, external_object_id)
);

create index idx_ca_external_observations_list
  on pg_ca_external_observations (tenant_id, ca_id, object_type, observed_at desc, id desc);

create index idx_ca_external_observations_status
  on pg_ca_external_observations (tenant_id, ca_id, object_type, normalized_status, observed_at desc, id desc);

create index idx_ca_external_observations_serial
  on pg_ca_external_observations (tenant_id, ca_id, serial_number)
  where serial_number is not null;

create table pg_ca_sync_runs (
  id text primary key,
  tenant_id text not null,
  provider_id text not null,
  ca_id text not null,
  object_type text not null check (object_type in ('request', 'issuance', 'revocation', 'template')),
  mode text not null check (mode in ('incremental', 'full')),
  status text not null check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  cursor_before text,
  cursor_after text,
  source_watermark text,
  read_count integer not null default 0 check (read_count >= 0),
  upserted_count integer not null default 0 check (upserted_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_code text,
  error_message text,
  lease_owner text,
  lease_expires_at timestamptz,
  requested_by text not null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index uq_ca_sync_runs_active_scope
  on pg_ca_sync_runs (tenant_id, provider_id, ca_id, object_type)
  where status in ('queued', 'running');

create index idx_ca_sync_runs_recent
  on pg_ca_sync_runs (tenant_id, ca_id, object_type, created_at desc);

create index idx_ca_sync_runs_recoverable_lease
  on pg_ca_sync_runs (lease_expires_at)
  where status = 'running' and lease_expires_at is not null;

create table pg_ca_template_mappings (
  id text primary key,
  tenant_id text not null,
  provider_id text not null,
  ca_id text not null,
  profile_version_id text not null,
  external_template_id text not null,
  status text not null check (status in ('active', 'stale', 'invalid', 'disabled')),
  validation_summary jsonb not null,
  version integer not null check (version > 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint uq_ca_template_mapping unique (tenant_id, ca_id, profile_version_id, external_template_id)
);

create index idx_ca_template_mappings_list
  on pg_ca_template_mappings (tenant_id, ca_id, status, updated_at desc, id desc);
