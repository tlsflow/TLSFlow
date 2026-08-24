import { AppError } from '../../../common/errors/app-error.js';
import { createHash } from 'node:crypto';
import type { CredentialKind } from '../../../persistence/entities/credential-profile.entity.js';
import { buildSecretRef, parseSecretRef } from '../../secrets/secret-ref.js';
import type { RuntimeCredentialV1 } from '../../deployment-inputs/dto/resolved-deployment-input.dto.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { CredentialsRepository } from '../repository/credentials.repository.js';

export interface CredentialPlanSnapshotV1 extends RuntimeCredentialV1 {
  credentialVersionId: string;
  kind: CredentialKind;
  secretRefs: Record<string, string>;
  snapshotSha256: string;
}

export class RuntimeCredentialResolver {
  constructor(
    private readonly repository: CredentialsRepository,
    private readonly secrets?: SecretService,
  ) {}

  async resolveBindings(
    tenantId: string,
    bindings: Record<string, { credentialId: string }>,
  ): Promise<Record<string, RuntimeCredentialV1>> {
    return Object.fromEntries(await Promise.all(Object.entries(bindings).map(async ([slot, binding]) => [
      slot,
      await this.resolve(tenantId, binding.credentialId),
    ])));
  }

  async resolve(tenantId: string, credentialId: string): Promise<RuntimeCredentialV1> {
    const profile = await this.repository.get(tenantId, credentialId);
    if (!profile) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId });
    if (profile.status !== 'active') {
      throw new AppError('VALIDATION_FAILED', 'CredentialProfile 当前不可用于执行', {
        credentialId,
        status: profile.status,
      });
    }
    assertBrowserSessionUsable(profile);
    return {
      credentialId: profile.id,
      kind: profile.kind,
      username: profile.username,
      delivery: profile.delivery,
      secretRefs: structuredClone(profile.secretSlots),
      metadata: browserSessionRuntimeMetadata(profile.metadata),
    };
  }

  async resolveBindingsForPlan(
    tenantId: string,
    bindings: Record<string, { credentialId: string }>,
  ): Promise<Record<string, CredentialPlanSnapshotV1>> {
    if (!this.secrets) throw new AppError('CAPABILITY_MISSING', '部署计划凭据快照缺少 Secret 服务');
    return Object.fromEntries(await Promise.all(Object.entries(bindings).map(async ([slot, binding]) => {
      const profile = await this.repository.get(tenantId, binding.credentialId);
      if (!profile) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 不存在', { credentialId: binding.credentialId });
      if (profile.status !== 'active') throw new AppError('VALIDATION_FAILED', 'CredentialProfile 当前不可用于部署计划', { credentialId: profile.id, status: profile.status });
      assertBrowserSessionUsable(profile);
      const secretRefs = Object.fromEntries(await Promise.all(Object.entries(profile.secretSlots).map(async ([name, secretRef]) => {
        const parsed = parseSecretRef(secretRef);
        if (parsed.version !== 'current') return [name, secretRef];
        const metadata = await this.secrets!.getMetadata(parsed.secretId, tenantId);
        const version = (await this.secrets!.listSecretVersions(parsed.secretId, tenantId)).find((item) => item.id === metadata.currentVersionId);
        if (!version) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 当前 Secret 版本不存在', { credentialId: profile.id, slot: name });
        return [name, buildSecretRef(parsed.type, parsed.secretId, version.versionNo)];
      })));
      const snapshot = {
        credentialId: profile.id,
        credentialVersionId: String(profile.version),
        kind: profile.kind,
        username: profile.username,
        delivery: profile.delivery,
        secretRefs,
        metadata: browserSessionRuntimeMetadata(profile.metadata),
      };
      return [slot, {
        ...snapshot,
        snapshotSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
      }];
    })));
  }
}

function assertBrowserSessionUsable(profile: Awaited<ReturnType<CredentialsRepository['get']>>): void {
  if (!profile || profile.kind !== 'BROWSER_SESSION') return;
  const expiresAt = typeof profile.metadata.expiresAt === 'string' ? profile.metadata.expiresAt : undefined;
  if (!expiresAt) throw new AppError('CREDENTIAL_EXPIRED', 'BROWSER_SESSION 缺少过期时间', { credentialId: profile.id });
  if (Date.parse(expiresAt) <= Date.now()) {
    throw new AppError('CREDENTIAL_EXPIRED', 'BROWSER_SESSION 已过期', { credentialId: profile.id, expiresAt });
  }
  const outputContract = profile.metadata.outputContract;
  const parameters = outputContract && typeof outputContract === 'object' && !Array.isArray(outputContract)
    ? (outputContract as Record<string, unknown>).parameters
    : undefined;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new AppError('CREDENTIAL_OUTPUT_INVALID', 'BROWSER_SESSION 缺少输出合同', { credentialId: profile.id });
  }
  const missing = Object.entries(parameters)
    .filter(([name, value]) => (value as Record<string, unknown>).required !== false && !profile.secretSlots[name])
    .map(([name]) => name);
  if (missing.length > 0) throw new AppError('CREDENTIAL_OUTPUT_INVALID', 'BROWSER_SESSION 缺少必填参数', { credentialId: profile.id, missing });
}

function browserSessionRuntimeMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  if (metadata.lifecycle !== 'temporary') return undefined;
  return {
    lifecycle: metadata.lifecycle,
    expiresAt: metadata.expiresAt,
    outputContract: metadata.outputContract,
  };
}
