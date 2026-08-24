alter table pg_ca_issuance_records
  add column revocation_reason text,
  add column revoked_at timestamptz,
  add column invalidity_date timestamptz;

create index idx_ca_issuance_revoked
  on pg_ca_issuance_records (tenant_id, ca_id, revoked_at desc)
  where status = 'revoked';
