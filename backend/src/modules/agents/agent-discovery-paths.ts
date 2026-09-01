export const LINUX_WEB_DISCOVERY_PATHS: readonly string[] = Object.freeze([
  '/etc',
  '/opt',
  '/usr/local',
  '/srv',
  '/var/lib',
  '/var/www',
]);

export const WINDOWS_WEB_DISCOVERY_PATHS: readonly string[] = Object.freeze([]);

export function selectWebDiscoveryPaths(osType: string): readonly string[] {
  return osType.toLowerCase().includes('windows')
    ? WINDOWS_WEB_DISCOVERY_PATHS
    : LINUX_WEB_DISCOVERY_PATHS;
}

/**
 * 只接受单一平台目录的子集，避免本机 Authority 被混合路径请求扩大范围。
 */
export function isAllowedWebDiscoveryPathSet(paths: readonly string[]): boolean {
  if (paths.length === 0) return true;
  return paths.every((path) => LINUX_WEB_DISCOVERY_PATHS.includes(path))
    || paths.every(isAllowedWindowsWebDiscoveryPath);
}

function isAllowedWindowsWebDiscoveryPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  return WINDOWS_WEB_DISCOVERY_PATHS.some((allowed) => allowed.replaceAll('\\', '/').toLowerCase() === normalized);
}
