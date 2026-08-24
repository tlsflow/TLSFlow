import { describe, expect, it } from 'vitest'
import { normalizeInternalRedirectPath } from '@/router/redirect'

describe('路由入口跳转', () => {
  it('只允许站内相对路径作为入口跳转目标', () => {
    expect(normalizeInternalRedirectPath('/workflows')).toBe('/workflows')
    expect(normalizeInternalRedirectPath('/workflows?tab=canvas#dsl')).toBe('/workflows?tab=canvas#dsl')
    expect(normalizeInternalRedirectPath(' /workflows ')).toBe('/workflows')
    expect(normalizeInternalRedirectPath('https://example.com/workflows')).toBe('/dashboard')
    expect(normalizeInternalRedirectPath('//example.com/workflows')).toBe('/dashboard')
    expect(normalizeInternalRedirectPath('javascript:alert(1)')).toBe('/dashboard')
    expect(normalizeInternalRedirectPath(undefined)).toBe('/dashboard')
  })
})
