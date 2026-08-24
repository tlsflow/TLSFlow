import { createHash, randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export interface SessionProcessHandle {
  readonly sessionId: string;
  readonly slot: number;
  readonly processId: number;
  readonly processStartedAt: string;
  readonly contextNonce: string;
  readonly sessionDirectory: string;
  readonly displayNumber: number;
  readonly cdpPort: number;
  readonly rfbPort: number;
  readonly exit: Promise<number | null>;
  exited: boolean;
  stopped: boolean;
}

export interface SessionProcessLauncherOptions {
  readonly rootDirectory?: string;
  readonly scriptPath?: string;
  readonly chromiumExecutable?: string;
  readonly screenSize?: string;
  readonly maxSessions?: number;
  readonly displayBase?: number;
  readonly cdpPortBase?: number;
  readonly rfbPortBase?: number;
}

export class SessionSlotPool {
  private readonly owners = new Map<number, string>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Browser Runtime 最大会话数必须是正整数');
    }
  }

  allocate(sessionId: string): number {
    for (let slot = 0; slot < this.capacity; slot += 1) {
      if (this.owners.has(slot)) continue;
      this.owners.set(slot, sessionId);
      return slot;
    }
    throw new Error('Browser Runtime 会话容量已耗尽');
  }

  release(slot: number, sessionId: string): void {
    if (this.owners.get(slot) === sessionId) this.owners.delete(slot);
  }

  get activeCount(): number {
    return this.owners.size;
  }
}

export class SessionProcessLauncher {
  private readonly rootDirectory: string;
  private readonly scriptPath: string;
  private readonly chromiumExecutable: string;
  private readonly defaultScreenSize: string;
  private readonly displayBase: number;
  private readonly cdpPortBase: number;
  private readonly rfbPortBase: number;
  private readonly slots: SessionSlotPool;
  private readonly children = new Map<string, ChildProcess>();
  private readonly cleanupPromises = new Map<string, Promise<void>>();

  constructor(options: SessionProcessLauncherOptions = {}) {
    this.rootDirectory = resolve(options.rootDirectory ?? process.env.BROWSER_SESSION_ROOT ?? '/run/gcac-browser-sessions');
    this.scriptPath = resolve(options.scriptPath ?? process.env.BROWSER_SESSION_SCRIPT ?? 'container/start-session.sh');
    this.chromiumExecutable = options.chromiumExecutable ?? process.env.BROWSER_CHROMIUM_EXECUTABLE ?? 'chromium';
    this.defaultScreenSize = options.screenSize ?? process.env.BROWSER_SCREEN_SIZE ?? '1280x800x24';
    this.displayBase = options.displayBase ?? 100;
    this.cdpPortBase = options.cdpPortBase ?? 19_000;
    this.rfbPortBase = options.rfbPortBase ?? 15_900;
    this.slots = new SessionSlotPool(options.maxSessions ?? positiveInteger(process.env.BROWSER_RUNTIME_MAX_SESSIONS, 4));
  }

  async start(sessionId: string, screenSize = this.defaultScreenSize): Promise<SessionProcessHandle> {
    const slot = this.slots.allocate(sessionId);
    const sessionDirectory = buildSessionDirectory(this.rootDirectory, sessionId);
    await mkdir(this.rootDirectory, { recursive: true, mode: 0o700 });

    try {
      await rm(sessionDirectory, { recursive: true, force: true });
      await mkdir(sessionDirectory, { mode: 0o700 });
      const displayNumber = this.displayBase + slot;
      const cdpPort = this.cdpPortBase + slot;
      const rfbPort = this.rfbPortBase + slot;
      const child = spawn(this.scriptPath, [], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          SESSION_ID: sessionId,
          SESSION_DIR: sessionDirectory,
          DISPLAY_NUM: String(displayNumber),
          CDP_PORT: String(cdpPort),
          RFB_PORT: String(rfbPort),
          CHROMIUM_EXECUTABLE: this.chromiumExecutable,
          SCREEN_SIZE: screenSize,
        },
      });
      if (!child.pid) throw new Error('无法取得浏览器会话进程 PID');
      child.unref();

      let resolveExit!: (code: number | null) => void;
      let settled = false;
      const exit = new Promise<number | null>((resolveExitPromise) => {
        resolveExit = resolveExitPromise;
      });
      const handle: SessionProcessHandle = {
        sessionId,
        slot,
        processId: child.pid,
        processStartedAt: new Date().toISOString(),
        contextNonce: randomUUID(),
        sessionDirectory,
        displayNumber,
        cdpPort,
        rfbPort,
        exit,
        exited: false,
        stopped: false,
      };
      const settleExit = (code: number | null): void => {
        if (settled) return;
        settled = true;
        handle.exited = true;
        resolveExit(code);
      };
      child.once('exit', settleExit);
      child.once('error', () => settleExit(null));
      this.children.set(sessionId, child);
      return handle;
    } catch (error) {
      this.slots.release(slot, sessionId);
      await rm(sessionDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  isAlive(handle: SessionProcessHandle): boolean {
    if (handle.exited) return false;
    try {
      process.kill(handle.processId, 0);
      return true;
    } catch {
      return false;
    }
  }

  async stop(handle: SessionProcessHandle): Promise<void> {
    if (handle.stopped) return;
    const runningCleanup = this.cleanupPromises.get(handle.sessionId);
    if (runningCleanup) return runningCleanup;

    const cleanup = this.stopOnce(handle).finally(() => {
      this.cleanupPromises.delete(handle.sessionId);
    });
    this.cleanupPromises.set(handle.sessionId, cleanup);
    return cleanup;
  }

  private async stopOnce(handle: SessionProcessHandle): Promise<void> {
    const child = this.children.get(handle.sessionId);
    try {
      if (!handle.exited) {
        signalProcessGroup(handle.processId, 'SIGTERM');
        const exited = await Promise.race([
          handle.exit.then(() => true),
          delay(5_000).then(() => false),
        ]);
        if (!exited) {
          signalProcessGroup(handle.processId, 'SIGKILL');
          await Promise.race([handle.exit, delay(2_000)]);
        }
      }
    } finally {
      child?.removeAllListeners();
      this.children.delete(handle.sessionId);
      this.slots.release(handle.slot, handle.sessionId);
      handle.stopped = true;
      await removeSessionDirectory(this.rootDirectory, handle.sessionDirectory);
    }
  }

  get activeCount(): number {
    return this.slots.activeCount;
  }
}

export function buildSessionDirectory(rootDirectory: string, sessionId: string): string {
  const root = resolve(rootDirectory);
  const safeName = sessionId.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 48) || 'session';
  const suffix = createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
  const target = resolve(root, `${safeName}-${suffix}`);
  if (!target.startsWith(`${root}${sep}`)) throw new Error('浏览器会话目录越界');
  return target;
}

async function removeSessionDirectory(rootDirectory: string, sessionDirectory: string): Promise<void> {
  const root = resolve(rootDirectory);
  const target = resolve(sessionDirectory);
  if (!target.startsWith(`${root}${sep}`)) throw new Error('拒绝清理 Browser Runtime 会话根目录之外的路径');
  await rm(target, { recursive: true, force: true });
}

function signalProcessGroup(processId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processId, signal);
  } catch (error) {
    if (!isMissingProcess(error)) throw error;
  }
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH';
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
