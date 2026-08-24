import { createHash } from 'node:crypto';
import type { DatabasePort } from '../../../database/database-port.js';
import type { HttpChallengeResponder } from './acme-challenge-adapter.js';

interface Http01PresentationRow extends Record<string, unknown> {
  token_sha256: string;
  tenant_id: string;
  identifier: string;
  key_authorization: string;
  presentation_id: string;
  expires_at: string | Date;
}

/**
 * 使用 PostgreSQL 保存 HTTP-01 短期验证材料。
 *
 * 该实现不保存 token 原文。公开读取路径拿到 token 后计算摘要，
 * 因此多实例和后端重启都能读取同一份验证材料。
 */
export class PostgresHttp01Responder implements HttpChallengeResponder {
  constructor(private readonly db: DatabasePort, private readonly ttlSeconds = 600) {}

  async present(input: {
    tenantId: string;
    identifier: string;
    token: string;
    keyAuthorization: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(60, this.ttlSeconds) * 1000);
    const tokenSha256 = hashToken(input.token);
    await this.db.query(
      `insert into pg_acme_http01_presentations (
         token_sha256, tenant_id, identifier, key_authorization, presentation_id, expires_at, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$7)
       on conflict (token_sha256) do update set
         tenant_id = excluded.tenant_id,
         identifier = excluded.identifier,
         key_authorization = excluded.key_authorization,
         presentation_id = excluded.presentation_id,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at`,
      [tokenSha256, input.tenantId, input.identifier, input.keyAuthorization, input.presentationId, expiresAt, now],
    );
    await this.removeExpired(now);
    return {
      method: 'http-01',
      path: `/.well-known/acme-challenge/${input.token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async cleanup(input: {
    tenantId: string;
    identifier: string;
    token: string;
    presentationId: string;
    actorId: string;
  }): Promise<Record<string, unknown>> {
    await this.db.query(
      `delete from pg_acme_http01_presentations
       where token_sha256 = $1
         and tenant_id = $2
         and identifier = $3
         and presentation_id = $4`,
      [hashToken(input.token), input.tenantId, input.identifier, input.presentationId],
    );
    await this.removeExpired(new Date());
    return { method: 'http-01', cleaned: true };
  }

  async read(token: string): Promise<string | undefined> {
    const result = await this.db.query<Http01PresentationRow>(
      `select token_sha256, tenant_id, identifier, key_authorization, presentation_id, expires_at
         from pg_acme_http01_presentations
        where token_sha256 = $1
          and expires_at > now()
        limit 1`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    return row?.key_authorization;
  }

  private async removeExpired(now: Date): Promise<void> {
    await this.db.query(
      'delete from pg_acme_http01_presentations where expires_at <= $1',
      [now],
    );
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
