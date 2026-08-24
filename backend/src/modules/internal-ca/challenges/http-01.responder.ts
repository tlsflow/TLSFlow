import type { HttpChallengeResponder } from './acme-challenge-adapter.js';

interface Http01Presentation {
  tenantId: string;
  identifier: string;
  keyAuthorization: string;
  presentationId: string;
  expiresAt: number;
}

/**
 * 保存 ACME HTTP-01 短期响应材料。
 *
 * token 本身是 ACME Challenge 的公开索引，响应内容只保留在进程内，
 * 不进入业务数据库，也不写入日志。多实例部署应在此处替换为共享短期存储。
 */
export class InMemoryHttp01Responder implements HttpChallengeResponder {
  private readonly presentations = new Map<string, Http01Presentation>();
  private readonly ttlMs: number;

  constructor(ttlSeconds = 600) {
    this.ttlMs = Math.max(60, ttlSeconds) * 1000;
  }

  async present(input: {
    tenantId: string;
    identifier: string;
    token: string;
    keyAuthorization: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>> {
    this.removeExpired();
    const expiresAt = Date.now() + this.ttlMs;
    this.presentations.set(input.token, {
      tenantId: input.tenantId,
      identifier: input.identifier,
      keyAuthorization: input.keyAuthorization,
      presentationId: input.presentationId,
      expiresAt,
    });
    return {
      method: 'http-01',
      path: `/.well-known/acme-challenge/${input.token}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async cleanup(input: {
    tenantId: string;
    identifier: string;
    token: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>> {
    this.removeExpired();
    const current = this.presentations.get(input.token);
    if (current
      && current.tenantId === input.tenantId
      && current.identifier === input.identifier
      && current.presentationId === input.presentationId) {
      this.presentations.delete(input.token);
    }
    return { method: 'http-01', cleaned: true };
  }

  read(token: string): string | undefined {
    this.removeExpired();
    return this.presentations.get(token)?.keyAuthorization;
  }

  private removeExpired(): void {
    const now = Date.now();
    for (const [token, presentation] of this.presentations) {
      if (presentation.expiresAt <= now) this.presentations.delete(token);
    }
  }
}
