-- ACME 首次申请没有旧证书版本，允许 RenewalJob 先关联 CertificateRequest 再产生版本。
alter table pg_certificate_renewal_jobs
  alter column certificate_version_id drop not null;

create unique index if not exists uq_pg_certificate_renewal_jobs_acme_initial
  on pg_certificate_renewal_jobs (tenant_id, renewal_window_key)
  where source_certificate_version_id is null
    and policy_id is not null
    and status not in ('completed', 'failed', 'rollback_required', 'cancelled', 'issued_waiting_for_installation');
