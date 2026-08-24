/**
 * 临时脚本：从 messages.ts 提取并展开各语言完整翻译，写入独立文件。
 * 用法：cd web && npx tsx src/i18n/extract-locales.ts
 *
 * 注意：messages.ts 中的 zhTW/enUS 等是运行时通过 spread 展开的完整对象，
 * 不需要再 deepMerge。
 */
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zhCN, zhTW, enUS, jaJP, frFR, ruRU, ptBR, koKR } from './messages'

const __dirname = dirname(fileURLToPath(import.meta.url))

function serialize(obj: any, indent = 0): string {
  const pad = '  '.repeat(indent)
  const padNext = '  '.repeat(indent + 1)

  if (obj === null) return 'null'
  if (typeof obj === 'string') {
    const escaped = obj
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      .replace(/'/g, "\\'")
    return `'${escaped}'`
  }
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj)
  if (typeof obj === 'undefined') return 'undefined'
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]'
    const items = obj.map(v => `${padNext}${serialize(v, indent + 1)}`).join(',\n')
    return `[\n${items}\n${pad}]`
  }

  const keys = Object.keys(obj)
  if (keys.length === 0) return '{}'

  const items = keys.map(key => {
    const value = serialize(obj[key], indent + 1)
    const needsQuotes = !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)
    const keyStr = needsQuotes ? `'${key}'` : key
    return `${padNext}${keyStr}: ${value}`
  }).join(',\n')

  return `{\n${items}\n${pad}}`
}

function writeLocaleFile(locale: string, obj: any): void {
  const filePath = resolve(__dirname, `${locale}.ts`)
  const content = `// Auto-generated from messages.ts — do not edit manually.\n// Edit messages.ts and re-run: npx tsx src/i18n/extract-locales.ts\nexport default ${serialize(obj)} as const\n`
  writeFileSync(filePath, content, 'utf-8')
  console.log(`  ✓ ${locale}.ts — ${JSON.stringify(content).length.toLocaleString()} bytes`)
}

// Check that objects are populated
console.log(`zhCN keys: ${Object.keys(zhCN).length}`)
console.log(`zhTW keys: ${Object.keys(zhTW).length}`)
console.log(`enUS keys: ${Object.keys(enUS).length}`)

writeLocaleFile('zh-CN', zhCN)
writeLocaleFile('zh-TW', zhTW)
writeLocaleFile('en-US', enUS)

// The other locales also spread from enUS
console.log(`ja-JP keys: ${Object.keys(jaJP).length}`)
console.log(`fr-FR keys: ${Object.keys(frFR).length}`)
console.log(`ru-RU keys: ${Object.keys(ruRU).length}`)
console.log(`pt-BR keys: ${Object.keys(ptBR).length}`)
console.log(`ko-KR keys: ${Object.keys(koKR).length}`)

writeLocaleFile('ja-JP', jaJP)
writeLocaleFile('fr-FR', frFR)
writeLocaleFile('ru-RU', ruRU)
writeLocaleFile('pt-BR', ptBR)
writeLocaleFile('ko-KR', koKR)

console.log('\nDone. All 8 locale files generated.')
