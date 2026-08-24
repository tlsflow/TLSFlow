import { AppError } from '../../../common/errors/app-error.js';
import { createHash } from 'node:crypto';
import type { CredentialDelivery, CredentialKind } from '../../../persistence/entities/credential-profile.entity.js';
import { buildSecretRef, parseSecretRef } from '../../secrets/secret-ref.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { CredentialsRepository } from '../repository/credentials.repository.js';
export interface RuntimeCredentialV1 {
  credentialId: string;
  kind: CredentialKind;
  username?: string;
  delivery?: CredentialDelivery;
  secretRefs: Record<string, string>;
  [key: string]: unknown;
}

export interface CredentialPlanSnapshotV1 extends RuntimeCredentialV1 {
  profileVersion: number;
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
    return {
      credentialId: profile.id,
      kind: profile.kind,
      username: profile.username,
      delivery: profile.delivery,
      secretRefs: structuredClone(profile.secretSlots),
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
      const secretRefs = Object.fromEntries(await Promise.all(Object.entries(profile.secretSlots).map(async ([name, secretRef]) => {
        const parsed = parseSecretRef(secretRef);
        if (parsed.version !== 'current') return [name, secretRef];
        const metadata = await this.secrets!.getMetadata(parsed.secretId);
        const version = (await this.secrets!.listSecretVersions(parsed.secretId)).find((item) => item.id === metadata.currentVersionId);
        if (!version) throw new AppError('RESOURCE_NOT_FOUND', 'CredentialProfile 当前 Secret 版本不存在', { credentialId: profile.id, slot: name });
        return [name, buildSecretRef(parsed.type, parsed.secretId, version.versionNo)];
      })));
      const snapshot = {
        credentialId: profile.id,
        kind: profile.kind,
        username: profile.username,
        delivery: profile.delivery,
        secretRefs,
        profileVersion: profile.version,
      };
      return [slot, {
        ...snapshot,
        snapshotSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
      }];
    })));
  }
}
