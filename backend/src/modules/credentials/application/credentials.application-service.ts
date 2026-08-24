import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { AuditLogEntity } from '../../../persistence/entities/audit-log.entity.js';
import type { CredentialProfileEntity } from '../../../persistence/entities/credential-profile.entity.js';
import { PgDocumentRepository } from '../../../persistence/repositories/pg-document-repository.js';
import { newId } from '../../../shared/id.js';
import type { RequestContext, SecretType } from '../../../shared/security-types.js';
import { AuditService } from '../../audits/audit.service.js';
import { parseSecretRef } from '../../secrets/secret-ref.js';
import type { SecretService } from '../../secrets/secret.service.js';
import type { CreateCredentialProfileRequestDto, CredentialSecretValueInput, RotateCredentialProfileRequestDto, UpdateCredentialProfileRequestDto } from '../dto/credentials.dto.js';
import { CredentialsDomainService, getCredentialSlotRules } from '../domain/credentials.domain-service.js';
import { CredentialsRepository } from '../repository/credentials.repository.js';

export class CredentialsApplicationService {
  constructor(
    private readonly repository = new CredentialsRepository(),
    private readonly domain = new CredentialsDomainService(),
    private readonly db: DatabasePort = new PgliteDatabase(),
    private readonly secrets?: SecretService,
  ) {}

  async list(tenantId: string, filters: { kind?: string; scopeType?: string; status?: string; search?: string } = {}) {
    const search = filters.search?.trim().toLowerCase();
    return (await this.repository.list(tenantId)).filter((item) => {
      if (filters.kind && item.kind !== filters.kind) return false;
      if (filters.scopeType && item.scopeType !== filters.scopeType) return false;
      if (filters.status && item.status !== filters.status) return false;
      if (search && !`${item.name} ${item.username ?? ''}`.toLowerCase().includes(search)) return false;
      return true;
    }).map(({ secretSlots: _secretSlots, createdBy: _createdBy, ...summary }) => summary);
  }

  async get(tenantId: string, credentialId: string) {
    const item = await this.repository.get(tenantId, credentialId);
    if (!item) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
    return item;
  }

