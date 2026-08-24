import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { KnownHostRecord, SSHConnectionProfile, SshHostKeyDecision, SshHostKeyInfo } from './ssh.types.js';

export interface KnownHostRepository {
  find(address: string, port: number): Promise<KnownHostRecord | undefined>;
  save(record: KnownHostRecord): Promise<KnownHostRecord>;
}

export class InMemoryKnownHostRepository implements KnownHostRepository {
  private readonly records = new Map<string, KnownHostRecord>();

  constructor(initialRecords: KnownHostRecord[] = []) {
    for (const record of initialRecords) this.records.set(keyFor(record.address, record.port), record);
  }

  async find(address: string, port: number): Promise<KnownHostRecord | undefined> {
    return this.records.get(keyFor(address, port));
  }

  async save(record: KnownHostRecord): Promise<KnownHostRecord> {
    this.records.set(keyFor(record.address, record.port), record);
    return record;
  }

  values(): KnownHostRecord[] {
    return [...this.records.values()];
  }
}

export interface HostKeyVerificationResult {
  decision: SshHostKeyDecision;
  record?: KnownHostRecord;
  fingerprint: string;
}

export class HostKeyVerifier {
  constructor(private readonly repository: KnownHostRepository = new InMemoryKnownHostRepository()) {}

  async verify(connection: SSHConnectionProfile, hostKey: SshHostKeyInfo): Promise<HostKeyVerificationResult> {
    const address = connection.host;
    const port = connection.port ?? 22;
    const policy = normalizePolicy(connection.hostKeyPolicy);
    const observed = normalizeFingerprint(hostKey.fingerprint);
    const expected = connection.expectedHostKeyFingerprint ? normalizeFingerprint(connection.expectedHostKeyFingerprint) : undefined;
    const existing = await this.repository.find(address, port);

    if (expected && expected !== observed) {
      await this.markMismatch(existing, connection, hostKey, observed);
      throw hostKeyError('HOST_KEY_MISMATCH', 'SSH Host Key 指纹不匹配', connection, observed);
    }

    if (existing?.status === 'trusted') {
      if (normalizeFingerprint(existing.fingerprint) !== observed) {
        await this.markMismatch(existing, connection, hostKey, observed);
        throw hostKeyError('HOST_KEY_MISMATCH', 'SSH Host Key 与 Known Hosts 记录不一致', connection, observed);
      }
      const updated = { ...existing, lastSeenAt: new Date().toISOString() };
      await this.repository.save(updated);
      return { decision: 'verified', record: updated, fingerprint: observed };
    }

    if (existing?.status === 'revoked') {
      throw hostKeyError('HOST_KEY_UNKNOWN', 'SSH Host Key 记录已撤销', connection, observed);
    }

    if (existing?.status === 'mismatch') {
      throw hostKeyError('HOST_KEY_MISMATCH', 'SSH Host Key 已标记为不匹配', connection, observed);
    }

    if (expected) {
      const record = await this.repository.save(newRecord(connection, hostKey, observed, 'trusted'));
      return { decision: 'verified', record, fingerprint: observed };
    }

    if (policy === 'trust_on_first_use') {
      const record = await this.repository.save(newRecord(connection, hostKey, observed, 'trusted'));
      return { decision: 'trust_on_first_use', record, fingerprint: observed };
    }

    if (policy === 'manual_approval') {
      const record = await this.repository.save(newRecord(connection, hostKey, observed, 'pending'));
      throw hostKeyError('HOST_KEY_APPROVAL_REQUIRED', 'SSH Host Key 需要人工审批', connection, observed, record.id);
    }

    throw hostKeyError('HOST_KEY_UNKNOWN', 'strict Host Key 策略要求 Known Hosts 记录或 expectedHostKeyFingerprint', connection, observed);
  }

  private async markMismatch(existing: KnownHostRecord | undefined, connection: SSHConnectionProfile, hostKey: SshHostKeyInfo, fingerprint: string): Promise<void> {
    if (existing) {
      await this.repository.save({ ...existing, fingerprint, algorithm: hostKey.algorithm, status: 'mismatch', lastSeenAt: new Date().toISOString() });
      return;
    }
    await this.repository.save(newRecord(connection, hostKey, fingerprint, 'mismatch'));
  }
}

export function sha256Fingerprint(data: Buffer): string {
  return `SHA256:${createHash('sha256').update(data).digest('base64').replace(/=+$/u, '')}`;
}

export function normalizeFingerprint(value: string): string {
  const trimmed = value.trim();
  if (/^SHA256:/i.test(trimmed)) return `SHA256:${trimmed.slice(7).replace(/=+$/u, '')}`;
  const hex = trimmed.replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{16,128}$/.test(hex)) throw new AppError('VALIDATION_FAILED', 'Host Key 指纹格式不合法');
  return hex;
}

function normalizePolicy(policy: SSHConnectionProfile['hostKeyPolicy']): 'strict' | 'trust_on_first_use' | 'manual_approval' {
  if (policy === 'manual_approval_required') return 'manual_approval';
  return policy ?? 'strict';
}

function newRecord(connection: SSHConnectionProfile, hostKey: SshHostKeyInfo, fingerprint: string, status: KnownHostRecord['status']): KnownHostRecord {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    hostId: connection.hostId,
    address: connection.host,
    port: connection.port ?? 22,
    algorithm: hostKey.algorithm,
    fingerprint,
    status,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

function keyFor(address: string, port: number): string {
  return `${address.toLowerCase()}:${port}`;
}

function hostKeyError(code: string, message: string, connection: SSHConnectionProfile, fingerprint: string, knownHostId?: string): AppError {
  return new AppError('VALIDATION_FAILED', message, {
    sshErrorCode: code,
    stage: 'host_key',
    target: `${connection.host}:${connection.port ?? 22}`,
    fingerprint,
    knownHostId,
    category: code === 'HOST_KEY_MISMATCH' ? 'security' : 'approval',
    suggestion: code === 'HOST_KEY_MISMATCH' ? '停止执行并核查目标主机身份，确认后更新 Known Hosts' : '审批或预置目标主机 Host Key 后重试',
  });
}
