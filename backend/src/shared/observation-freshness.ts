export function readPositiveSeconds(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 中文说明：插件设备的"发现成功"是应用层强证据，但发现只能手动触发，
 * 不像心跳和 TCP 探测那样有周期调度。因此它必须使用独立的、远大于
 * DEVICE_HEALTH_STALE_SECONDS 的过期窗口，否则所有网络设备会在 60 秒后
 * 集体变成未知。默认 24 小时。
 */
export function readDiscoveryStaleSeconds(): number {
  return readPositiveSeconds('DEVICE_DISCOVERY_STALE_SECONDS', 24 * 60 * 60);
}

export function isObservationStale(
  observedAt: string | undefined,
  staleAfterSeconds: number,
  now: Date = new Date(),
): boolean {
  if (!observedAt) return false;
  const timestamp = Date.parse(observedAt);
  if (Number.isNaN(timestamp)) return true;
  return now.getTime() - timestamp > staleAfterSeconds * 1000;
}
