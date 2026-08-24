import { AppError } from '../../../common/errors/app-error.js';
import {
  CREDENTIAL_KINDS,
  type CredentialDelivery,
  type CredentialKind,
  type CredentialProfileEntity,
  type CredentialStatus,
} from '../../../persistence/entities/credential-profile.entity.js';
import { SECRET_SCOPE_TYPES, type SecretScopeType, type SecretType } from '../../../shared/security-types.js';
import { parseSecretRef } from '../../secrets/secret-ref.js';
import type { CreateCredentialProfileDto, UpdateCredentialProfileDto } from '../dto/credentials.dto.js';

export interface CredentialSlotRule {
  required: boolean;
  allowedTypes: readonly SecretType[];
}

const SLOT_RULES: Record<CredentialKind, Record<string, CredentialSlotRule>> = {
  USERNAME_PASSWORD: {
    password: { required: true, allowedTypes: ['password'] },
  },
  SSH_KEY: {
    privateKey: { required: true, allowedTypes: ['ssh_key'] },
    passphrase: { required: false, allowedTypes: ['password'] },
  },
  BEARER_TOKEN: {
    token: { required: true, allowedTypes: ['api_token'] },
  },
  API_KEY: {
    token: { required: true, allowedTypes: ['api_token'] },
  },
  CLIENT_CERTIFICATE: {
    certificate: { required: true, allowedTypes: ['certificate_private_key'] },
    privateKey: { required: true, allowedTypes: ['private_key', 'certificate_private_key'] },
    passphrase: { required: false, allowedTypes: ['password'] },
  },
  DNS_PROVIDER: {
    config: { required: true, allowedTypes: ['password'] },
  },
  CLOUD_PROVIDER: {},
  BROWSER_SESSION: {},
};

export function getCredentialSlotRules(kind: CredentialKind, metadata?: Record<string, unknown>): Record<string, CredentialSlotRule> {
  if (!CREDENTIAL_KINDS.includes(kind)) throw validation('凭据类型无效', { kind });
  if (kind === 'CLOUD_PROVIDER') return cloudProviderSlotRules(metadata);
  if (kind === 'BROWSER_SESSION') {
    const outputContract = metadata?.outputContract;
    const parameters = outputContract && typeof outputContract === 'object' && !Array.isArray(outputContract)
      ? (outputContract as Record<string, unknown>).parameters
      : undefined;
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
      throw validation('BROWSER_SESSION 缺少输出合同');
    }
    return Object.fromEntries(Object.entries(parameters).map(([name, value]) => {
      const parameter = value as Record<string, unknown>;
      const secretType = parameter.secretType;
      if (!['password', 'api_token', 'session_id', 'ssh_key', 'private_key', 'certificate_private_key'].includes(String(secretType))) {
        throw validation('BROWSER_SESSION 输出合同 Secret 类型无效', { slot: name, secretType });
      }
      return [name, { required: parameter.required !== false, allowedTypes: [secretType as SecretType] }];
    }));
  }
  return SLOT_RULES[kind];
}

const CREDENTIAL_STATUSES = new Set<CredentialStatus>(['active', 'disabled', 'error']);

export class CredentialsDomainService {
  normalizeCreate(
    tenantId: string,
    createdBy: string,
    input: CreateCredentialProfileDto,
    identity: { id: string; now: string },
  ): CredentialProfileEntity {
    const normalized = normalizeFields(input, input.metadata);
    return {
      id: identity.id,
      tenantId: requiredText(tenantId, 'tenantId'),
      name: normalized.name,
      kind: normalized.kind,
      scopeType: normalized.scopeType,
      scopeId: normalized.scopeId,
      username: normalized.username,
      delivery: normalized.delivery,
      secretSlots: normalized.secretSlots,
      metadata: cloneRecord(input.metadata),
      status: 'active',
      version: 1,
      createdBy: requiredText(createdBy, 'createdBy'),
      createdAt: identity.now,
      updatedAt: identity.now,
    };
  }

  normalizeUpdate(
    current: CredentialProfileEntity,
    input: UpdateCredentialProfileDto,
    now: string,
  ): CredentialProfileEntity {
    if (current.version !== input.expectedVersion) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', 'CredentialProfile 版本冲突', {
        credentialId: current.id,
        expectedVersion: input.expectedVersion,
        actualVersion: current.version,
      });
    }
    const normalized = normalizeFields({
      name: input.name ?? current.name,
      kind: current.kind,
      scopeType: input.scopeType ?? current.scopeType,
      scopeId: input.scopeId ?? current.scopeId,
      username: input.username ?? current.username,
      delivery: input.delivery ?? current.delivery,
      secretSlots: input.secretSlots ?? current.secretSlots,
    }, input.metadata ?? current.metadata);
    const status = input.status ?? current.status;
    if (!CREDENTIAL_STATUSES.has(status)) throw validation('凭据状态无效', { status });
    return {
      ...current,
      ...normalized,
      metadata: input.metadata === undefined ? current.metadata : cloneRecord(input.metadata),
      status,
      version: current.version + 1,
      updatedAt: now,
    };
  }
}

