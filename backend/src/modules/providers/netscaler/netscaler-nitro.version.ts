import { NetscalerSupportedVersions, type NetscalerSupportedVersion, type NetscalerVersion } from './netscaler.types.js';

const supportedVersions = new Set<string>(NetscalerSupportedVersions);

export function parseNetscalerVersion(raw: string): NetscalerVersion {
  const normalizedRaw = raw.trim();
  const versionMatch = normalizedRaw.match(/(?:NetScaler\s+)?NS\s*(\d+)\.(\d+)/i)
    ?? normalizedRaw.match(/\b(\d+)\.(\d+)\b/);
  if (!versionMatch) return { major: 0, minor: 0, raw: normalizedRaw };

  const major = Number(versionMatch[1]);
  const minor = Number(versionMatch[2]);
  const normalizedCandidate = `${major}.${minor}`;
  const build = normalizedRaw.match(/\bBuild\s+([^,\s]+)/i)?.[1]
    ?? normalizedRaw.match(/\b\d+\.\d+\s+([^,\s]+\.nc)\b/i)?.[1];

  return {
    major,
    minor,
    build,
    raw: normalizedRaw,
    normalized: supportedVersions.has(normalizedCandidate) ? normalizedCandidate as NetscalerSupportedVersion : undefined,
  };
}

export function netscalerVersionKey(version: NetscalerVersion): string {
  return version.normalized ?? `${version.major}.${version.minor}`;
}
