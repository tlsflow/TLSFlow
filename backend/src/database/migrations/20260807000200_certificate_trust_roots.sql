create table if not exists pg_root_certificate_records (
  id text primary key,
  fingerprint_sha256 char(64) not null,
  certificate_artifact_ref text not null,
  subject jsonb not null,
  issuer jsonb not null,
  serial_number varchar(256) not null,
  not_before timestamptz not null,
  not_after timestamptz not null,
  basic_constraints jsonb not null default '{}'::jsonb,
  validation_status varchar(32) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_pg_root_certificate_records_fingerprint
  on pg_root_certificate_records (fingerprint_sha256);

create table if not exists pg_root_certificate_source_observations (
  id text primary key,
  root_certificate_id text not null references pg_root_certificate_records(id),
  source_type varchar(64) not null,
  source_ref text,
  observed_fingerprint char(64) not null,
  observed_at timestamptz not null,
  status varchar(32) not null,
  failure_code varchar(128)
);

create index if not exists idx_pg_root_certificate_source_observations_root
  on pg_root_certificate_source_observations (root_certificate_id, observed_at desc);

create table if not exists pg_certificate_version_trust_roots (
  id text primary key,
  tenant_id text,
  certificate_version_id text not null references pg_certificate_versions(id),
  root_certificate_id text not null references pg_root_certificate_records(id),
  relation varchar(32) not null,
  chain_path jsonb not null default '[]'::jsonb,
  selection_reason text,
  resolution_status varchar(32) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_pg_certificate_version_trust_roots_relation
  on pg_certificate_version_trust_roots (tenant_id, certificate_version_id, relation);

create index if not exists idx_pg_certificate_version_trust_roots_version
  on pg_certificate_version_trust_roots (tenant_id, certificate_version_id, created_at desc);

create index if not exists idx_pg_certificate_version_trust_roots_root
  on pg_certificate_version_trust_roots (tenant_id, root_certificate_id, created_at desc);
