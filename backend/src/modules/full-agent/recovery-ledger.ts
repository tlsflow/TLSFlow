import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type RecoveryOperationKind = 'runtime' | 'upgrade' | 'rollback';
export type RecoveryOperationStatus = 'started' | 'staged' | 'activated' | 'verified' | 'rolled_back' | 'succeeded' | 'failed';

export interface RecoveryLedgerEntry {
  id: string;
  kind: RecoveryOperationKind;
  status: RecoveryOperationStatus;
  createdAt: string;
  updatedAt: string;
  step: string;
  detail: Record<string, unknown>;
  checksum: string;
}

export interface RecoveryLedgerSnapshot {
  entries: RecoveryLedgerEntry[];
}

function stableStringify(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(input as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((input as Record<string, unknown>)[key])}`).join(',')}}`;
}

function digestEntry(entry: Omit<RecoveryLedgerEntry, 'checksum'>): string {
  return createHash('sha256').update(stableStringify(jsonSafe(entry))).digest('hex');
}

function jsonSafe<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(tmpPath, filePath);
}

function withChecksum(entry: Omit<RecoveryLedgerEntry, 'checksum'>): RecoveryLedgerEntry {
  const normalized = jsonSafe(entry);
  return { ...normalized, checksum: digestEntry(normalized) };
}

function verifyChecksum(entry: RecoveryLedgerEntry): boolean {
  const { checksum: _checksum, ...unsigned } = entry;
  return entry.checksum === digestEntry(unsigned);
}

export class RecoveryLedger {
  private readonly entries = new Map<string, RecoveryLedgerEntry>();

  constructor(private readonly filePath?: string, snapshot?: RecoveryLedgerSnapshot) {
    for (const entry of snapshot?.entries ?? []) {
      if (!verifyChecksum(entry)) throw new Error(`恢复 ledger 记录被篡改：${entry.id}`);
      this.entries.set(entry.id, { ...entry, detail: { ...entry.detail } });
    }
  }

  static async load(filePath: string): Promise<RecoveryLedger> {
    try {
      const raw = await readFile(filePath, 'utf8');
      const snapshot = JSON.parse(raw) as RecoveryLedgerSnapshot;
      return new RecoveryLedger(filePath, snapshot);
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return new RecoveryLedger(filePath);
      }
      throw error;
    }
  }

  async start(id: string, kind: RecoveryOperationKind, step: string, detail: Record<string, unknown> = {}): Promise<RecoveryLedgerEntry> {
    const now = new Date().toISOString();
    const entry = withChecksum({
      id,
      kind,
      status: 'started',
      createdAt: now,
      updatedAt: now,
      step,
      detail,
    });
    this.entries.set(id, entry);
    await this.persist();
    return entry;
  }

  async record(id: string, status: RecoveryOperationStatus, step: string, detail: Record<string, unknown> = {}): Promise<RecoveryLedgerEntry> {
    const current = this.entries.get(id);
    if (!current) throw new Error(`恢复 ledger 记录不存在：${id}`);
    const next = withChecksum({
      id: current.id,
      kind: current.kind,
      status,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
      step,
      detail: { ...current.detail, ...detail },
    });
    this.entries.set(id, next);
    await this.persist();
    return next;
  }

  get(id: string): RecoveryLedgerEntry | undefined {
    const entry = this.entries.get(id);
    return entry ? cloneEntry(entry) : undefined;
  }

  recoverable(): RecoveryLedgerEntry[] {
    return [...this.entries.values()]
      .filter((entry) => !['succeeded', 'rolled_back'].includes(entry.status))
      .map((entry) => cloneEntry(entry));
  }

  snapshot(): RecoveryLedgerSnapshot {
    return { entries: [...this.entries.values()].map((entry) => cloneEntry(entry)) };
  }

  async persist(): Promise<void> {
    if (!this.filePath) return;
    await atomicWriteJson(this.filePath, this.snapshot());
  }
}

function cloneEntry(entry: RecoveryLedgerEntry): RecoveryLedgerEntry {
  return JSON.parse(JSON.stringify(entry)) as RecoveryLedgerEntry;
}
