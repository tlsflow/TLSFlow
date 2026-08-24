-- 首次 ACME 申请尚未取得证书版本，RenewalJob 必须允许先仅关联 CertificateRequest。
-- 20260809000800 在退役旧运行时后收紧了该列；恢复原生 ACME 后需要以新迁移恢复该合同。
alter table if exists pg_certificate_renewal_jobs
  alter column certificate_version_id drop not null;

create unique index if not exists uq_pg_certificate_renewal_jobs_acme_initial
  on pg_certificate_renewal_jobs (tenant_id, renewal_window_key)
  where source_certificate_version_id is null
    and policy_id is not null
    and status not in ('completed', 'failed', 'rollback_required', 'cancelled', 'issued_waiting_for_installation');
