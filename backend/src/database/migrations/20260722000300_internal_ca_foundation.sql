create table if not exists pg_ca_providers (
  id text primary key,
  tenant_id text not null,
  name text not null,
  type text not null,
  deployment_mode text not null,
  runtime_platform text not null,
  availability_mode text not null,
  endpoint text,
  credential_secret_ref text,
  capabilities jsonb not null default '{}'::jsonb,
  status text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_ca_providers_tenant_name on pg_ca_providers (tenant_id, lower(name));
create index if not exists idx_pg_ca_providers_tenant_status on pg_ca_providers (tenant_id, status);

create table if not exists pg_certificate_authorities (
  id text primary key,
  tenant_id text not null,
  name text not null,
  role text not null,
  parent_ca_id text references pg_certificate_authorities(id),
  topology_mode text not null,
  provider_id text not null references pg_ca_providers(id),
  key_reference_id text,
  certificate_version_id text references pg_certificate_versions(id),
  security_domain text not null,
  status text not null,
  path_length_constraint integer,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check ((role = 'root' and parent_ca_id is null) or (role = 'intermediate' and parent_ca_id is not null))
);

create unique index if not exists uq_pg_certificate_authorities_tenant_name on pg_certificate_authorities (tenant_id, lower(name));
create index if not exists idx_pg_certificate_authorities_provider_status on pg_certificate_authorities (provider_id, status);

create table if not exists pg_ca_nodes (
  id text primary key,
  tenant_id text not null,
  provider_id text not null references pg_ca_providers(id),
  name text not null,
  platform text not null,
  role text not null,
  identity_fingerprint text not null,
  key_backend text not null,
  exportability text not null,
  capabilities jsonb not null default '{}'::jsonb,
  health_status text not null,
  last_heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_ca_nodes_identity on pg_ca_nodes (tenant_id, identity_fingerprint);
create index if not exists idx_pg_ca_nodes_provider_health on pg_ca_nodes (provider_id, health_status, last_heartbeat_at desc);

create table if not exists pg_ca_node_enrollment_tokens (
  id text primary key,
  tenant_id text not null,
  provider_id text not null references pg_ca_providers(id),
  token_hash text not null,
  status text not null,
  expires_at timestamptz not null,
  created_by text not null,
  created_at timestamptz not null,
  used_at timestamptz
);

create unique index if not exists uq_pg_ca_node_enrollment_token_hash on pg_ca_node_enrollment_tokens (token_hash);

create table if not exists pg_ca_node_tasks (
  id text primary key,
  tenant_id text not null,
  provider_id text not null references pg_ca_providers(id),
  node_id text references pg_ca_nodes(id),
  task_type text not null,
  idempotency_key text not null,
  payload jsonb not null,
  status text not null,
  lease_expires_at timestamptz,
  result jsonb,
  error_code text,
  error_message text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_ca_node_tasks_idempotency on pg_ca_node_tasks (tenant_id, idempotency_key);
create index if not exists idx_pg_ca_node_tasks_lease on pg_ca_node_tasks (provider_id, status, created_at);

create table if not exists pg_key_references (
  id text primary key,
  tenant_id text not null,
  owner_type text not null,
  owner_id text not null,
  custody_mode text not null,
  backend_type text not null,
  opaque_reference text,
  secret_ref text,
  public_key_fingerprint_sha256 text not null,
  exportability text not null,
  protection_level text not null,
  status text not null,
  rotated_from_key_id text references pg_key_references(id),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_pg_key_references_public_key on pg_key_references (tenant_id, public_key_fingerprint_sha256, status);
create index if not exists idx_pg_key_references_owner on pg_key_references (tenant_id, owner_type, owner_id, status);

create table if not exists pg_certificate_profiles (
  id text primary key,
  tenant_id text not null,
  name text not null,
  security_domain text not null,
  status text not null,
  current_version integer not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_certificate_profiles_tenant_name on pg_certificate_profiles (tenant_id, lower(name));

create table if not exists pg_certificate_profile_versions (
  id text primary key,
  profile_id text not null references pg_certificate_profiles(id),
  version_no integer not null,
  rules jsonb not null,
  created_by text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_certificate_profile_versions on pg_certificate_profile_versions (profile_id, version_no);

create table if not exists pg_certificate_requests (
  id text primary key,
  tenant_id text not null,
  application_asset_id text not null,
  ca_id text not null references pg_certificate_authorities(id),
  profile_version_id text not null references pg_certificate_profile_versions(id),
  key_reference_id text not null references pg_key_references(id),
  csr_pem text not null,
  csr_sha256 text not null,
  public_key_fingerprint_sha256 text not null,
  idempotency_key text not null,
  status text not null,
  requested_by text not null,
  approved_by text,
  provider_request_id text,
  certificate_version_id text references pg_certificate_versions(id),
  failure_code text,
  failure_message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_certificate_requests_idempotency on pg_certificate_requests (tenant_id, idempotency_key);
create index if not exists idx_pg_certificate_requests_status on pg_certificate_requests (tenant_id, status, created_at desc);
create index if not exists idx_pg_certificate_requests_public_key on pg_certificate_requests (tenant_id, public_key_fingerprint_sha256);

create table if not exists pg_certificate_issuances (
  id text primary key,
  tenant_id text not null,
  certificate_request_id text not null references pg_certificate_requests(id),
  provider_id text not null references pg_ca_providers(id),
  provider_request_id text,
  serial_number text,
  status text not null,
  result_fingerprint_sha256 text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_certificate_issuances_request on pg_certificate_issuances (certificate_request_id);

create table if not exists pg_certificate_renewal_jobs (
  id text primary key,
  tenant_id text not null,
  certificate_version_id text not null references pg_certificate_versions(id),
  renewal_window_key text not null,
  status text not null,
  certificate_request_id text references pg_certificate_requests(id),
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists uq_pg_certificate_renewal_jobs_window on pg_certificate_renewal_jobs (tenant_id, certificate_version_id, renewal_window_key);

create table if not exists pg_certificate_revocations (
  id text primary key,
  tenant_id text not null,
  certificate_version_id text not null references pg_certificate_versions(id),
  ca_id text not null references pg_certificate_authorities(id),
  reason text not null,
  status text not null,
  requested_by text not null,
  revoked_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists pg_trust_distributions (
  id text primary key,
  tenant_id text not null,
  ca_id text not null references pg_certificate_authorities(id),
  target_scope jsonb not null,
  status text not null,
  requested_by text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table pg_certificate_versions
  add column if not exists public_key_fingerprint_sha256 text,
  add column if not exists issuing_ca_id text references pg_certificate_authorities(id),
  add column if not exists certificate_request_id text references pg_certificate_requests(id),
  add column if not exists certificate_profile_version_id text references pg_certificate_profile_versions(id),
  add column if not exists key_reference_id text references pg_key_references(id),
  add column if not exists key_custody_mode text;

create index if not exists idx_pg_certificate_versions_public_key
  on pg_certificate_versions (public_key_fingerprint_sha256)
  where public_key_fingerprint_sha256 is not null;
