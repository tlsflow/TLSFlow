import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type {
  AcmeAccountEntity,
  AcmeAuthorizationEntity,
  AcmeChallengeEntity,
  AcmeOrderEntity,
  AcmeRenewalJobEntity,
  AcmeRenewalPolicyEntity,
} from '../schema/acme.schema.js';

export class AcmeRepository {
  constructor(private readonly db: DatabasePort) {}

  async saveAccount(entity: AcmeAccountEntity): Promise<AcmeAccountEntity> {
    await this.db.query(
      `insert into pg_acme_accounts (
         id, tenant_id, provider_id, directory_url_hash, account_url, account_key_secret_ref, contact,
         eab_key_id_secret_ref, eab_hmac_secret_ref, status, last_error_code, last_error_message,
         payload, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb,$14,$15)
       on conflict (id) do update set
         account_url = excluded.account_url,
         account_key_secret_ref = excluded.account_key_secret_ref,
         contact = excluded.contact,
         eab_key_id_secret_ref = excluded.eab_key_id_secret_ref,
         eab_hmac_secret_ref = excluded.eab_hmac_secret_ref,
         status = excluded.status,
         last_error_code = excluded.last_error_code,
         last_error_message = excluded.last_error_message,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      [
        entity.id, entity.tenantId, entity.providerId, entity.directoryUrlHash, entity.accountUrl ?? null,
        entity.accountKeySecretRef, JSON.stringify(entity.contact), entity.eabKeyIdSecretRef ?? null,
        entity.eabHmacSecretRef ?? null, entity.status, entity.lastErrorCode ?? null,
        entity.lastErrorMessage ?? null, JSON.stringify(entity), entity.createdAt, entity.updatedAt,
      ],
    );
    return structuredClone(entity);
  }

  async getAccount(tenantId: string, id: string): Promise<AcmeAccountEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_accounts where tenant_id = $1 and id = $2',
      [tenantId, id],
    );
    return result.rows[0] ? accountFromRow(result.rows[0]) : undefined;
  }

  async getAccountByKey(tenantId: string, providerId: string, directoryUrlHash: string, accountKeySecretRef: string): Promise<AcmeAccountEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_acme_accounts
       where tenant_id = $1 and provider_id = $2 and directory_url_hash = $3 and account_key_secret_ref = $4
       limit 1`,
      [tenantId, providerId, directoryUrlHash, accountKeySecretRef],
    );
    return result.rows[0] ? accountFromRow(result.rows[0]) : undefined;
  }

