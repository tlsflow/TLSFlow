import { describe, expect, it } from 'vitest'
import { buildBusinessPageRows } from '@/composables/useBusinessPage'
import type { BusinessPageConfig } from '@/views/business-page.types'

const config = {
  moduleName: 'devices',
  defaultStatus: 'UNKNOWN',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: '名称', candidates: ['displayName'] },
    { key: 'status', title: '健康状态', candidates: ['health', 'sourceStatus'], kind: 'status' },
    { key: 'version', title: '版本', candidates: ['softwareVersion'] },
  ],
} as unknown as BusinessPageConfig

describe('设备统一字段展示', () => {
  it('健康状态读取 health 而不是被 status 默认值覆盖', () => {
    const rows = buildBusinessPageRows({
      items: [{
        id: 'agent-1',
        displayName: 'Windows Agent',
        health: 'HEALTHY',
        sourceStatus: 'ONLINE',
        softwareVersion: 'Windows Server 2022 21H2',
      }],
      page: 1,
      pageSize: 20,
      total: 1,
    }, config)

    expect(rows[0]?.status).toBe('HEALTHY')
    expect(rows[0]?.version).toBe('Windows Server 2022 21H2')
  })
})
