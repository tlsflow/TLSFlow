import type { StatusTone } from './status-map'

export type RiskCode = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RiskMeta {
  readonly label: string
  readonly tone: StatusTone
  readonly description: string
}

interface RiskDefinition {
  readonly labelKey: string
  readonly descriptionKey: string
  readonly tone: StatusTone
}

type Translate = (key: string) => string

export const riskDictionary = {
  LOW: { labelKey: 'designSystem.risk.LOW.label', tone: 'info', descriptionKey: 'designSystem.risk.LOW.description' },
  MEDIUM: { labelKey: 'designSystem.risk.MEDIUM.label', tone: 'warning', descriptionKey: 'designSystem.risk.MEDIUM.description' },
  HIGH: { labelKey: 'designSystem.risk.HIGH.label', tone: 'danger', descriptionKey: 'designSystem.risk.HIGH.description' },
  CRITICAL: { labelKey: 'designSystem.risk.CRITICAL.label', tone: 'danger', descriptionKey: 'designSystem.risk.CRITICAL.description' }
} satisfies Record<RiskCode, RiskDefinition>

export function resolveRiskMeta(risk: RiskCode, t: Translate = (key) => key): RiskMeta {
  const definition = riskDictionary[risk]
  return {
    label: t(definition.labelKey),
    tone: definition.tone,
    description: t(definition.descriptionKey)
  }
}