  async create(tenantId: string, createdBy: string, input: CreateCredentialProfileRequestDto, context: RequestContext = {}) {
    const secrets = this.requireSecrets();
    try {
      return await this.db.transaction(async (tx) => {
      const secretSlots = await this.createSecretSlots(tx, secrets, tenantId, createdBy, input, context);
      const entity = this.domain.normalizeCreate(tenantId, createdBy, { ...input, secretSlots }, {
        id: newId('cred'),
        now: new Date().toISOString(),
      });
      const saved = await new CredentialsRepository(tx).save(entity);
      await credentialAudit(tx).write({
        eventType: 'credential.created', actorType: 'user', actorId: createdBy,
        action: 'credential.create', resourceType: 'credential', resourceId: saved.id,
        result: 'success', riskLevel: 'high', context, failClosed: true,
        detail: { name: saved.name, kind: saved.kind, scopeType: saved.scopeType, scopeId: saved.scopeId, slots: Object.keys(saved.secretSlots) },
      });
      return saved;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('RESOURCE_ALREADY_EXISTS', '同名 CredentialProfile 已存在', { name: input.name });
      throw error;
    }
  }

  async rotate(tenantId: string, credentialId: string, actorId: string, input: RotateCredentialProfileRequestDto, context: RequestContext = {}) {
    const secrets = this.requireSecrets();
    return this.db.transaction(async (tx) => {
      const repository = new CredentialsRepository(tx);
      const current = await repository.get(tenantId, credentialId);
      if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
      if (current.version !== input.expectedVersion) throw new AppError('RESOURCE_VERSION_CONFLICT', 'CredentialProfile 版本冲突', { credentialId, expectedVersion: input.expectedVersion, actualVersion: current.version });
      const secretSlots = await this.updateSecretSlots(tx, secrets, current, actorId, input.secretValues, context);
      const updated = await repository.save(this.domain.normalizeUpdate(current, { secretSlots, expectedVersion: input.expectedVersion }, new Date().toISOString()));
      await credentialAudit(tx).write({
        eventType: 'credential.rotated', actorType: 'user', actorId,
        action: 'credential.rotate', resourceType: 'credential', resourceId: credentialId,
        result: 'success', riskLevel: 'high', context, failClosed: true,
        detail: { slots: Object.keys(input.secretValues), version: updated.version },
      });
      return updated;
    });
  }

  async update(tenantId: string, credentialId: string, actorId: string, input: UpdateCredentialProfileRequestDto, context: RequestContext = {}) {
    try {
      return await this.db.transaction(async (tx) => {
        const repository = new CredentialsRepository(tx);
        const current = await repository.get(tenantId, credentialId);
        if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
        const secretValues = input.secretValues ?? {};
        const secretChanged = Object.keys(secretValues).length > 0;
        const secretSlots = secretChanged
          ? await this.updateSecretSlots(
            tx,
            this.requireSecrets(),
            current,
            actorId,
            secretValues,
            context,
            input.metadata ?? current.metadata,
          )
          : current.secretSlots;
        const recoveredStatus = current.status === 'error' && input.status === undefined ? 'disabled' : input.status;
        const updated = await repository.save(this.domain.normalizeUpdate(current, {
          ...input,
          secretSlots,
          status: recoveredStatus,
        }, new Date().toISOString()));
        const statusChanged = current.status !== updated.status;
        await credentialAudit(tx).write({
          eventType: statusChanged ? 'credential.status_changed' : 'credential.updated',
          actorType: 'user', actorId,
          action: statusChanged ? 'credential.disable' : 'credential.update',
          resourceType: 'credential', resourceId: credentialId,
          result: 'success', riskLevel: statusChanged || secretChanged ? 'high' : 'medium', context, failClosed: true,
          detail: { version: updated.version, status: updated.status, slots: Object.keys(secretValues) },
        });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new AppError('RESOURCE_ALREADY_EXISTS', '同名 CredentialProfile 已存在', { name: input.name });
      throw error;
    }
  }

  async delete(tenantId: string, credentialId: string, actorId: string, context: RequestContext = {}) {
    const usage = await this.repository.listUsage(tenantId, credentialId);
    if (usage.length > 0) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', 'CredentialProfile 正在被使用，不能删除', {
        credentialId,
        usage,
      });
    }
    const secrets = this.requireSecrets();
    return this.db.transaction(async (tx) => {
      const repository = new CredentialsRepository(tx);
      const current = await repository.get(tenantId, credentialId);
      if (!current) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
      if (!await repository.delete(tenantId, credentialId)) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
      for (const secretRef of Object.values(current.secretSlots)) {
        if (await repository.countOtherProfilesUsingSecretRef(tenantId, credentialId, secretRef) > 0) continue;
        await secrets.deleteInTransaction(parseSecretRef(secretRef).secretId, actorId, tx, context);
      }
      await credentialAudit(tx).write({
        eventType: 'credential.deleted', actorType: 'user', actorId,
        action: 'credential.delete', resourceType: 'credential', resourceId: credentialId,
        result: 'success', riskLevel: 'high', context, failClosed: true,
        detail: { name: current.name, kind: current.kind, slots: Object.keys(current.secretSlots) },
      });
      return { id: credentialId, deleted: true as const };
    });
  }

  async usage(tenantId: string, credentialId: string) {
    await this.get(tenantId, credentialId);
    const items = await this.repository.listUsage(tenantId, credentialId);
    return { credentialId, items, total: items.length };
  }

  private requireSecrets(): SecretService {
    if (!this.secrets) throw new AppError('CAPABILITY_MISSING', 'Credential Secret 服务未注册');
    return this.secrets;
  }

  private async updateSecretSlots(
    tx: DatabasePort,
    secrets: SecretService,
    current: CredentialProfileEntity,
    actorId: string,
    secretValues: Record<string, CredentialSecretValueInput>,
    context: RequestContext,
    metadata: Record<string, unknown> | undefined = current.metadata,
  ): Promise<Record<string, string>> {
    const rules = getCredentialSlotRules(current.kind, metadata);
    const secretSlots = { ...current.secretSlots };
    for (const [slot, secretValue] of Object.entries(secretValues)) {
      const rule = rules[slot];
      if (!rule) throw new AppError('VALIDATION_FAILED', '凭据包含未声明的 Secret Slot', { kind: current.kind, slot });
      const selectedType = selectSecretType(secretValue, rule.allowedTypes, slot);
      const existingRef = current.secretSlots[slot];
      if (existingRef) {
        const parsed = parseSecretRef(existingRef);
        if (parsed.type !== selectedType) throw new AppError('VALIDATION_FAILED', '轮换不能改变 Secret Slot 类型', { slot, expectedType: parsed.type, actualType: selectedType });
        await secrets.rotateInTransaction(parsed.secretId, requirePlainText(secretValue, slot), actorId, tx, context);
        continue;
      }
      const created = await secrets.createInTransaction({
        tenantId: current.tenantId,
        name: `${current.name}:${slot}`, type: selectedType, scopeType: current.scopeType, scopeId: current.scopeId,
        metadata: { credentialId: current.id, credentialKind: current.kind, credentialSlot: slot }, plainText: requirePlainText(secretValue, slot), createdBy: actorId,
      }, tx, context);
      secretSlots[slot] = created.secretRef;
    }
    return secretSlots;
  }

  private async createSecretSlots(
    tx: DatabasePort,
    secrets: SecretService,
    tenantId: string,
    createdBy: string,
    input: CreateCredentialProfileRequestDto,
    context: RequestContext,
  ): Promise<Record<string, string>> {
    const rules = getCredentialSlotRules(input.kind, input.metadata);
    const secretSlots: Record<string, string> = {};
    for (const slot of Object.keys(input.secretValues)) if (!rules[slot]) throw new AppError('VALIDATION_FAILED', '凭据包含未声明的 Secret Slot', { kind: input.kind, slot });
    for (const [slot, rule] of Object.entries(rules)) {
      const secretValue = input.secretValues[slot];
      if (!secretValue) {
        if (rule.required) throw new AppError('VALIDATION_FAILED', '凭据缺少必填 Secret Slot', { kind: input.kind, slot });
        continue;
      }
      const type = selectSecretType(secretValue, rule.allowedTypes, slot);
      const created = await secrets.createInTransaction({
        tenantId,
        name: `${input.name}:${slot}`, type, scopeType: input.scopeType, scopeId: input.scopeId,
        metadata: { tenantId, credentialKind: input.kind, credentialSlot: slot }, plainText: requirePlainText(secretValue, slot), createdBy,
      }, tx, context);
      secretSlots[slot] = created.secretRef;
    }
    return secretSlots;
  }
}

function selectSecretType(input: CredentialSecretValueInput, allowedTypes: readonly SecretType[], slot: string): SecretType {
  const selected = input.type ?? allowedTypes[0];
  if (!selected || !allowedTypes.includes(selected)) throw new AppError('VALIDATION_FAILED', 'Secret Slot 类型不匹配', { slot, expectedTypes: allowedTypes, actualType: selected });
  return selected;
}

function requirePlainText(input: CredentialSecretValueInput, slot: string): string {
  if (typeof input.plainText !== 'string' || !input.plainText) throw new AppError('VALIDATION_FAILED', 'Secret Slot 明文不能为空', { slot });
  return input.plainText;
}

function credentialAudit(db: DatabasePort): AuditService {
  return new AuditService(new PgDocumentRepository<AuditLogEntity>(db, 'security.audit_logs'));
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown };
  return value.code === '23505' || (typeof value.message === 'string' && value.message.includes('unique constraint'));
}
