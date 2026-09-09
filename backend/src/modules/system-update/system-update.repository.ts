import { AppError } from '../../common/errors/app-error.js';
import type { DatabasePort } from '../../database/database-port.js';
import type { SystemUpdateSettings, UpdateChannel } from './system-update.types.js';

interface SettingsRow extends Record<string, unknown> {
  id: string;
  channel: UpdateChannel;
  version: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemUpdateSettingsRepository {
  get(): Promise<SystemUpdateSettings>;
  update(channel: UpdateChannel, version: number, updatedBy: string): Promise<SystemUpdateSettings>;
}

export class PgSystemUpdateSettingsRepository implements SystemUpdateSettingsRepository {
  constructor(private readonly db: DatabasePort) {}

  async get(): Promise<SystemUpdateSettings> {
    const result = await this.db.query<SettingsRow>(
      `select id, channel, version, updated_by, created_at, updated_at
         from system_update_settings
        where id = 'singleton'`,
    );
    const row = result.rows[0];
    if (!row) {
      await this.db.query(
        `insert into system_update_settings (id, channel, version)
         values ('singleton', 'stable', 1)
         on conflict (id) do nothing`,
      );
      return this.get();
    }
    return toSettings(row);
  }

  async update(channel: UpdateChannel, version: number, updatedBy: string): Promise<SystemUpdateSettings> {
    const result = await this.db.query<SettingsRow>(
      `update system_update_settings
          set channel = $1, version = version + 1, updated_by = $2, updated_at = now()
        where id = 'singleton' and version = $3
      returning id, channel, version, updated_by, created_at, updated_at`,
      [channel, updatedBy, version],
    );
    if (!result.rows[0]) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', '版本更新通道已被其他请求修改，请刷新后重试');
    }
    return toSettings(result.rows[0]);
  }
}

function toSettings(row: SettingsRow): SystemUpdateSettings {
  return {
    id: 'singleton',
    channel: row.channel,
    version: Number(row.version),
    ...(row.updated_by ? { updatedBy: row.updated_by } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
