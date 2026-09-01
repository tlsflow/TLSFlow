import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/assets/AssetsView.vue'), 'utf8')

describe('统一资产列表查询契约', () => {
  it('为设备和云服务使用各自接口允许的排序字段', () => {
    expect(source).toContain("sort: 'displayName:asc'")
    expect(source).toContain("sort: 'updatedAt:desc'")
    expect(source).toContain('listManagedDevices({ ...devicesQuery, filters: filters.value })')
    expect(source).toContain('listCloudServiceAssets(cloudAssetsQuery)')
  })
})
