export function buildManagedTargetDeploymentStrategy(managedTargetId: string, certificateFormatId: string) {
  return {
    type: 'MANAGED_TARGET',
    managedTarget: {
      managedTargetId: managedTargetId.trim(),
      certificateFormatId: certificateFormatId.trim(),
    },
  } as const
}

export function resolveDeploymentStrategyMode(strategy: Record<string, unknown> | null | undefined): 'MANAGED_TARGET' | 'WORKFLOW' {
  return strategy?.type === 'WORKFLOW' ? 'WORKFLOW' : 'MANAGED_TARGET'
}
