import type { SecretService } from '../../secrets/secret.service.js';
import type { CookieSessionStore } from './cookie-session.js';

export interface CurlSecretResolverContext {
  runId?: string;
  stepId?: string;
  actorId?: string;
  tenantId?: string;
  planId?: string;
  targetId?: string;
  workflowVersionId?: string;
  cookieSessionRef?: string;
  cookieSessionStore?: CookieSessionStore;
  executionGrantId?: string;
  allowInsecureTls?: boolean;
  executionGrantService?: {
    validate(input: {
      grantId: string;
      tenantId?: string;
      planId?: string;
      runId: string;
      stepId: string;
      targetId?: string;
      workflowVersionId?: string;
      artifactRef?: string;
      executorType: string;
      action?: string;
    }): Promise<unknown>;
  };
}

export interface CurlSecretResolver {
  resolveSecret(secretRef: string, purpose: string, context?: CurlSecretResolverContext): Promise<string>;
}

export class SecretServiceCurlResolver implements CurlSecretResolver {
  constructor(private readonly secrets: SecretService) {}

  async resolveSecret(secretRef: string, purpose: string, context: CurlSecretResolverContext = {}): Promise<string> {
    const resolved = await this.secrets.resolveForService({
      secretRef,
      tenantId: context.tenantId,
      purpose,
      actorId: context.actorId ?? 'curl-executor',
      context,
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
