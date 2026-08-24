import { describe, expect, it } from 'vitest'
import { frameworkIdForDetailTab, includeForDetailTab, mergeDetailResources, resolveAvailableDetailTab } from '@/views/devices/details/device-detail-resources'

describe('设备详情按需资源加载', () => {
  it('框架由概览首包返回，框架标签只按需读取所属站点', () => {
    expect(frameworkIdForDetailTab('framework:framework_iis')).toBe('framework_iis')
    expect(includeForDetailTab('framework:framework_iis')).toEqual(['sites'])
    expect(includeForDetailTab('sites')).toEqual(['sites'])
    expect(includeForDetailTab('certificates')).toEqual(['certificates', 'sites'])
    expect(includeForDetailTab('logs')).toEqual(['logs'])
  })

  it('占位站点标签和分组站点标签都会请求站点资源', () => {
    expect(includeForDetailTab('sites')).toEqual(['sites'])
    expect(includeForDetailTab('sites:web.iis')).toEqual(['sites'])
  })

  it('局部响应不会覆盖此前已加载的其他资源', () => {
    const merged = mergeDetailResources({
      frameworks: [{ id: 'framework_1' }],
      sites: [{ id: 'site_1' }],
      certificates: [{ id: 'certificate_1' }],
      logs: [{ id: 'log_1' }],
      resourceCounts: { frameworks: 1, sites: 1, certificates: 1, logs: 1 },
    }, {
      frameworks: [],
      sites: [],
      certificates: [{ id: 'certificate_2' }],
      logs: [],
      resourceCounts: { frameworks: 1, sites: 1, certificates: 1, logs: 1 },
    }, ['certificates'])

    expect(merged.frameworks).toEqual([{ id: 'framework_1' }])
    expect(merged.sites).toEqual([{ id: 'site_1' }])
    expect(merged.certificates).toEqual([{ id: 'certificate_2' }])
    expect(merged.logs).toEqual([{ id: 'log_1' }])
  })

  it('站点加载后保留到动态生成的站点分组标签', () => {
    expect(resolveAvailableDetailTab('sites', [{ key: 'overview' }, { key: 'sites:web.iis' }] as never)).toBe('sites:web.iis')
    expect(resolveAvailableDetailTab('sites', [{ key: 'overview' }] as never)).toBe('overview')
  })
})
