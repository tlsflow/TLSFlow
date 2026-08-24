import { describe, expect, it } from 'vitest'
import type { TlsInspectionSnapshot } from '@/api/modules/tls-inspector.api'
import {
  computeCertificateScore,
  computeOverallScore,
  computeTlsInspectionRating,
  countRealTrustPathIssues,
  countUnsupportedTrustPaths,
  scoreToTlsScalePosition,
  TLS_SCORE_WEIGHTS,
} from '@/views/monitoring/monitor-tls-scoring'

function createSnapshot(overrides: Partial<TlsInspectionSnapshot> = {}): TlsInspectionSnapshot {
  return {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    targetId: 'target-1',
    startedAt: '2026-08-08T00:00:00.000Z',
    finishedAt: '2026-08-08T00:00:05.000Z',
    status: 'succeeded',
    summary: { endpoint: 'example.com:443' },
    certificate: {
      subject: 'CN=example.com',
      notAfter: '2026-12-31T00:00:00.000Z',
    },
    trustPaths: [
      { view: 'mozilla', viewLabel: 'Mozilla', status: 'trusted' },
      { view: 'apple', viewLabel: 'Apple', status: 'unsupported' },
    ],
    protocols: [
      { id: 'tls1_3', label: 'TLS 1.3', supported: true },
      { id: 'tls1_2', label: 'TLS 1.2', supported: true },
    ],
    cipherSuites: [],
    simulations: [],
    protocolDetails: {
      forwardSecrecy: true,
      pqcSupported: false,
      supportedNamedGroups: ['X25519'],
    },
    riskSummary: {
      legacyProtocolEnabled: false,
      weakCipherDetected: false,
      tls13Supported: true,
      hstsTooShort: false,
      trustPathIssueCount: 0,
      trustPathUnsupportedCount: 1,
      simulationFailedCount: 0,
      boundaryNotes: [],
    },
    implementationVersion: '2026.08.07',
    profileCatalogVersion: '2026.08.07',
    trustCatalogVersion: '2026.08.07',
    ...overrides,
  }
}

describe('TLS 深度探测评分口径', () => {
  it('不把 unsupported 信任视角计入真实认证路径风险', () => {
    const snapshot = createSnapshot({
      status: 'partial',
      errors: [{ code: 'INSPECTOR_UNAVAILABLE', message: 'Parse Error: Expected HTTP/' }],
    })

    expect(countRealTrustPathIssues(snapshot)).toBe(0)
    expect(countUnsupportedTrustPaths(snapshot)).toBe(1)
    expect(computeCertificateScore(snapshot, new Date('2026-08-08T00:00:00.000Z'))).toBe(100)
    expect(computeOverallScore(snapshot, new Date('2026-08-08T00:00:00.000Z'))).toBe(99)
  })

  it('只在证书七天内到期时扣临期分', () => {
    const now = new Date('2026-08-08T00:00:00.000Z')
    const sevenDays = createSnapshot({
      certificate: { subject: 'CN=example.com', notAfter: '2026-08-15T00:00:00.000Z' },
    })
    const eightDays = createSnapshot({
      certificate: { subject: 'CN=example.com', notAfter: '2026-08-16T00:00:00.000Z' },
    })

    expect(computeCertificateScore(sevenDays, now)).toBe(92)
    expect(computeCertificateScore(eightDays, now)).toBe(100)
  })

  it('partial 状态和 HTTP/2 解析错误不参与综合评分', () => {
    const snapshot = createSnapshot({
      status: 'partial',
      errors: [{ code: 'INSPECTOR_UNAVAILABLE', message: 'HTTPS 元数据读取失败：Parse Error: Expected HTTP/' }],
      trustPaths: [
        { view: 'mozilla', viewLabel: 'Mozilla', status: 'untrusted' },
        { view: 'apple', viewLabel: 'Apple', status: 'unsupported' },
      ],
      riskSummary: {
        legacyProtocolEnabled: false,
        weakCipherDetected: false,
        tls13Supported: true,
        hstsTooShort: false,
        trustPathIssueCount: 1,
        trustPathUnsupportedCount: 1,
        simulationFailedCount: 0,
        boundaryNotes: [],
      },
    })

    expect(computeOverallScore(snapshot, new Date('2026-08-08T00:00:00.000Z'))).toBe(94)
  })

  it('综合评分使用四个分项的加权平均，不直接取最低分', () => {
    const snapshot = createSnapshot({
      riskSummary: {
        legacyProtocolEnabled: true,
        weakCipherDetected: false,
        tls13Supported: false,
        hstsTooShort: false,
        trustPathIssueCount: 0,
        trustPathUnsupportedCount: 1,
        simulationFailedCount: 0,
        boundaryNotes: [],
      },
      protocols: [
        { id: 'tls1_3', label: 'TLS 1.3', supported: false },
        { id: 'tls1_2', label: 'TLS 1.2', supported: true },
        { id: 'ssl3', label: 'SSL 3.0', supported: true },
      ],
    })

    const score = computeOverallScore(snapshot, new Date('2026-08-08T00:00:00.000Z'))

    expect(TLS_SCORE_WEIGHTS.certificate + TLS_SCORE_WEIGHTS.protocol + TLS_SCORE_WEIGHTS.keyExchange + TLS_SCORE_WEIGHTS.cipherStrength).toBe(1)
    expect(score).toBe(76)
    expect(score).toBeGreaterThan(60)
    expect(computeTlsInspectionRating(snapshot, new Date('2026-08-08T00:00:00.000Z'))).toBe('C')
  })

  it('将原始分数映射到与评级等级一致的三段色带', () => {
    expect(scoreToTlsScalePosition(45)).toBe(15)
    expect(scoreToTlsScalePosition(60)).toBe(20)
    expect(scoreToTlsScalePosition(76)).toBe(45.6)
    expect(scoreToTlsScalePosition(85)).toBe(60)
    expect(scoreToTlsScalePosition(100)).toBe(100)
  })
})
