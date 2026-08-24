export function buildManagedTargetDeploymentStrategy(managedTargetId: string, certificateFormatId: string) {
  return {
    type: 'MANAGED_TARGET',
    managedTarget: {
      managedTargetId: managedTargetId.trim(),
      certificateFormatId: certificateFormatId.trim(),
      executionMode: 'PLUGIN',
    },
  } as const
}

export function resolveDeploymentStrategyMode(strategy: Record<string, unknown> | null | undefined): 'MANAGED_TARGET' | 'WORKFLOW' {
  return strategy?.type === 'WORKFLOW' ? 'WORKFLOW' : 'MANAGED_TARGET'
}

export function normalizeFrameworkType(value: unknown): string {
  return String(value ?? '').trim()
}

export function frameworkTypesMatch(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeFrameworkType(left).toLowerCase()
  const normalizedRight = normalizeFrameworkType(right).toLowerCase()
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

export function collectFrameworkTypeOptions(
  frameworks: readonly Readonly<Record<string, unknown>>[],
  currentValue = '',
): string[] {
  const values = frameworks.map(item => normalizeFrameworkType(item.frameworkType))
  values.push(normalizeFrameworkType(currentValue))
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right))
}
