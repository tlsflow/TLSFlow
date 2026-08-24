import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { RemoteFileClient, RemoteFileMetadata } from './ssh.file-transfer.js';
import { normalizeRemotePath, sha256 } from './ssh.file-transfer.js';

export interface BackupRequest {
  remotePath: string;
  backupRef?: string;
}

export interface BackupManifestItem {
  remotePath: string;
  backupRef: string;
  existed: boolean;
  size?: number;
  hash?: string;
  mode?: string;
  owner?: string;
  group?: string;
  mtime?: string;
}

export interface BackupManifest {
  backupId: string;
  targetHostId: string;
  createdAt: string;
  createdByTaskId: string;
  storageMode: 'remote';
  items: BackupManifestItem[];
  integrityHash: string;
}

export class RemoteBackupService {
  constructor(private readonly client: RemoteFileClient) {}

  async createManifest(input: { targetHostId: string; taskId: string; items: BackupRequest[]; createdAt?: string }): Promise<BackupManifest> {
    if (!input.items.length) throw new AppError('VALIDATION_FAILED', '备份清单至少需要一个文件');
    const backupId = `backup_${randomUUID()}`;
    const items: BackupManifestItem[] = [];
    for (const item of input.items) {
      const remotePath = normalizeRemotePath(item.remotePath);
      const backupRef = item.backupRef ?? `${remotePath}.gcac-backup-${backupId}`;
      if (!(await this.client.exists(remotePath))) {
        items.push({ remotePath, backupRef, existed: false });
        continue;
      }
      const content = await this.client.readFile(remotePath);
      const metadata = await this.client.stat(remotePath);
      await this.client.writeFile(backupRef, content, 'sftp');
      await restoreMetadata(this.client, backupRef, metadata);
      items.push({
        remotePath,
        backupRef,
        existed: true,
        size: content.byteLength,
        hash: sha256(content),
        mode: metadata.mode,
        owner: metadata.owner,
        group: metadata.group,
        mtime: metadata.mtime,
      });
    }
    const manifest: BackupManifest = {
      backupId,
      targetHostId: input.targetHostId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      createdByTaskId: input.taskId,
      storageMode: 'remote',
      items,
      integrityHash: '',
    };
    return { ...manifest, integrityHash: manifestHash(manifest) };
  }
}

export function manifestHash(manifest: Omit<BackupManifest, 'integrityHash'> | BackupManifest): string {
  const stable = { ...manifest, integrityHash: undefined };
  return createHash('sha256').update(JSON.stringify(stable), 'utf8').digest('hex');
}

export async function restoreMetadata(client: RemoteFileClient, remotePath: string, metadata: RemoteFileMetadata): Promise<void> {
  if (metadata.mode) await client.chmod(remotePath, metadata.mode);
  if (metadata.owner || metadata.group) await client.chown(remotePath, metadata.owner, metadata.group);
}