function normalizeFields(input: CreateCredentialProfileDto, metadata?: Record<string, unknown>): Pick<
  CredentialProfileEntity,
  'name' | 'kind' | 'scopeType' | 'scopeId' | 'username' | 'delivery' | 'secretSlots'
> {
  const name = requiredText(input.name, 'name');
  if (!CREDENTIAL_KINDS.includes(input.kind)) throw validation('凭据类型无效', { kind: input.kind });
  if (!SECRET_SCOPE_TYPES.includes(input.scopeType)) throw validation('凭据作用域无效', { scopeType: input.scopeType });
  const scopeId = optionalText(input.scopeId);
  if (input.scopeType !== 'global' && !scopeId) throw validation('非全局凭据必须提供 scopeId', { scopeType: input.scopeType });
  if (input.scopeType === 'global' && scopeId) throw validation('全局凭据不能提供 scopeId');
  const username = optionalText(input.username);
  if (requiresUsername(input.kind) && !username) throw validation('该凭据类型必须提供用户名', { kind: input.kind });
  const delivery = normalizeDelivery(input.kind, input.delivery);
  const secretSlots = normalizeSecretSlots(input.kind, input.secretSlots, metadata);
  return { name, kind: input.kind, scopeType: input.scopeType, scopeId, username, delivery, secretSlots };
}

function normalizeSecretSlots(kind: CredentialKind, input: Record<string, string>, metadata?: Record<string, unknown>): Record<string, string> {
  const rules = getCredentialSlotRules(kind, metadata);
  const output: Record<string, string> = {};
  for (const key of Object.keys(input)) {
    if (!rules[key]) throw validation('凭据包含未声明的 Secret Slot', { kind, slot: key });
  }
  for (const [slot, rule] of Object.entries(rules)) {
    const secretRef = optionalText(input[slot]);
    if (!secretRef) {
      if (rule.required) throw validation('凭据缺少必填 Secret Slot', { kind, slot });
      continue;
    }
    let parsed;
    try {
      parsed = parseSecretRef(secretRef);
    } catch {
      throw validation('凭据 Secret Slot 必须使用合法 SecretRef', { kind, slot });
    }
    if (!rule.allowedTypes.includes(parsed.type)) {
      throw validation('凭据 Secret Slot 类型不匹配', {
        kind,
        slot,
        expectedTypes: rule.allowedTypes,
        actualType: parsed.type,
      });
    }
    output[slot] = secretRef;
  }
  return output;
}

function normalizeDelivery(kind: CredentialKind, input: CredentialDelivery | undefined): CredentialDelivery | undefined {
  if (kind === 'BROWSER_SESSION') {
    if (input?.location || input?.name) throw validation('BROWSER_SESSION 的投递位置必须按输出合同逐槽位声明');
    return undefined;
  }
  if (kind !== 'API_KEY') {
    if (input?.location || input?.name) throw validation('只有 API_KEY 凭据允许配置投递位置', { kind });
    return undefined;
  }
  const location = input?.location;
  if (location !== 'header' && location !== 'query' && location !== 'cookie') {
    throw validation('API_KEY 必须提供合法投递位置');
  }
  return { location, name: requiredText(input?.name, 'delivery.name') };
}

function requiresUsername(kind: CredentialKind): boolean {
  return kind === 'USERNAME_PASSWORD' || kind === 'SSH_KEY';
}

function cloudProviderSlotRules(metadata?: Record<string, unknown>): Record<string, CredentialSlotRule> {
  const providerKey = optionalText(metadata?.providerKey);
  if (!providerKey) throw validation('CLOUD_PROVIDER 凭据必须指定 providerKey');
  const slotNames = CLOUD_PROVIDER_SLOTS[providerKey];
  if (!slotNames) throw validation('CLOUD_PROVIDER 凭据的 providerKey 不受支持', { providerKey });
  return Object.fromEntries(slotNames.map((slot) => [
    slot,
    { required: true, allowedTypes: ['api_token'] as const },
  ]));
}

const CLOUD_PROVIDER_SLOTS: Record<string, readonly [string, string]> = {
  'cloud.aliyun': ['accessKeyId', 'accessKeySecret'],
  'cloud.tencent': ['secretId', 'secretKey'],
  'cloud.huawei': ['accessKey', 'secretKey'],
  'cloud.volcengine': ['accessKeyId', 'secretAccessKey'],
};

function requiredText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (!normalized) throw validation(`${field} 不能为空`, { field });
  return normalized;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cloneRecord(value: Record<string, unknown> | undefined): Record<string, unknown> {
  return value ? structuredClone(value) : {};
}

function validation(message: string, details?: Record<string, unknown>): AppError {
  return new AppError('VALIDATION_FAILED', message, details);
}