  async listAccounts(tenantId: string, providerId?: string): Promise<AcmeAccountEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_acme_accounts
       where tenant_id = $1 ${providerId ? 'and provider_id = $2' : ''}
       order by created_at desc`,
      providerId ? [tenantId, providerId] : [tenantId],
    );
    return result.rows.map(accountFromRow);
  }

  async saveOrder(entity: AcmeOrderEntity): Promise<AcmeOrderEntity> {
    await this.db.query(
      `insert into pg_acme_orders (
         id, tenant_id, provider_id, account_id, certificate_request_id, external_order_url, status,
         identifiers, authorization_urls, finalize_url, certificate_url, csr_sha256, retry_after_at,
         attempt_count, failure_code, failure_summary, payload, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19)
       on conflict (id) do update set
         external_order_url = excluded.external_order_url,
         status = excluded.status,
         identifiers = excluded.identifiers,
         authorization_urls = excluded.authorization_urls,
         finalize_url = excluded.finalize_url,
         certificate_url = excluded.certificate_url,
         csr_sha256 = excluded.csr_sha256,
         retry_after_at = excluded.retry_after_at,
         attempt_count = excluded.attempt_count,
         failure_code = excluded.failure_code,
         failure_summary = excluded.failure_summary,
         payload = excluded.payload,
         updated_at = excluded.updated_at`,
      [
        entity.id, entity.tenantId, entity.providerId, entity.accountId, entity.certificateRequestId,
        entity.externalOrderUrl, entity.status, JSON.stringify(entity.identifiers), JSON.stringify(entity.authorizationUrls),
        entity.finalizeUrl ?? null, entity.certificateUrl ?? null, entity.csrSha256 ?? null,
        entity.retryAfterAt ?? null, entity.attemptCount, entity.failureCode ?? null,
        entity.failureSummary ?? null, JSON.stringify(entity), entity.createdAt, entity.updatedAt,
      ],
    );
    return structuredClone(entity);
  }

  async getOrder(tenantId: string, id: string): Promise<AcmeOrderEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_orders where tenant_id = $1 and id = $2',
      [tenantId, id],
    );
    return result.rows[0] ? orderFromRow(result.rows[0]) : undefined;
  }

  async getOrderByRequest(tenantId: string, certificateRequestId: string, activeOnly = false): Promise<AcmeOrderEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_acme_orders
       where tenant_id = $1 and certificate_request_id = $2
         ${activeOnly ? "and status in ('pending','ready','processing')" : ''}
       order by created_at desc limit 1`,
      [tenantId, certificateRequestId],
    );
    return result.rows[0] ? orderFromRow(result.rows[0]) : undefined;
  }

  async listOrders(tenantId: string, status?: AcmeOrderEntity['status']): Promise<AcmeOrderEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_acme_orders
       where tenant_id = $1 ${status ? 'and status = $2' : ''}
       order by created_at desc`,
      status ? [tenantId, status] : [tenantId],
    );
    return result.rows.map(orderFromRow);
  }

  async saveAuthorization(entity: AcmeAuthorizationEntity): Promise<AcmeAuthorizationEntity> {
    await this.db.query(
      `insert into pg_acme_authorizations (
         id, tenant_id, order_id, external_authorization_url, identifier, status, expires_at, wildcard,
         payload, created_at, updated_at
       ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10,$11)
       on conflict (id) do update set
         status = excluded.status, expires_at = excluded.expires_at, wildcard = excluded.wildcard,
         identifier = excluded.identifier, payload = excluded.payload, updated_at = excluded.updated_at`,
      [
        entity.id, entity.tenantId, entity.orderId, entity.externalAuthorizationUrl,
        JSON.stringify(entity.identifier), entity.status, entity.expiresAt ?? null, entity.wildcard,
        JSON.stringify(entity), entity.createdAt, entity.updatedAt,
      ],
    );
    return structuredClone(entity);
  }

  async listAuthorizations(tenantId: string, orderId: string): Promise<AcmeAuthorizationEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_authorizations where tenant_id = $1 and order_id = $2 order by created_at asc',
      [tenantId, orderId],
    );
    return result.rows.map(authorizationFromRow);
  }

  async getAuthorizationByUrl(tenantId: string, externalAuthorizationUrl: string): Promise<AcmeAuthorizationEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_authorizations where tenant_id = $1 and external_authorization_url = $2',
      [tenantId, externalAuthorizationUrl],
    );
    return result.rows[0] ? authorizationFromRow(result.rows[0]) : undefined;
  }

  async saveChallenge(entity: AcmeChallengeEntity): Promise<AcmeChallengeEntity> {
    await this.db.query(
      `insert into pg_acme_challenges (
         id, tenant_id, order_id, authorization_id, external_challenge_url, type, identifier,
         token_sha256, key_authorization_sha256, presentation_id, status, lease_owner, lease_expires_at,
         attempt_count, retry_after_at, failure_code, failure_summary, cleanup_error, payload, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21)
       on conflict (id) do update set
         presentation_id = excluded.presentation_id, status = excluded.status, lease_owner = excluded.lease_owner,
         lease_expires_at = excluded.lease_expires_at, attempt_count = excluded.attempt_count,
         retry_after_at = excluded.retry_after_at, failure_code = excluded.failure_code,
         failure_summary = excluded.failure_summary, cleanup_error = excluded.cleanup_error,
         payload = excluded.payload, updated_at = excluded.updated_at`,
      [
        entity.id, entity.tenantId, entity.orderId, entity.authorizationId, entity.externalChallengeUrl,
        entity.type, entity.identifier, entity.tokenSha256, entity.keyAuthorizationSha256,
        entity.presentationId ?? null, entity.status, entity.leaseOwner ?? null, entity.leaseExpiresAt ?? null,
        entity.attemptCount, entity.retryAfterAt ?? null, entity.failureCode ?? null,
        entity.failureSummary ?? null, entity.cleanupError ?? null, JSON.stringify(entity),
        entity.createdAt, entity.updatedAt,
      ],
    );
    return structuredClone(entity);
  }

  async listChallenges(tenantId: string, orderId: string): Promise<AcmeChallengeEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_challenges where tenant_id = $1 and order_id = $2 order by created_at asc',
      [tenantId, orderId],
    );
    return result.rows.map(challengeFromRow);
  }

  async getChallengeByUrl(tenantId: string, externalChallengeUrl: string): Promise<AcmeChallengeEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_challenges where tenant_id = $1 and external_challenge_url = $2',
      [tenantId, externalChallengeUrl],
    );
    return result.rows[0] ? challengeFromRow(result.rows[0]) : undefined;
  }

  async getChallenge(tenantId: string, id: string): Promise<AcmeChallengeEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_challenges where tenant_id = $1 and id = $2',
      [tenantId, id],
    );
    return result.rows[0] ? challengeFromRow(result.rows[0]) : undefined;
  }

  async claimChallenge(tenantId: string, challengeId: string, leaseOwner: string, leaseExpiresAt: string, now: string): Promise<AcmeChallengeEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `update pg_acme_challenges
       set lease_owner = $3, lease_expires_at = $4::timestamptz, updated_at = $5::timestamptz
       where tenant_id = $1 and id = $2
         and (lease_expires_at is null or lease_expires_at <= $5::timestamptz or lease_owner = $3)
         and status in ('pending','presented','processing','valid','cleanup_pending','failed')
       returning *`,
      [tenantId, challengeId, leaseOwner, leaseExpiresAt, now],
    );
    return result.rows[0] ? challengeFromRow(result.rows[0]) : undefined;
  }

  async savePolicy(entity: AcmeRenewalPolicyEntity): Promise<AcmeRenewalPolicyEntity> {
    await this.db.query(
      `insert into pg_acme_renewal_policies (
         id, tenant_id, certificate_asset_id, binding_id, provider_id, account_id, enabled,
         renewal_window_days, challenge_type, rotate_key_on_renewal, deployment_mode, max_attempts,
         backoff_seconds, maintenance_window, status, version, created_by, payload, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18::jsonb,$19,$20)
       on conflict (id) do update set
         certificate_asset_id = excluded.certificate_asset_id, binding_id = excluded.binding_id,
         provider_id = excluded.provider_id, account_id = excluded.account_id, enabled = excluded.enabled,
         renewal_window_days = excluded.renewal_window_days, challenge_type = excluded.challenge_type,
         rotate_key_on_renewal = excluded.rotate_key_on_renewal, deployment_mode = excluded.deployment_mode,
         max_attempts = excluded.max_attempts, backoff_seconds = excluded.backoff_seconds,
         maintenance_window = excluded.maintenance_window, status = excluded.status, version = excluded.version,
         payload = excluded.payload, updated_at = excluded.updated_at`,
      [
        entity.id, entity.tenantId, entity.certificateAssetId ?? null, entity.bindingId ?? null,
        entity.providerId, entity.accountId, entity.enabled, entity.renewalWindowDays, entity.challengeType,
        entity.rotateKeyOnRenewal, entity.deploymentMode, entity.maxAttempts, entity.backoffSeconds,
        entity.maintenanceWindow ? JSON.stringify(entity.maintenanceWindow) : null, entity.status, entity.version,
        entity.createdBy, JSON.stringify(entity), entity.createdAt, entity.updatedAt,
      ],
    );
    return structuredClone(entity);
  }

  async getPolicy(tenantId: string, id: string): Promise<AcmeRenewalPolicyEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_renewal_policies where tenant_id = $1 and id = $2',
      [tenantId, id],
    );
    return result.rows[0] ? policyFromRow(result.rows[0]) : undefined;
  }

  async listPolicies(tenantId: string): Promise<AcmeRenewalPolicyEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_acme_renewal_policies where tenant_id = $1 order by created_at desc',
      [tenantId],
    );
    return result.rows.map(policyFromRow);
  }

  async listActivePolicies(limit = 100): Promise<AcmeRenewalPolicyEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_acme_renewal_policies
       where enabled = true and status = 'active'
       order by updated_at asc
       limit $1`,
      [Math.max(1, Math.floor(limit))],
    );
    return result.rows.map(policyFromRow);
  }

  async saveRenewalJob(entity: AcmeRenewalJobEntity): Promise<AcmeRenewalJobEntity> {
    await this.db.query(
      `insert into pg_certificate_renewal_jobs (
         id, tenant_id, certificate_version_id, renewal_window_key, status, certificate_request_id,
         policy_id, source_certificate_version_id, acme_order_id, deployment_plan_id, execution_run_id,
         promotion_status, attempt_count, next_attempt_at, lease_owner, lease_expires_at, failure_code,
         failure_message, policy_snapshot, payload, scheduled_at, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,$23)
       on conflict (id) do update set
         certificate_version_id = excluded.certificate_version_id,
         status = excluded.status, certificate_request_id = excluded.certificate_request_id,
         policy_id = excluded.policy_id, source_certificate_version_id = excluded.source_certificate_version_id,
         acme_order_id = excluded.acme_order_id, deployment_plan_id = excluded.deployment_plan_id,
         execution_run_id = excluded.execution_run_id, promotion_status = excluded.promotion_status,
         attempt_count = excluded.attempt_count, next_attempt_at = excluded.next_attempt_at,
         lease_owner = excluded.lease_owner, lease_expires_at = excluded.lease_expires_at,
         failure_code = excluded.failure_code, failure_message = excluded.failure_message,
         policy_snapshot = excluded.policy_snapshot, payload = excluded.payload,
         scheduled_at = excluded.scheduled_at, updated_at = excluded.updated_at`,
      [
        entity.id, entity.tenantId, entity.certificateVersionId ?? null, entity.renewalWindowKey, entity.status,
        entity.certificateRequestId ?? null, entity.policyId ?? null, entity.sourceCertificateVersionId ?? null,
        entity.acmeOrderId ?? null, entity.deploymentPlanId ?? null, entity.executionRunId ?? null,
        entity.promotionStatus, entity.attemptCount, entity.nextAttemptAt ?? null, entity.leaseOwner ?? null,
        entity.leaseExpiresAt ?? null, entity.failureCode ?? null, entity.failureMessage ?? null,
        entity.policySnapshot ? JSON.stringify(entity.policySnapshot) : null, JSON.stringify(entity),
        entity.scheduledAt, entity.createdAt, entity.updatedAt,
      ],
    );
    return structuredClone(entity);
  }

  async getRenewalJob(tenantId: string, id: string): Promise<AcmeRenewalJobEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_certificate_renewal_jobs where tenant_id = $1 and id = $2',
      [tenantId, id],
    );
    return result.rows[0] ? renewalJobFromRow(result.rows[0]) : undefined;
  }

  async getRenewalJobByWindow(tenantId: string, sourceCertificateVersionId: string | undefined, renewalWindowKey: string): Promise<AcmeRenewalJobEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_certificate_renewal_jobs
       where tenant_id = $1
         and source_certificate_version_id is not distinct from $2
         and renewal_window_key = $3
       order by created_at desc limit 1`,
      [tenantId, sourceCertificateVersionId ?? null, renewalWindowKey],
    );
    return result.rows[0] ? renewalJobFromRow(result.rows[0]) : undefined;
  }

  async getActiveRenewalJobBySourceVersion(tenantId: string, sourceCertificateVersionId: string): Promise<AcmeRenewalJobEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_certificate_renewal_jobs
       where tenant_id = $1
         and source_certificate_version_id = $2
         and status not in ('completed','failed','rollback_required','cancelled')
       order by scheduled_at desc, created_at desc
       limit 1`,
      [tenantId, sourceCertificateVersionId],
    );
    return result.rows[0] ? renewalJobFromRow(result.rows[0]) : undefined;
  }

  async listRenewalJobs(tenantId: string): Promise<AcmeRenewalJobEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      'select * from pg_certificate_renewal_jobs where tenant_id = $1 order by scheduled_at desc',
      [tenantId],
    );
    return result.rows.map(renewalJobFromRow);
  }

  async retryRenewalJob(tenantId: string, id: string, now: string): Promise<AcmeRenewalJobEntity> {
    const result = await this.db.query<Record<string, unknown>>(
      `update pg_certificate_renewal_jobs
       set status = 'scheduled',
           promotion_status = 'not_required',
           attempt_count = 0,
           next_attempt_at = $3::timestamptz,
           lease_owner = null,
           lease_expires_at = null,
           failure_code = null,
           failure_message = null,
           updated_at = $3::timestamptz
       where tenant_id = $1 and id = $2
         and status in ('failed', 'retry_waiting', 'rollback_required')
       returning *`,
      [tenantId, id, now],
    );
    if (!result.rows[0]) throw new AppError('RESOURCE_NOT_FOUND', 'ACME 续签任务不存在或当前状态不可重试', { renewalJobId: id });
    return renewalJobFromRow(result.rows[0]);
  }

  async claimRenewalJob(tenantId: string, id: string, leaseOwner: string, leaseExpiresAt: string, now: string): Promise<AcmeRenewalJobEntity | undefined> {
    const result = await this.db.query<Record<string, unknown>>(
      `update pg_certificate_renewal_jobs
       set lease_owner = $3, lease_expires_at = $4::timestamptz, updated_at = $5::timestamptz
       where tenant_id = $1 and id = $2
         and status not in ('completed','failed','rollback_required','cancelled','issued_waiting_for_installation')
         and (next_attempt_at is null or next_attempt_at <= $5::timestamptz)
         and (lease_expires_at is null or lease_expires_at <= $5::timestamptz or lease_owner = $3)
       returning *`,
      [tenantId, id, leaseOwner, leaseExpiresAt, now],
    );
    return result.rows[0] ? renewalJobFromRow(result.rows[0]) : undefined;
  }

  async listDueRenewalJobs(now: string, limit: number): Promise<AcmeRenewalJobEntity[]> {
    const result = await this.db.query<Record<string, unknown>>(
      `select * from pg_certificate_renewal_jobs
       where status not in ('completed','failed','rollback_required','cancelled','issued_waiting_for_installation')
         and (next_attempt_at is null or next_attempt_at <= $1::timestamptz)
         and (lease_expires_at is null or lease_expires_at <= $1::timestamptz)
       order by scheduled_at asc, id asc limit $2`,
      [now, Math.max(1, Math.floor(limit))],
    );
    return result.rows.map(renewalJobFromRow);
  }
}

