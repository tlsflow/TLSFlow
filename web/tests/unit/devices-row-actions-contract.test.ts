import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/assets/AssetsView.vue'), 'utf8')
const businessPageSource = readFileSync(resolve(process.cwd(), 'src/views/BusinessResourcePage.vue'), 'utf8')
const devicesLocaleSource = readFileSync(resolve(process.cwd(), 'src/i18n/devices.locale.ts'), 'utf8')

describe('设备列表操作区布局契约', () => {
  it('操作按钮组保持单行并按内容宽度布局', () => {
    expect(source).toContain('flex-wrap: nowrap;')
    expect(source).toContain('min-width: max-content;')
    expect(source).toContain('white-space: nowrap;')
    expect(source).toContain('overflow-wrap: normal;')
  })

  it('将编辑、删除和条件升级收纳到操作菜单，详情保持独立', () => {
    expect(devicesLocaleSource).toContain("operation: '操作'")
    expect(source).toContain("label: t('devices.actions.detail')")
    expect(source).toContain("label: t('devices.actions.operation')")
    expect(source).toContain('menu: [{')
    expect(source).toContain("label: t('devices.actions.edit')")
    expect(source).toContain("label: t('devices.actions.delete')")
    expect(source).toContain("label: t('devices.actions.upgrade')")
    expect(source).toContain('upgradeAvailable !== true')
  })

  it('云服务资产复用统一 ServiceAsset 操作，不隐藏详情或操作菜单', () => {
    expect(source).toContain('getServiceAssetDetail(row.id)')
    expect(source).toContain('updateServiceAsset(cloudEditId.value')
    expect(source).toContain('await deleteServiceAsset(row.id)')
    expect(source).toContain("permission: 'service_asset.read'")
    expect(source).toContain("permission: 'service_asset.manage'")
    expect(source).toContain('hidden: (row) => !isCloudServiceRow(row)')
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
