export const LINUX_WEB_DISCOVERY_PATHS = Object.freeze([
  '/etc',
  '/opt',
  '/usr/local',
  '/usr/share/nginx',
  '/srv',
  '/var/lib',
  '/var/www',
]);

export const WINDOWS_WEB_DISCOVERY_PATHS = Object.freeze([
  'C:/Windows/System32/inetsrv/config/applicationHost.config',
  'C:/nginx',
  'C:/Apache24',
  'C:/Tomcat',
  'C:/ProgramData',
  'C:/Program Files',
  'C:/Program Files (x86)',
]);

export function selectWebDiscoveryPaths(osType: string): readonly string[] {
  return osType.toLowerCase().includes('windows')
    ? WINDOWS_WEB_DISCOVERY_PATHS
    : LINUX_WEB_DISCOVERY_PATHS;
}

/**
 * 只接受单一平台目录的子集，避免本机 Authority 被混合路径请求扩大范围。
 */
export function isAllowedWebDiscoveryPathSet(paths: readonly string[]): boolean {
  return paths.length > 0
    && (paths.every((path) => LINUX_WEB_DISCOVERY_PATHS.includes(path))
      || paths.every(isAllowedWindowsWebDiscoveryPath));
}

function isAllowedWindowsWebDiscoveryPath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/').toLowerCase();
  return WINDOWS_WEB_DISCOVERY_PATHS.some((allowed) => allowed.toLowerCase() === normalized);
}
