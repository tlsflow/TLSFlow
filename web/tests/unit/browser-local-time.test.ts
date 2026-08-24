import { describe, expect, it } from 'vitest'
import { formatMaybeLocalTimeByCandidates, getExpiryCountdown, getExpiryRemaining, isDateTimeCandidate } from '@/utils/browser-local-time'

describe('浏览器本地时间格式化', () => {
  it('识别统一设备最近通信字段并移除 UTC ISO 展示', () => {
    const candidates = ['lastContactAt']
    const formatted = formatMaybeLocalTimeByCandidates('2026-07-23T01:32:46.419Z', candidates)

    expect(isDateTimeCandidate(candidates)).toBe(true)
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(formatted).not.toContain('T')
    expect(formatted).not.toContain('Z')
  })

  it('计算证书剩余和过期天数并向上取整', () => {
    const now = new Date('2026-07-27T12:00:00+08:00')

    expect(getExpiryCountdown('2026-07-28T11:00:00+08:00', now)).toEqual({ expired: false, days: 1 })
    expect(getExpiryCountdown('2026-07-26T13:00:00+08:00', now)).toEqual({ expired: true, days: 1 })
    expect(getExpiryCountdown('invalid-time', now)).toBeNull()
  })

  it('按凭据规则显示天数或小时分钟', () => {
    const now = new Date('2026-07-27T12:00:00+08:00')

    expect(getExpiryRemaining('2026-07-29T12:00:00+08:00', now)).toEqual({ kind: 'days', days: 2 })
    expect(getExpiryRemaining('2026-07-28T11:30:00+08:00', now)).toEqual({ kind: 'hoursMinutes', hours: 23, minutes: 30 })
    expect(getExpiryRemaining(undefined, now)).toEqual({ kind: 'longTerm' })
    expect(getExpiryRemaining('2026-07-27T11:59:00+08:00', now)).toEqual({ kind: 'expired' })
  })
})
