alter table pg_certificate_version_formats
  add column if not exists parameters jsonb not null default '{}'::jsonb;