function accountFromRow(row: Record<string, unknown>): AcmeAccountEntity {
  const payload = object(row.payload);
  return {
    ...(payload as Partial<AcmeAccountEntity>),
    id: String(row.id),
    tenantId: String(row.tenant_id),
    providerId: String(row.provider_id),
    directoryUrlHash: String(row.directory_url_hash),
    accountUrl: optionalString(row.account_url),
    accountKeySecretRef: String(row.account_key_secret_ref),
    contact: strings(row.contact),
    eabKeyIdSecretRef: optionalString(row.eab_key_id_secret_ref),
    eabHmacSecretRef: optionalString(row.eab_hmac_secret_ref),
    status: row.status as AcmeAccountEntity['status'],
    lastErrorCode: optionalString(row.last_error_code),
    lastErrorMessage: optionalString(row.last_error_message),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function orderFromRow(row: Record<string, unknown>): AcmeOrderEntity {
  const payload = object(row.payload);
  return {
    ...(payload as Partial<AcmeOrderEntity>),
    id: String(row.id),
    tenantId: String(row.tenant_id),
    providerId: String(row.provider_id),
    accountId: String(row.account_id),
    certificateRequestId: String(row.certificate_request_id),
    externalOrderUrl: String(row.external_order_url),
    status: row.status as AcmeOrderEntity['status'],
    identifiers: identifiers(row.identifiers),
    authorizationUrls: strings(row.authorization_urls),
    finalizeUrl: optionalString(row.finalize_url),
    certificateUrl: optionalString(row.certificate_url),
    csrSha256: optionalString(row.csr_sha256),
    retryAfterAt: optionalIso(row.retry_after_at),
    attemptCount: Number(row.attempt_count ?? 0),
    failureCode: optionalString(row.failure_code),
    failureSummary: optionalString(row.failure_summary),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function authorizationFromRow(row: Record<string, unknown>): AcmeAuthorizationEntity {
  const payload = object(row.payload);
  return {
    ...(payload as Partial<AcmeAuthorizationEntity>),
    id: String(row.id),
    tenantId: String(row.tenant_id),
    orderId: String(row.order_id),
    externalAuthorizationUrl: String(row.external_authorization_url),
    identifier: object(row.identifier) as AcmeAuthorizationEntity['identifier'],
    status: row.status as AcmeAuthorizationEntity['status'],
    expiresAt: optionalIso(row.expires_at),
    wildcard: Boolean(row.wildcard),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function challengeFromRow(row: Record<string, unknown>): AcmeChallengeEntity {
  const payload = object(row.payload);
  return {
    ...(payload as Partial<AcmeChallengeEntity>),
    id: String(row.id),
    tenantId: String(row.tenant_id),
    orderId: String(row.order_id),
    authorizationId: String(row.authorization_id),
    externalChallengeUrl: String(row.external_challenge_url),
    type: row.type as AcmeChallengeEntity['type'],
    identifier: String(row.identifier),
    tokenSha256: String(row.token_sha256),
    keyAuthorizationSha256: String(row.key_authorization_sha256),
    presentationId: optionalString(row.presentation_id),
    status: row.status as AcmeChallengeEntity['status'],
    leaseOwner: optionalString(row.lease_owner),
    leaseExpiresAt: optionalIso(row.lease_expires_at),
    attemptCount: Number(row.attempt_count ?? 0),
    retryAfterAt: optionalIso(row.retry_after_at),
    failureCode: optionalString(row.failure_code),
    failureSummary: optionalString(row.failure_summary),
    cleanupError: optionalString(row.cleanup_error),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function policyFromRow(row: Record<string, unknown>): AcmeRenewalPolicyEntity {
  const payload = object(row.payload);
  return {
    ...(payload as Partial<AcmeRenewalPolicyEntity>),
    id: String(row.id),
    tenantId: String(row.tenant_id),
    certificateAssetId: optionalString(row.certificate_asset_id),
    bindingId: optionalString(row.binding_id),
    providerId: String(row.provider_id),
    accountId: String(row.account_id),
    enabled: Boolean(row.enabled),
    renewalWindowDays: Number(row.renewal_window_days),
    challengeType: row.challenge_type as AcmeRenewalPolicyEntity['challengeType'],
    rotateKeyOnRenewal: Boolean(row.rotate_key_on_renewal),
    deploymentMode: row.deployment_mode as AcmeRenewalPolicyEntity['deploymentMode'],
    maxAttempts: Number(row.max_attempts),
    backoffSeconds: Number(row.backoff_seconds),
    maintenanceWindow: row.maintenance_window ? object(row.maintenance_window) : undefined,
    status: row.status as AcmeRenewalPolicyEntity['status'],
    version: Number(row.version),
    createdBy: String(row.created_by),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function renewalJobFromRow(row: Record<string, unknown>): AcmeRenewalJobEntity {
  const payload = object(row.payload);
  return {
    ...(payload as Partial<AcmeRenewalJobEntity>),
    id: String(row.id),
    tenantId: String(row.tenant_id),
    certificateVersionId: optionalString(row.certificate_version_id),
    sourceCertificateVersionId: optionalString(row.source_certificate_version_id ?? row.certificate_version_id),
    renewalWindowKey: String(row.renewal_window_key),
    status: row.status as AcmeRenewalJobEntity['status'],
    certificateRequestId: optionalString(row.certificate_request_id),
    policyId: optionalString(row.policy_id),
    acmeOrderId: optionalString(row.acme_order_id),
    deploymentPlanId: optionalString(row.deployment_plan_id),
    executionRunId: optionalString(row.execution_run_id),
    promotionStatus: (row.promotion_status ?? 'pending') as AcmeRenewalJobEntity['promotionStatus'],
    attemptCount: Number(row.attempt_count ?? 0),
    nextAttemptAt: optionalIso(row.next_attempt_at),
    leaseOwner: optionalString(row.lease_owner),
    leaseExpiresAt: optionalIso(row.lease_expires_at),
    failureCode: optionalString(row.failure_code),
    failureMessage: optionalString(row.failure_message),
    policySnapshot: row.policy_snapshot ? object(row.policy_snapshot) : undefined,
    scheduledAt: iso(row.scheduled_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function identifiers(value: unknown): Array<{ type: 'dns' | 'ip'; value: string }> {
  return Array.isArray(value)
    ? value.map((item) => {
      const record = object(item);
      return {
        type: record.type === 'ip' ? 'ip' : 'dns',
        value: String(record.value ?? ''),
      };
    })
    : [];
}

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

function optionalIso(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : iso(value);
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
