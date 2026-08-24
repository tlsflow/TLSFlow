alter table plugin_discovered_certificates
  add column if not exists certificate_version_id text references pg_certificate_versions(id);

alter table plugin_discovered_certificate_bindings
  add column if not exists current_certificate_version_id text references pg_certificate_versions(id),
  add column if not exists desired_certificate_version_id text references pg_certificate_versions(id),
  add column if not exists observed_fingerprint_sha256 varchar(64),
  add column if not exists desired_fingerprint_sha256 varchar(64),
  add column if not exists drift_state varchar(24) not null default 'UNKNOWN'
    check (drift_state in ('SYNCED', 'DRIFTED', 'UNMANAGED', 'INCOMPLETE', 'UNKNOWN')),
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_deployed_at timestamptz;

create index if not exists idx_plugin_discovered_certificates_version
  on plugin_discovered_certificates (tenant_id, certificate_version_id);

create index if not exists idx_plugin_discovered_bindings_drift
  on plugin_discovered_certificate_bindings (tenant_id, device_asset_id, drift_state);
