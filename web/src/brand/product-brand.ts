export type ProductEdition = 'public' | 'enterprise'

export interface ProductBrand {
  readonly edition: ProductEdition
  readonly name: string
  readonly slug: string
  readonly markAssetUrl: string
}

const markAssetUrl = `${import.meta.env.BASE_URL}brand/tlsflow-mark.svg`

const PRODUCT_BRANDS: Record<ProductEdition, ProductBrand> = {
  public: {
    edition: 'public',
    name: 'TLSFlow',
    slug: 'tlsflow',
    markAssetUrl,
  },
  enterprise: {
    edition: 'enterprise',
    name: 'GCAC',
    slug: 'gcac',
    markAssetUrl,
  },
}

/** 构建期版本决定用户可见品牌，既有 GCAC 协议和浏览器存储键保持不变。 */
export function resolveProductBrand(edition: unknown): ProductBrand {
  return edition === 'enterprise' ? PRODUCT_BRANDS.enterprise : PRODUCT_BRANDS.public
}

export const productBrand = resolveProductBrand(__PRODUCT_EDITION__)

/**
 * 语言包保留 GCAC 作为品牌占位文本，在装载时统一替换，避免多语言品牌文案漂移。
 */
export function applyProductBranding<T>(value: T, brand: ProductBrand = productBrand): T {
  if (typeof value === 'string') {
    const protectedTokens: string[] = []
    const protectedValue = value.replace(/\bGCAC_[A-Z0-9_]+\b|(^|[^A-Za-z0-9_])(gcac\.[A-Za-z0-9_.-]+)/g, (match, prefix = '', protocol = '') => {
      const token = protocol || match
      const placeholder = `__TLSFLOW_INTERNAL_${protectedTokens.length}__`
      protectedTokens.push(token)
      return protocol ? `${prefix}${placeholder}` : placeholder
    })
    const brandedValue = protectedValue
      .replaceAll('GCAC', brand.name)
      .replaceAll('gcac', brand.slug)
    return protectedTokens.reduce((result, token, index) => result.replaceAll(`__TLSFLOW_INTERNAL_${index}__`, token), brandedValue) as T
  }

  if (Array.isArray(value)) return value.map((item) => applyProductBranding(item, brand)) as T
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, applyProductBranding(item, brand)])
  ) as T
}
