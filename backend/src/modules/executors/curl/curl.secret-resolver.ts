import type { SecretService } from '../../secrets/secret.service.js';

export interface CurlSecretResolverContext {
  runId?: string;
  stepId?: string;
  actorId?: string;
  tenantId?: string;
}

export interface CurlSecretResolver {
  resolveSecret(secretRef: string, purpose: string, context?: CurlSecretResolverContext): Promise<string>;
}

export class SecretServiceCurlResolver implements CurlSecretResolver {
  constructor(private readonly secrets: SecretService) {}

  async resolveSecret(secretRef: string, purpose: string, context: CurlSecretResolverContext = {}): Promise<string> {
    const resolved = await this.secrets.resolveForService({
      secretRef,
      purpose,
      actorId: context.actorId ?? 'curl-executor',
      context: {},
    });
    return resolved.plainText;
  }
}

export class StaticCurlSecretResolver implements CurlSecretResolver {
  constructor(private readonly secrets: Record<string, string>) {}

  async resolveSecret(secretRef: string): Promise<string> {
    const value = this.secrets[secretRef];
    if (value === undefined) throw new Error(`SecretRef 未配置：${secretRef}`);
    return value;
  }
}
