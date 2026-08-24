import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BuiltinUnifiedPluginLoader } from './builtin-unified-plugin-loader.js';

export interface BuiltinPluginPackageSnapshot {
  pluginId: string;
  version: string;
  packageSha256: string;
}

export interface BuiltinPluginPackageLedger {
  version: 1;
  packages: BuiltinPluginPackageSnapshot[];
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const ledgerPath = join(moduleDirectory, 'builtin-plugin-package-ledger.json');

export async function loadBuiltinPluginPackageSnapshots(
  loader = new BuiltinUnifiedPluginLoader(),
): Promise<BuiltinPluginPackageSnapshot[]> {
  const packages = await loader.loadPackages();
  return packages.map((pluginPackage) => {
    const manifest = pluginPackage.manifest as { pluginId?: unknown; version?: unknown };
    if (typeof manifest.pluginId !== 'string' || typeof manifest.version !== 'string') {
      throw new Error('内置插件包缺少有效的 pluginId 或 version');
    }
    return {
      pluginId: manifest.pluginId,
      version: manifest.version,
      packageSha256: sha256(pluginPackage.packageContent),
    };
  }).sort(compareSnapshots);
}

export function validateBuiltinPluginPackageLedger(
  ledger: BuiltinPluginPackageLedger,
  currentSnapshots: BuiltinPluginPackageSnapshot[],
): string[] {
  assertLedgerShape(ledger);
  const entries = new Map<string, BuiltinPluginPackageSnapshot>();
  const violations: string[] = [];
  for (const snapshot of ledger.packages) {
    const key = snapshotKey(snapshot);
    if (entries.has(key)) violations.push(`${key} 在指纹台账中重复登记`);
    entries.set(key, snapshot);
  }
  for (const snapshot of currentSnapshots) {
    const key = snapshotKey(snapshot);
    const registered = entries.get(key);
    if (!registered) {
      violations.push(`${key} 尚未登记，请确认版本递进后更新指纹台账`);
      continue;
    }
    if (registered.packageSha256 !== snapshot.packageSha256) {
      violations.push(`${key} 的最终包内容已变化，但版本号未递进`);
    }
  }
  return violations;
}

export function appendBuiltinPluginPackageSnapshots(
  ledger: BuiltinPluginPackageLedger,
  currentSnapshots: BuiltinPluginPackageSnapshot[],
): BuiltinPluginPackageLedger {
  const violations = validateBuiltinPluginPackageLedger(ledger, currentSnapshots)
    .filter((violation) => violation.includes('最终包内容已变化') || violation.includes('重复登记'));
  if (violations.length > 0) throw new Error(violations.join('\n'));
  const entries = new Map(ledger.packages.map((snapshot) => [snapshotKey(snapshot), snapshot]));
  for (const snapshot of currentSnapshots) entries.set(snapshotKey(snapshot), snapshot);
  return { version: 1, packages: [...entries.values()].sort(compareSnapshots) };
}

function readLedger(): BuiltinPluginPackageLedger {
  if (!existsSync(ledgerPath)) return { version: 1, packages: [] };
  return JSON.parse(readFileSync(ledgerPath, 'utf8')) as BuiltinPluginPackageLedger;
}

function assertLedgerShape(ledger: BuiltinPluginPackageLedger): void {
  if (ledger.version !== 1 || !Array.isArray(ledger.packages)) throw new Error('内置插件包指纹台账格式无效');
}

function snapshotKey(snapshot: Pick<BuiltinPluginPackageSnapshot, 'pluginId' | 'version'>): string {
  return `${snapshot.pluginId}@${snapshot.version}`;
}

function compareSnapshots(left: BuiltinPluginPackageSnapshot, right: BuiltinPluginPackageSnapshot): number {
  return left.pluginId.localeCompare(right.pluginId) || left.version.localeCompare(right.version);
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

async function run(): Promise<void> {
  const snapshots = await loadBuiltinPluginPackageSnapshots();
  const ledger = readLedger();
  if (process.argv.includes('--update')) {
    const updated = appendBuiltinPluginPackageSnapshots(ledger, snapshots);
    writeFileSync(ledgerPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    console.log(`内置插件包指纹台账已更新：当前 ${snapshots.length} 个包，累计 ${updated.packages.length} 个版本。`);
    return;
  }
  const violations = validateBuiltinPluginPackageLedger(ledger, snapshots);
  if (violations.length === 0) {
    console.log(`内置插件最终包指纹检查通过：${snapshots.length} 个包。`);
    return;
  }
  console.error('内置插件最终包指纹检查失败：');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await run();
