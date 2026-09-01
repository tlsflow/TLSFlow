import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/assets/AssetsView.vue'), 'utf8')
const businessPageSource = readFileSync(resolve(process.cwd(), 'src/views/BusinessResourcePage.vue'), 'utf8')
const zhLocaleSource = readFileSync(resolve(process.cwd(), 'src/i18n/zh-CN.ts'), 'utf8')

describe('统一资产列表操作区契约', () => {
  it('操作按钮组保持单行并按内容宽度布局', () => {
    expect(source).toContain('flex-wrap: nowrap;')
    expect(source).toContain('min-width: max-content;')
    expect(source).toContain('white-space: nowrap;')
    expect(source).toContain('overflow-wrap: normal;')
  })

  it('将编辑、删除和条件升级收纳到操作菜单，详情保持独立', () => {
    expect(zhLocaleSource).toContain("title: '资产中心'")
    expect(source).toContain("label: t('assets.inventory.actions.detail')")
    expect(source).toContain("label: t('assets.inventory.actions.operation')")
    expect(source).toContain('menu: [{')
    expect(source).toContain("label: t('assets.inventory.actions.edit')")
    expect(source).toContain("label: t('assets.inventory.actions.delete')")
    expect(source).toContain("label: t('assets.inventory.actions.upgrade')")
    expect(source).toContain('upgradeAvailable !== true')
  })

  it('资产列表只调用统一入口并按服务端动作显示按钮', () => {
    expect(source).toContain('listAssets({ page: query.page')
    expect(source).not.toContain('listManagedDevices')
    expect(source).not.toContain('listCloudServiceAssets')
    expect(source).toContain("permissions: ['host.read', 'service_asset.read']")
    expect(source).toContain('availableActions')
    expect(source).toContain('getServiceAssetDetail(row.id)')
    expect(source).toContain('updateServiceAsset(cloudEditId.value')
    expect(source).toContain('await deleteServiceAsset(row.id)')
  })

  it('菜单触发器具备可访问性并复用删除确认', () => {
    expect(businessPageSource).toContain('aria-haspopup="menu"')
    expect(businessPageSource).toContain(':aria-expanded="isRowMenuOpen(row, index)"')
    expect(businessPageSource).toContain('role="menu"')
    expect(businessPageSource).toContain('role="menuitem"')
    expect(businessPageSource).toContain('<GcConfirmAction')
  })

  it('菜单项使用紧凑高度并保留上下与项目间距', () => {
    expect(businessPageSource).toContain('gap: var(--gc-space-1);')
    expect(businessPageSource).toContain('padding: var(--gc-space-2) var(--gc-space-1);')
    expect(businessPageSource).toContain('min-height: var(--gc-control-height-xs);')
  })
})
