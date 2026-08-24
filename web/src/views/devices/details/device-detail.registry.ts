export type DeviceDetailKind = 'agent' | 'citrix-adc' | 'unsupported'

export function resolveDeviceDetailKind(detail: Record<string, unknown>): DeviceDetailKind {
  if (String(detail.extensionType ?? '').toUpperCase() === 'AGENT') return 'agent'

  const extensionSummary = isRecord(detail.extensionSummary) ? detail.extensionSummary : {}
  const family = String(
    detail.productFamily
      ?? extensionSummary.deviceFamily
      ?? extensionSummary.productFamily
      ?? '',
  ).toUpperCase()

  if (family.includes('CITRIX') || family.includes('NETSCALER') || family.includes('ADC')) return 'citrix-adc'
  return 'unsupported'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
