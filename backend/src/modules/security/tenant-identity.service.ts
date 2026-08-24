import { AppError } from '../../common/errors/app-error.js';
import type { DatabasePort } from '../../database/database-port.js';

export const DEFAULT_TENANT_CODE = 'default';

export interface TenantIdentityResolver {
  resolve(identifier: string): Promise<string>;
  resolveDefault(): Promise<string>;
}

interface TenantIdentityRow extends Record<string, unknown> {
  id: string;
  code: string;
  status: 'ACTIVE' | 'SUSPENDED';
}

/**
 * 统一解析租户逻辑编码和数据库 UUID。
 *
 * 业务层可以继续接收历史上的 `default` 逻辑值，但进入核心数据查询前
 * 必须通过 tenants.code 解析成唯一 UUID。解析失败时直接拒绝，不能退化
 * 为 tenant_default、UUID 零值或任意请求头。
 */
export class TenantIdentityService implements TenantIdentityResolver {
  constructor(private readonly db: DatabasePort) {}

  async resolveDefault(): Promise<string> {
    return this.resolve(DEFAULT_TENANT_CODE);
  }

  async resolve(identifier: string): Promise<string> {
    const normalized = identifier.trim();
    if (!normalized) {
      throw new AppError('AUTH_FORBIDDEN', '租户上下文无效');
    }

    const row = isUuid(normalized)
      ? await this.findById(normalized)
      : await this.findByCode(normalized);

    if (!row) {
      throw new AppError('AUTH_FORBIDDEN', '租户上下文无效', { tenantIdentifier: normalized });
    }
    if (row.status !== 'ACTIVE') {
      throw new AppError('AUTH_FORBIDDEN', '租户已停用', { tenantId: row.id });
    }
    return row.id;
  }

  private async findById(id: string): Promise<TenantIdentityRow | undefined> {
    const result = await this.db.query<TenantIdentityRow>(
      `select id::text as id, code, status
         from tenants
        where id = $1::uuid
          and deleted_at is null`,
      [id],
    );
    return result.rows[0];
  }

  private async findByCode(code: string): Promise<TenantIdentityRow | undefined> {
    const result = await this.db.query<TenantIdentityRow>(
      `select id::text as id, code, status
         from tenants
        where code = $1
          and deleted_at is null`,
      [code],
    );
    return result.rows[0];
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
