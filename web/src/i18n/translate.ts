import type { ComposerTranslation } from 'vue-i18n'

/**
 * 将后端或插件提供的可扩展枚举转换为本地化文案。
 *
 * 动态 key 在调用前必须先通过 `te` 检查，否则 Vue I18n 会在开发环境输出
 * 缺失 key 警告。未知值保留在统一兜底文案中，既不丢失原始信息，也不污染控制台。
 */
export function translateDynamic(
  t: ComposerTranslation,
  te: (key: string) => boolean,
  namespace: string,
  value: unknown,
  fallbackKey = 'common.notAvailable',
  unknownKey = 'common.unknownValue',
  keySuffix = '',
): string {
  const rawValue = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  if (!rawValue) return t(fallbackKey)

  const token = rawValue.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const key = token ? `${namespace}.${token}${keySuffix}` : ''
  if (key && te(key)) return t(key)
  return te(unknownKey) ? t(unknownKey, { value: rawValue }) : rawValue
}
