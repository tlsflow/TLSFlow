import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/assets/AssetsView.vue'), 'utf8')

describe('统一资产列表查询契约', () => {
  it('只通过服务端统一入口完成分页、筛选和排序', () => {
    expect(source).toContain("sort: 'displayName:asc'")
    expect(source).toContain('listAssets({ page: query.page')
    expect(source).not.toContain('listManagedDevices')
    expect(source).not.toContain('listCloudServiceAssets')
  })
})
