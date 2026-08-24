import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultBackendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnvFile(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  backendRoot: string = defaultBackendRoot,
): void {
  const envFile = resolveEnvFilePath(cwd, backendRoot);
  if (!existsSync(envFile)) return;

  const content = readFileSync(envFile, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (!key || env[key] !== undefined) continue;

    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }
}

export function resolveEnvFilePath(cwd: string, backendRoot: string = defaultBackendRoot): string {
  const candidates = new Set<string>([
    resolve(cwd, '.env'),
    resolve(cwd, 'backend', '.env'),
    resolve(backendRoot, '.env'),
  ]);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return resolve(cwd, '.env');
}
