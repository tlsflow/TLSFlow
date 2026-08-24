import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(scriptDir, '..')
const repoRoot = resolve(webRoot, '..')
const openApiPath = resolve(repoRoot, 'backend/openapi/openapi.json')
const targetDir = resolve(webRoot, 'src/api/generated')

const document = JSON.parse(await readFile(openApiPath, 'utf8'))
await mkdir(targetDir, { recursive: true })

const header = [
  '// 中文说明：此文件由 web/scripts/generate-openapi-types.mjs 从 backend/openapi/openapi.json 生成。',
  '// 不要手写修改；需要变更契约时先更新后端 OpenAPI。',
  '',
].join('\n')

const schemas = document.components?.schemas ?? {}
const paths = document.paths ?? {}
const operations = []

for (const [path, methods] of Object.entries(paths)) {
  for (const [method, operation] of Object.entries(methods)) {
    if (!operation || typeof operation !== 'object') continue
    operations.push({
      path,
      method: method.toUpperCase(),
      operationId: operation.operationId ?? `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    })
  }
}

function schemaToTs(schema) {
  if (!schema || typeof schema !== 'object') return 'unknown'
  if (schema.$ref) return typeNameFromSchemaName(schema.$ref.split('/').pop() ?? '')
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const variants = schema.oneOf ?? schema.anyOf
    return variants.map(schemaToTs).join(' | ') || 'unknown'
  }
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => JSON.stringify(value)).join(' | ')
  if (schema.type === 'string') return 'string'
  if (schema.type === 'number' || schema.type === 'integer') return 'number'
  if (schema.type === 'boolean') return 'boolean'
  if (schema.type === 'array') return `ReadonlyArray<${schemaToTs(schema.items)}>`
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    const properties = schema.properties ?? {}
    const required = new Set(schema.required ?? [])
    const lines = Object.entries(properties).map(([name, property]) => {
      const optional = required.has(name) ? '' : '?'
      return `  readonly ${JSON.stringify(name)}${optional}: ${schemaToTs(property)}`
    })
    if (lines.length === 0) {
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        return `Record<string, ${schemaToTs(schema.additionalProperties)}>`
      }
      return 'Record<string, unknown>'
    }
    return `{\n${lines.join('\n')}\n}`
  }
  return 'unknown'
}

function typeNameFromSchemaName(name) {
  return name.replace(/[^a-zA-Z0-9_$]/g, '')
}

function responseSchema(operation) {
  const response = Object.entries(operation?.responses ?? {})
    .find(([status]) => status.startsWith('2'))?.[1]
  return response?.content?.['application/json']?.schema
}

function responseItemSchema(operation) {
  return responseSchema(operation)?.properties?.items?.items
}

// 中文说明：当前后端 OpenAPI 对插件接口使用内联响应模式，无法只从 components.schemas 取到这些类型。
// 这里按接口契约提取列表项，保证前端生成类型仍然来自 backend/openapi/openapi.json。
const inlineSchemas = {
  PluginCatalogItem: responseItemSchema(paths['/api/v1/plugin-catalog']?.get),
  PluginVersionRecord: responseItemSchema(paths['/api/v1/plugin-versions']?.get),
  PluginRuntimeMetric: responseItemSchema(paths['/api/v1/plugin-runtime/metrics']?.get),
}
const generatedSchemas = {
  ...schemas,
  ...Object.fromEntries(Object.entries(inlineSchemas).filter(([, schema]) => schema)),
}

const schemaSource = [
  header,
  ...Object.entries(generatedSchemas).map(([name, schema]) => `export type ${typeNameFromSchemaName(name)} = ${schemaToTs(schema)}\n`),
].join('\n')

const pathUnion = operations.length > 0
  ? operations.map((operation) => JSON.stringify(operation.path)).join(' | ')
  : 'never'
const operationUnion = operations.length > 0
  ? operations.map((operation) => JSON.stringify(operation.operationId)).join(' | ')
  : 'never'
const operationMap = `export const apiOperations = ${JSON.stringify(operations, null, 2)} as const\n`

const pathsSource = [
  header,
  `export type ApiPath = ${pathUnion}`,
  `export type ApiOperationId = ${operationUnion}`,
  operationMap,
].join('\n\n')

const clientTypesSource = [
  header,
  `export interface ApiResult<T> {
  readonly data?: T
  readonly errorCode?: string
  readonly message?: string
  readonly requestId: string
  readonly timestamp: string
}

export interface PageResult<T> {
  readonly items: readonly T[]
  readonly page: number
  readonly pageSize: number
  readonly total: number
}

export interface ApiContractMetadata {
  readonly title: string
  readonly version: string
  readonly paths: readonly string[]
}

export const apiContractMetadata: ApiContractMetadata = ${JSON.stringify({
    title: document.info?.title ?? 'GCAC API',
    version: document.info?.version ?? 'unknown',
    paths: Object.keys(paths).sort(),
  }, null, 2)} as const
`,
].join('\n')

await writeFile(resolve(targetDir, 'schemas.ts'), schemaSource)
await writeFile(resolve(targetDir, 'paths.ts'), pathsSource)
await writeFile(resolve(targetDir, 'client-types.ts'), clientTypesSource)

console.log(`generated ${operations.length} operations from ${openApiPath}`)
