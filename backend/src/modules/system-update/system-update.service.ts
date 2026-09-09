import { AppError } from '../../common/errors/app-error.js';
import { compareSemVer, GCAC_VERSION } from '../../common/version.js';
import type { AuditService } from '../audits/audit.service.js';
import type { RequestContext } from '../../shared/security-types.js';
import type { SystemUpdateSettingsRepository } from './system-update.repository.js';
import type { ReleaseManifestClient } from './system-update.manifest.js';
import type {
  SystemUpdateCheck,
  SystemUpdateSettings,
  UpdateChannel,
} from './system-update.types.js';

export class SystemUpdateService {
  constructor(
    private readonly repository: SystemUpdateSettingsRepository,
    private readonly manifestClient: ReleaseManifestClient,
    private readonly audit?: AuditService,
  ) {}

  getSettings(): Promise<SystemUpdateSettings> {
    return this.repository.get();
  }

  async updateChannel(input: { channel: UpdateChannel; version: number; actorId: string; context: RequestContext }): Promise<SystemUpdateSettings> {
    assertSettingsVersion(input.version);
    const before = await this.repository.get();
    const updated = await this.repository.update(input.channel, input.version, input.actorId);
    await this.audit?.write({
      eventType: 'system.update_channel.changed',
      actorType: 'user',
      actorId: input.actorId,
      action: 'settings.system.write',
      resourceType: 'system_update_settings',
      resourceId: 'singleton',
      result: 'success',
      riskLevel: 'low',
      context: input.context,
      detail: { before: before.channel, after: updated.channel },
    }).catch(() => undefined);
    return updated;
  }

  async check(channel?: UpdateChannel): Promise<SystemUpdateCheck> {
    const settings = await this.repository.get();
    const selectedChannel = channel ?? settings.channel;
    const manifest = await this.manifestClient.getManifest();
    const release = manifest.channels[selectedChannel];
    const comparison = compareSemVer(release.version, GCAC_VERSION);
    const channelChanged = selectedChannel !== settings.channel;
    const relation = channelChanged
      ? 'channel_switch'
      : release.version === GCAC_VERSION
        ? 'current'
        : comparison > 0
          ? 'upgrade'
          : 'downgrade';
    const updateAvailable = comparison !== 0;
    const action = comparison < 0 ? 'rollback' : comparison > 0 ? 'upgrade' : '';
    return {
      channel: selectedChannel,
      currentVersion: GCAC_VERSION,
      targetVersion: release.version,
      updateAvailable,
      relation,
      publishedAt: release.publishedAt,
      releaseNotes: release.releaseNotes,
      commands: {
        installScript: action ? `./install.sh ${action} ${release.version}` : '',
        compose: action
          ? `export GCAC_RELEASE_VERSION=${release.version} && docker compose pull && docker compose up -d`
          : '',
      },
      checkedAt: new Date().toISOString(),
    };
  }
}

export function assertUpdateChannel(value: unknown): UpdateChannel {
  if (value === 'stable' || value === 'dev') return value;
  throw new AppError('VALIDATION_FAILED', '更新通道只能是 stable 或 dev');
}

export function assertSettingsVersion(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new AppError('VALIDATION_FAILED', '更新通道版本必须是正整数');
  }
}
