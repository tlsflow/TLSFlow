import { describe, expect, it } from 'vitest'
import { applyProductBranding, productBrand, resolveProductBrand } from '@/brand/product-brand'
import { i18n } from '@/i18n'

describe('产品品牌', () => {
  it('公开版将用户可见的 GCAC 品牌替换为 TLSFlow', () => {
    const branded = applyProductBranding({
      name: 'GCAC',
      examples: ['GCAC built-in service', 'gcac-cert'],
      sources: { gcac_native: 'GCAC native' }
    }, resolveProductBrand('public'))

    expect(branded).toEqual({
      name: 'TLSFlow',
      examples: ['TLSFlow built-in service', 'tlsflow-cert'],
      sources: { gcac_native: 'TLSFlow native' }
    })
    expect(i18n.global.t('app.brand')).toBe(productBrand.name)
  })

  it('当前构建版本将外部组示例替换为对应品牌', () => {
    expect(i18n.global.t('settings.groupRoleMappings.fields.externalGroupPlaceholder'))
      .toBe(`CN=${productBrand.name}-Ops,OU=Groups,DC=example,DC=com`)
  })

  it('企业定制版保留 GCAC 名称', () => {
    const branded = applyProductBranding({ name: 'GCAC', example: 'gcac-cert' }, resolveProductBrand('enterprise'))

    expect(branded).toEqual({ name: 'GCAC', example: 'gcac-cert' })
  })
})
