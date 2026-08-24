/**
 * 将 Host 的标准操作系统类型映射为插件兼容性合同使用的 Canonical 产品族标识。
 * 展示名称不属于运行期匹配输入，未知类型必须保持未定义，禁止猜测或生成 Alias。
 */
const CANONICAL_PRODUCT_FAMILY_BY_OS_TYPE: Readonly<Record<string, string>> = Object.freeze({
  WINDOWS: 'WINDOWS_SERVER',
  LINUX: 'LINUX_SERVER',
});

export function canonicalProductFamilyForOsType(osType: string | undefined): string | undefined {
  const normalized = osType?.trim().toUpperCase();
  return normalized ? CANONICAL_PRODUCT_FAMILY_BY_OS_TYPE[normalized] : undefined;
}
