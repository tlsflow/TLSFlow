import type { TlsInspectionSnapshot } from '@/api/modules/tls-inspector.api'
import { getExpiryCountdown } from '@/utils/browser-local-time'

export type TlsRatingTone = 'success' | 'warning' | 'danger' | 'info' | 'muted'

const REAL_TRUST_PATH_ISSUE_STATUSES = new Set(['untrusted', 'incomplete'])

export const TLS_SCORE_WEIGHTS = {
  certificate: 0.3,
  protocol: 0.3,
  keyExchange: 0.2,
  cipherStrength: 0.2,
} as const

export function countRealTrustPathIssues(snapshot: TlsInspectionSnapshot): number {
  return snapshot.trustPaths.filter((item) => REAL_TRUST_PATH_ISSUE_STATUSES.has(item.status.toLowerCase())).length
}

export function countUnsupportedTrustPaths(snapshot: TlsInspectionSnapshot): number {
  return snapshot.trustPaths.filter((item) => item.status.toLowerCase() === 'unsupported').length
}

export function computeOverallScore(current: TlsInspectionSnapshot, now = new Date()): number {
  const componentScores = {
    certificate: computeCertificateScore(current, now),
    protocol: computeProtocolScore(current),
    keyExchange: computeKeyExchangeScore(current),
    cipherStrength: computeCipherStrengthScore(current),
  }
  const score = Object.entries(TLS_SCORE_WEIGHTS).reduce(
    (total, [key, weight]) => total + componentScores[key as keyof typeof componentScores] * weight,
    0,
  )
  return clampScore(score)
}

export function computeCertificateScore(current: TlsInspectionSnapshot, now = new Date()): number {
  let score = 100
  if (!current.certificate) return 30
  score -= Math.min(countRealTrustPathIssues(current) * 15, 45)
  const expiry = getExpiryCountdown(current.certificate.notAfter, now)
  if (expiry?.expired) score -= 40
  else if (expiry && expiry.days <= 7) score -= 8
  return clampScore(score)
}

export function computeProtocolScore(current: TlsInspectionSnapshot): number {
  let score = 100
  if (!current.riskSummary.tls13Supported) score -= 20
  if (current.riskSummary.legacyProtocolEnabled) score -= 35
  if (current.protocols.find((item) => item.label === 'SSL 3.0')?.supported) score -= 20
  return clampScore(score)
}

export function computeKeyExchangeScore(current: TlsInspectionSnapshot): number {
  let score = 100
  if (!current.protocolDetails.forwardSecrecy) score -= 28
  if (!(current.protocolDetails.supportedNamedGroups?.length ?? 0)) score -= 14
  if (!current.protocolDetails.pqcSupported) score -= 6
  if (current.riskSummary.simulationFailedCount > 0) score -= Math.min(current.riskSummary.simulationFailedCount * 2, 16)
  return clampScore(score)
}

export function computeCipherStrengthScore(current: TlsInspectionSnapshot): number {
  let score = 100
  const insecureCount = current.cipherSuites.filter((item) => item.insecure).length
  const weakCount = current.cipherSuites.filter((item) => item.weak && !item.insecure).length
  score -= Math.min(insecureCount * 18, 36)
  score -= Math.min(weakCount * 8, 24)
  const maxStrength = Math.max(...current.cipherSuites.map((item) => item.strengthBits ?? 0), 0)
  if (current.cipherSuites.length && maxStrength < 128) score -= 15
  return clampScore(score)
}

export function computeTlsInspectionRating(snapshot: TlsInspectionSnapshot | null | undefined, now = new Date()): string {
  if (!snapshot) return '—'
  return scoreToTlsGrade(computeOverallScore(snapshot, now))
}

export function tlsRatingTone(grade: string): TlsRatingTone {
  if (grade === '—') return 'muted'
  if (grade.startsWith('A')) return 'success'
  if (grade === 'B') return 'info'
  if (grade === 'C') return 'warning'
  return 'danger'
}

export function scoreToTlsGrade(score: number): string {
  if (score >= 97) return 'A+'
  if (score >= 92) return 'A'
  if (score >= 85) return 'B'
  if (score >= 72) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

export function scoreToTlsScalePosition(score: number): number {
  const normalized = Math.max(0, Math.min(100, score))
  if (normalized < 60) return (normalized / 60) * 20
  if (normalized < 85) return 20 + ((normalized - 60) / 25) * 40
  return 60 + ((normalized - 85) / 15) * 40
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)))
}
