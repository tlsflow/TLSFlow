alter table pg_certificate_renewal_jobs
  add column if not exists created_at timestamptz;

update pg_certificate_renewal_jobs
set created_at = coalesce(created_at, scheduled_at, updated_at, now())
where created_at is null;

alter table pg_certificate_renewal_jobs
  alter column created_at set not null;
