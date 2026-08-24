drop index if exists uq_pg_certificate_versions_fingerprint;

create unique index uq_pg_certificate_versions_fingerprint_active
  on pg_certificate_versions (fingerprint_sha256)
  where status <> 'deleted';
