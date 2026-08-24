create table pg_ca_serial_states (
  tenant_id text not null,
  ca_id text not null,
  next_serial numeric(39, 0) not null check (next_serial > 0),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, ca_id)
);

create table pg_ca_issuance_records (
  id text primary key,
  tenant_id text not null,
  ca_id text not null,
  serial_number text not null,
  certificate_request_id text,
  certificate_version_id text,
  application_asset_id text,
  status text not null check (status in ('reserved', 'issued', 'revoked', 'expired', 'failed')),
  record_origin text not null check (record_origin in ('native', 'historical_backfill', 'external')),
  subject_common_name text,
  sans jsonb not null default '[]'::jsonb,
  certificate_fingerprint_sha256 text,
  public_key_fingerprint_sha256 text,
  not_before timestamptz,
  not_after timestamptz,
  issued_at timestamptz,
  observed_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint uq_ca_issuance_serial unique (tenant_id, ca_id, serial_number)
);

create unique index uq_ca_issuance_request
  on pg_ca_issuance_records (tenant_id, certificate_request_id)
  where certificate_request_id is not null;

create index idx_ca_issuance_ca_status
  on pg_ca_issuance_records (tenant_id, ca_id, status, created_at desc);

create index idx_ca_issuance_certificate_version
  on pg_ca_issuance_records (tenant_id, certificate_version_id)
  where certificate_version_id is not null;
