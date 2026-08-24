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
import type { AuditService } from '../audits/audit.service.js';
import { AUDIT_EVENT_TYPES } from '../audits/audit-event-types.js';

export interface CreateSecretInput {
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
  purpose: string;
  actorId: string;
  context?: RequestContext;
}

export interface ResolveSecretForServiceInput {
  secretRef: string;
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
    if (input.scopeType !== 'global' && !input.scopeId) {
      throw securityErrors.secretRefInvalid({ reason: 'scopeId required for non-global secret' });
    }

    const now = new Date().toISOString();
    const secretId = newId('sec');
    const encrypted = this.crypto.encryptSecret(input.plainText);
    const versionId = newId('secv');

    await this.versions.create({
      id: versionId,
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

    const secret = await this.secrets.create({
      id: secretId,
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

    await this.audit.write({
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
        fingerprint: encrypted.fingerprint,
      },
    });

    await this.audit.write({
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
      detail: { secretId: secret.id, versionNo: 1, fingerprint: encrypted.fingerprint },
    });

    return this.toMetadata(secret);
  }

  async listMetadata(): Promise<SecretMetadataOutput[]> {
    const rows = await this.secrets.list();
    const output: SecretMetadataOutput[] = [];
    for (const row of rows) {
      if (row.status === 'deleted') continue;
      output.push(await this.toMetadata(row));
    }
    return output;
  }

  async getMetadata(secretId: string): Promise<SecretMetadataOutput> {
    const secret = await this.secrets.get(secretId);
    if (!secret || secret.status === 'deleted') {
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
      runId: input.runId,
      stepId: input.stepId,
      executorType: input.executorType,
      secretRef: input.secretRef,
      action: input.purpose,
      markUsed: true,
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
    if (!secret || secret.status !== 'active') {
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

    return {
      secretRef: buildSecretRef(secret.type, secret.id, version.versionNo),
      versionId: version.id,
      plainText,
      fingerprint: version.fingerprint,
    };
  }

  async listSecretVersions(secretId: string): Promise<SecretVersionEntity[]> {
    return (await this.versions.list((version) => version.secretId === secretId)).map(({ dekIv: _dekIv, dekAuthTag: _dekAuthTag, ...safe }) => safe);
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
      if (!current) {
        throw securityErrors.secretNotFound({ reason: 'current version missing' });
      }
      return current;
    }

    const versionNo = Number(version.slice(1));
    const matched = (await this.versions.list((row) => row.secretId === secret.id && row.versionNo === versionNo))[0];
    if (!matched) {
      throw securityErrors.secretNotFound({ reason: 'version missing', version });
    }
    return matched;
  }

  private async toMetadata(secret: SecretEntity): Promise<SecretMetadataOutput> {
    const version = await this.versions.get(secret.currentVersionId);
    if (!version) {
      throw securityErrors.secretNotFound({ reason: 'version missing' });
    }
    return {
      id: secret.id,
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
}

function cloneMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value || Array.isArray(value)) return {};
  return structuredClone(value);
}
