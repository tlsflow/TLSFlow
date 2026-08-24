import type { StatusTone } from './status-map'

export type RiskCode = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RiskMeta {
  readonly label: string
  readonly tone: StatusTone
  readonly description: string
}

export const riskDictionary = {
  LOW: { label: '低', tone: 'info', description: '需要关注，但不会直接阻断操作。' },
  MEDIUM: { label: '中', tone: 'warning', description: '可能影响部署或监控结果，需要确认。' },
  HIGH: { label: '高', tone: 'danger', description: '可能导致服务中断或安全暴露。' },
  CRITICAL: { label: '严重', tone: 'danger', description: '必须优先处理，危险操作需二次确认。' }
} satisfies Record<RiskCode, RiskMeta>

export function resolveRiskMeta(risk: RiskCode): RiskMeta {
  return riskDictionary[risk]
}
