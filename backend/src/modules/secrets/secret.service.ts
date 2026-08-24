import { PgliteDatabase } from '../../database/pglite-database.js';
import type { AsyncRepositoryPort } from '../../persistence/repositories/async-repository-port.js';
import { PgDocumentRepository } from '../../persistence/repositories/pg-document-repository.js';
import type { SecretEntity, SecretVersionEntity } from '../../persistence/entities/secret.entity.js';
import type { RequestContext, SecretScopeType, SecretType } from '../../shared/security-types.js';
import { newId } from '../../shared/id.js';
import { securityErrors } from '../../shared/security-error.js';
import { CryptoService, type EnvelopeEncryptedPayload } from './crypto.service.js';
import { buildSecretRef, parseSecretRef } from './secret-ref.js';
import type { ExecutionGrantService } from '../executions/execution-grant.service.js';
import { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';
import type { DatabasePort } from '../../database/database-port.js';

export interface CreateSecretInput {
  tenantId?: string;
  name: string;
  type: SecretType;
  scopeType: SecretScopeType;
  scopeId?: string;
  metadata?: Record<string, unknown>;
  plainText: string;
  createdBy: string;
}

export interface SecretMetadataOutput {
  id: string;
  tenantId?: string;
  name: string;
  type: SecretType;
  scopeType: SecretScopeType;
  scopeId?: string;
  metadata: Record<string, unknown>;
  status: string;
  currentVersionId: string;
  secretRef: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretMetadataDiagnosticOutput extends SecretMetadataOutput {}

export interface ResolveSecretInput {
  secretRef: string;
  grantId: string;
  runId: string;
  stepId: string;
  executorType: string;
  workflowVersionId?: string;
  pluginVersionId?: string;
  pluginId?: string;
  capability?: string;
  planDigest?: string;
  purpose: string;
  actorId: string;
  context?: RequestContext;
  /** Plugin Runner 同一执行内可能需要多次签名，不能把执行级 Grant 首次解析后立即消费。 */
  markUsed?: boolean;
}

export interface ResolveSecretForServiceInput {
  secretRef: string;
  tenantId?: string;
  expectedType?: SecretType;
  purpose: string;
  actorId: string;
  context?: RequestContext;
}

export interface ResolvedSecret {
  secretRef: string;
  versionId: string;
  plainText: string;
  fingerprint: string;
}

export class SecretService {
  private static readonly defaultDb = new PgliteDatabase();

  private static createDefaultSecretsRepository(): AsyncRepositoryPort<SecretEntity> {
    return new PgDocumentRepository<SecretEntity>(SecretService.defaultDb, 'security.secrets');
  }

  private static createDefaultVersionsRepository(): AsyncRepositoryPort<SecretVersionEntity & { dekIv: string; dekAuthTag: string }> {
    return new PgDocumentRepository<SecretVersionEntity & { dekIv: string; dekAuthTag: string }>(
      SecretService.defaultDb,
      'security.secret_versions',
    );
  }

  constructor(
    private readonly crypto: CryptoService,
    private readonly grants: ExecutionGrantService,
    private readonly audit: AuditService,
    private readonly secrets: AsyncRepositoryPort<SecretEntity> = SecretService.createDefaultSecretsRepository(),
    private readonly versions: AsyncRepositoryPort<SecretVersionEntity & { dekIv: string; dekAuthTag: string }> = SecretService.createDefaultVersionsRepository(),
  ) {}

  async create(input: CreateSecretInput, context: RequestContext = {}): Promise<SecretMetadataOutput> {
    const result = await this.persistCreate(input, context, this.secrets, this.versions);
    await this.auditCreated(input, result.secret, result.versionId, result.fingerprint, context);
    return this.toMetadata(result.secret);
  }

  async createInTransaction(input: CreateSecretInput, db: DatabasePort, context: RequestContext = {}): Promise<SecretMetadataOutput> {
    const repositories = this.repositoriesFor(db);
    const result = await this.persistCreate(input, context, repositories.secrets, repositories.versions);
    await this.auditCreatedWith(new AuditService(new PgDocumentRepository(db, 'security.audit_logs')), input, result.secret, result.versionId, result.fingerprint, context);
    return this.toMetadataFrom(result.secret, repositories.versions);
  }

  async rotateInTransaction(secretId: string, plainText: string, actorId: string, db: DatabasePort, context: RequestContext = {}): Promise<SecretMetadataOutput> {
    const repositories = this.repositoriesFor(db);
    const secret = await repositories.secrets.get(secretId);
    if (!secret || secret.status === 'deleted') throw securityErrors.secretNotFound({ secretId });
    const versions = await repositories.versions.list((version) => version.secretId === secretId);
    const versionNo = Math.max(0, ...versions.map((version) => version.versionNo)) + 1;
    const encrypted = this.crypto.encryptSecret(plainText);
    const versionId = newId('secv');
    await repositories.versions.create({
      id: versionId, tenantId: secret.tenantId, secretId, versionNo,
      encryptedData: encrypted.encryptedData, encryptedDek: encrypted.encryptedDek,
      kekVersion: encrypted.kekVersion, algorithm: encrypted.algorithm, iv: encrypted.iv,
      authTag: encrypted.authTag, dekIv: encrypted.dekIv, dekAuthTag: encrypted.dekAuthTag,
      fingerprint: encrypted.fingerprint, status: 'active', createdAt: new Date().toISOString(),
    });
    const updated = await repositories.secrets.update(secretId, {
      currentVersionId: versionId,
      updatedAt: new Date().toISOString(),
    });
    await new AuditService(new PgDocumentRepository(db, 'security.audit_logs')).write({
      eventType: AUDIT_EVENT_TYPES.SECRET_ROTATED,
      actorType: 'user', actorId, action: 'secret.rotate', resourceType: 'secret', resourceId: secretId,
      result: 'success', riskLevel: 'high', context, failClosed: true,
      detail: { versionNo, versionId, fingerprint: encrypted.fingerprint },
    });
    return this.toMetadataFrom(updated, repositories.versions);
  }

  async deleteInTransaction(secretId: string, actorId: string, db: DatabasePort, context: RequestContext = {}): Promise<void> {
    const repositories = this.repositoriesFor(db);
    const secret = await repositories.secrets.get(secretId);
    if (!secret || secret.status === 'deleted') return;
    for (const version of await repositories.versions.list((item) => item.secretId === secretId)) {
      await repositories.versions.update(version.id, { status: 'revoked' });
    }
    await repositories.secrets.update(secretId, { status: 'deleted', updatedAt: new Date().toISOString() });
    await new AuditService(new PgDocumentRepository(db, 'security.audit_logs')).write({
      eventType: AUDIT_EVENT_TYPES.SECRET_DELETED,
      actorType: 'user', actorId, action: 'secret.delete', resourceType: 'secret', resourceId: secretId,
      result: 'success', riskLevel: 'high', context, failClosed: true,
      detail: { type: secret.type, scopeType: secret.scopeType, scopeId: secret.scopeId },
    });
  }

  private async persistCreate(
    input: CreateSecretInput,
    context: RequestContext,
    secrets: AsyncRepositoryPort<SecretEntity>,
    versions: AsyncRepositoryPort<SecretVersionEntity & { dekIv: string; dekAuthTag: string }>,
  ) {
    if (input.scopeType !== 'global' && !input.scopeId) {
      throw securityErrors.secretRefInvalid({ reason: 'scopeId required for non-global secret' });
    }

    const now = new Date().toISOString();
    const secretId = newId('sec');
    const encrypted = this.crypto.encryptSecret(input.plainText);
    const versionId = newId('secv');

    await versions.create({
      id: versionId,
      tenantId: input.tenantId ?? resolveContextTenantId(context),
      secretId,
      versionNo: 1,
      encryptedData: encrypted.encryptedData,
      encryptedDek: encrypted.encryptedDek,
      kekVersion: encrypted.kekVersion,
      algorithm: encrypted.algorithm,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      dekIv: encrypted.dekIv,
      dekAuthTag: encrypted.dekAuthTag,
      fingerprint: encrypted.fingerprint,
      status: 'active',
      createdAt: now,
    });

    const secret = await secrets.create({
      id: secretId,
      tenantId: input.tenantId ?? resolveContextTenantId(context),
      name: input.name,
      type: input.type,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      metadata: cloneMetadata(input.metadata),
      status: 'active',
      currentVersionId: versionId,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    });

    return { secret, versionId, fingerprint: encrypted.fingerprint };
  }

  private async auditCreated(input: CreateSecretInput, secret: SecretEntity, versionId: string, fingerprint: string, context: RequestContext): Promise<void> {
    return this.auditCreatedWith(this.audit, input, secret, versionId, fingerprint, context);
  }

  private async auditCreatedWith(audit: AuditService, input: CreateSecretInput, secret: SecretEntity, versionId: string, fingerprint: string, context: RequestContext): Promise<void> {
    await audit.write({
      eventType: AUDIT_EVENT_TYPES.SECRET_CREATED,
      actorType: 'user',
      actorId: input.createdBy,
      action: 'secret.create',
      resourceType: 'secret',
      resourceId: secret.id,
      result: 'success',
      riskLevel: 'high',
      context,
      failClosed: true,
      detail: {
        name: input.name,
        type: input.type,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        metadataKeys: Object.keys(input.metadata ?? {}),
        fingerprint,
      },
    });

    await audit.write({
      eventType: AUDIT_EVENT_TYPES.SECRET_VERSION_CREATED,
      actorType: 'user',
      actorId: input.createdBy,
      action: 'secret.version.create',
      resourceType: 'secret_version',
      resourceId: versionId,
      result: 'success',
      riskLevel: 'high',
      context,
      failClosed: true,
      detail: { secretId: secret.id, versionNo: 1, fingerprint },
    });
  }

  async listMetadata(tenantId?: string): Promise<SecretMetadataOutput[]> {
    const rows = await this.secrets.list((row) => matchesTenant(row.tenantId, tenantId));
    const output: SecretMetadataOutput[] = [];
    for (const row of rows) {
      if (row.status === 'deleted') continue;
      output.push(await this.toMetadata(row));
    }
    return output;
  }

  async getMetadata(secretId: string, tenantId?: string): Promise<SecretMetadataOutput> {
    const secret = await this.secrets.get(secretId);
    if (!secret || secret.status === 'deleted' || !matchesTenant(secret.tenantId, tenantId)) {
      throw securityErrors.secretNotFound({ secretId });
    }
    return this.toMetadata(secret);
  }

  async resolveForExecution(input: ResolveSecretInput): Promise<ResolvedSecret> {
    const parsed = parseSecretRef(input.secretRef);
    const secret = await this.secrets.get(parsed.secretId);
    if (!secret || secret.status !== 'active') {
      throw securityErrors.secretNotFound({ secretId: parsed.secretId });
    }
    if (secret.type !== parsed.type) {
      throw securityErrors.secretRefInvalid({ reason: 'secret type mismatch' });
    }

    await this.grants.validate({
      grantId: input.grantId,
      tenantId: secret.tenantId,
      runId: input.runId,
      stepId: input.stepId,
      executorType: input.executorType,
      workflowVersionId: input.workflowVersionId,
      pluginVersionId: input.pluginVersionId,
      pluginId: input.pluginId,
      capability: input.capability,
      planDigest: input.planDigest,
      secretRef: input.secretRef,
      action: input.purpose,
      markUsed: input.markUsed ?? true,
    });

    const version = await this.resolveVersion(secret, parsed.version);
    if (version.status !== 'active') {
      throw securityErrors.secretResolveDenied({ reason: 'secret version is not active' });
    }

    const plainText = this.crypto.decryptSecret(version as EnvelopeEncryptedPayload);
    await this.audit.write({
      eventType: AUDIT_EVENT_TYPES.SECRET_USED,
      actorType: 'executor',
      actorId: input.executorType,
      action: 'secret.resolve',
      resourceType: 'secret',
      resourceId: secret.id,
      result: 'success',
      riskLevel: 'high',
      context: input.context,
      failClosed: true,
      detail: {
        actorId: input.actorId,
        secretRef: buildSecretRef(secret.type, secret.id, version.versionNo),
        runId: input.runId,
        stepId: input.stepId,
        purpose: input.purpose,
        fingerprint: version.fingerprint,
      },
    });

    return {
      secretRef: buildSecretRef(secret.type, secret.id, version.versionNo),
      versionId: version.id,
      plainText,
      fingerprint: version.fingerprint,
    };
  }

  async resolveForService(input: ResolveSecretForServiceInput): Promise<ResolvedSecret> {
    const parsed = parseSecretRef(input.secretRef);
    const secret = await this.secrets.get(parsed.secretId);
    const tenantId = resolveContextTenantId(input.context) ?? input.tenantId;
    if (!secret || secret.status !== 'active') {
      throw securityErrors.secretNotFound({ secretId: parsed.secretId });
    }
    if (secret.tenantId && !tenantId) {
      throw securityErrors.secretResolveDenied({ reason: 'tenant context required for tenant secret resolution' });
    }
    if (!isServiceSecretVisible(secret.tenantId, tenantId)) {
      throw securityErrors.secretNotFound({ secretId: parsed.secretId });
    }
    if (secret.type !== parsed.type) {
      throw securityErrors.secretRefInvalid({ reason: 'secret type mismatch' });
    }
    if (input.expectedType && secret.type !== input.expectedType) {
      throw securityErrors.secretRefInvalid({ reason: 'unexpected secret type', expectedType: input.expectedType, actualType: secret.type });
    }

    const version = await this.resolveVersion(secret, parsed.version);
    if (version.status !== 'active') {
      throw securityErrors.secretResolveDenied({ reason: 'secret version is not active' });
    }

    const plainText = this.crypto.decryptSecret(version as EnvelopeEncryptedPayload);
    if (input.purpose !== 'secret.health_check') {
      await this.audit.write({
        eventType: AUDIT_EVENT_TYPES.SECRET_USED,
        actorType: 'user',
        actorId: input.actorId,
        action: 'secret.resolve.service',
        resourceType: 'secret',
        resourceId: secret.id,
        result: 'success',
        riskLevel: 'high',
        context: input.context,
        failClosed: true,
        detail: {
          secretRef: buildSecretRef(secret.type, secret.id, version.versionNo),
          purpose: input.purpose,
          fingerprint: version.fingerprint,
        },
      });
    }

    return {
      secretRef: buildSecretRef(secret.type, secret.id, version.versionNo),
      versionId: version.id,
      plainText,
      fingerprint: version.fingerprint,
    };
  }

  async listSecretVersions(secretId: string, tenantId?: string): Promise<SecretVersionEntity[]> {
    return (await this.versions.list((version) => version.secretId === secretId && matchesTenant(version.tenantId, tenantId)))
      .map(({ dekIv: _dekIv, dekAuthTag: _dekAuthTag, ...safe }) => safe);
  }

  async listAllMetadataForDiagnostics(): Promise<SecretMetadataDiagnosticOutput[]> {
    const rows = await this.secrets.list();
    const output: SecretMetadataDiagnosticOutput[] = [];
    for (const row of rows) {
      if (row.status === 'deleted') continue;
      output.push(await this.toMetadata(row));
    }
    return output;
  }

  private async resolveVersion(secret: SecretEntity, version: string): Promise<SecretVersionEntity & { dekIv: string; dekAuthTag: string }> {
    if (version === 'current') {
      const current = await this.versions.get(secret.currentVersionId);
      if (!current || !matchesTenant(current.tenantId, secret.tenantId)) {
        throw securityErrors.secretNotFound({ reason: 'current version missing' });
      }
      return current;
    }

    const versionNo = Number(version.slice(1));
    const matched = (await this.versions.list((row) =>
      row.secretId === secret.id
      && row.versionNo === versionNo
      && matchesTenant(row.tenantId, secret.tenantId),
    ))[0];
    if (!matched) {
      throw securityErrors.secretNotFound({ reason: 'version missing', version });
    }
    return matched;
  }

  private async toMetadata(secret: SecretEntity): Promise<SecretMetadataOutput> {
    return this.toMetadataFrom(secret, this.versions);
  }

  private async toMetadataFrom(
    secret: SecretEntity,
    versions: AsyncRepositoryPort<SecretVersionEntity & { dekIv: string; dekAuthTag: string }>,
  ): Promise<SecretMetadataOutput> {
    const version = await versions.get(secret.currentVersionId);
    if (!version) {
      throw securityErrors.secretNotFound({ reason: 'version missing' });
    }
    return {
      id: secret.id,
      tenantId: secret.tenantId,
      name: secret.name,
      type: secret.type,
      scopeType: secret.scopeType,
      scopeId: secret.scopeId,
      metadata: cloneMetadata(secret.metadata),
      status: secret.status,
      currentVersionId: secret.currentVersionId,
      secretRef: buildSecretRef(secret.type, secret.id, 'current'),
      createdBy: secret.createdBy,
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
    };
  }

  private repositoriesFor(db: DatabasePort) {
    return {
      secrets: new PgDocumentRepository<SecretEntity>(db, 'security.secrets'),
      versions: new PgDocumentRepository<SecretVersionEntity & { dekIv: string; dekAuthTag: string }>(db, 'security.secret_versions'),
    };
  }
}

function cloneMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || Array.isArray(value)) return {};
  return structuredClone(value);
}

function resolveContextTenantId(context?: RequestContext): string | undefined {
  return context?.tenantId ?? context?.actor?.scope?.tenantId;
}

function matchesTenant(actualTenantId: string | undefined, expectedTenantId: string | undefined): boolean {
  if (!expectedTenantId) return true;
  return actualTenantId === expectedTenantId;
}

function isServiceSecretVisible(actualTenantId: string | undefined, expectedTenantId: string | undefined): boolean {
  if (!actualTenantId) return true;
  return matchesTenant(actualTenantId, expectedTenantId);
}
