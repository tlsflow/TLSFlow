import { AppError } from '../../../common/errors/app-error.js';
import type { RemoteFileClient } from './ssh.file-transfer.js';
import { sha256 } from './ssh.file-transfer.js';
import type { BackupManifest, BackupManifestItem } from './ssh.remote-backup.js';
import { manifestHash, restoreMetadata } from './ssh.remote-backup.js';

export interface RollbackItemResult {
  remotePath: string;
  action: 'restored' | 'deleted_new_file' | 'failed';
  success: boolean;
  diagnostic?: string;
}

export interface RollbackResult {
  success: boolean;
  backupId: string;
  items: RollbackItemResult[];
}

export class RemoteRollbackService {
  constructor(private readonly client: RemoteFileClient) {}

  async restore(manifest: BackupManifest): Promise<RollbackResult> {
    const expectedHash = manifest.integrityHash;
    if (manifestHash(manifest) !== expectedHash) {
      throw new AppError('VALIDATION_FAILED', 'BackupManifest 完整性校验失败', { backupId: manifest.backupId });
    }
    const items: RollbackItemResult[] = [];
    for (const item of manifest.items) {
      items.push(await this.restoreItem(item));
    }
    return { success: items.every((item) => item.success), backupId: manifest.backupId, items };
  }

  private async restoreItem(item: BackupManifestItem): Promise<RollbackItemResult> {
    try {
      if (!item.existed) {
        if (await this.client.exists(item.remotePath)) await this.client.deleteFile(item.remotePath);
        return { remotePath: item.remotePath, action: 'deleted_new_file', success: true };
      }
      const content = await this.client.readFile(item.backupRef);
      if (item.hash && sha256(content) !== item.hash) {
        return { remotePath: item.remotePath, action: 'failed', success: false, diagnostic: '备份内容 hash 与清单不一致' };
      }
      await this.client.writeFile(item.remotePath, content, 'sftp');
      await restoreMetadata(this.client, item.remotePath, { ...item, size: item.size ?? content.byteLength });
      return { remotePath: item.remotePath, action: 'restored', success: true };
    } catch (error) {
      return { remotePath: item.remotePath, action: 'failed', success: false, diagnostic: redactDiagnostic(error) };
    }
  }
}

function redactDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/(password|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
}
