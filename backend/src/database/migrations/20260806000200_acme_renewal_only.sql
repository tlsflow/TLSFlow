-- ACME RenewalJob 只负责签发和保存证书版本，历史“待安装”任务在签发完成后直接收敛为完成。
update pg_certificate_renewal_jobs
set status = 'completed',
    promotion_status = 'not_required',
    next_attempt_at = null,
    lease_owner = null,
    lease_expires_at = null,
    failure_code = null,
    failure_message = null,
    updated_at = now()
where policy_id is not null
  and certificate_version_id is not null
  and status in ('deploying', 'verifying', 'issued_waiting_for_installation');
