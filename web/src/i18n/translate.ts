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

  // 中文说明：优先保留后端枚举的原始大小写；任务状态等资源使用大写键，不能先转小写后再查找。
  const exactKey = `${namespace}.${rawValue}${keySuffix}`
  if (te(exactKey)) return t(exactKey)

  const token = rawValue.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const normalizedKeys = token
    ? [`${namespace}.${token}${keySuffix}`, `${namespace}.${token.toUpperCase()}${keySuffix}`]
    : []
  for (const key of normalizedKeys) {
    if (te(key)) return t(key)
  }
  return te(unknownKey) ? t(unknownKey, { value: rawValue }) : rawValue
}
