alter table plugin_discovered_certificates
  add column if not exists not_before timestamptz;
