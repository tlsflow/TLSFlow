import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const targetDir = resolve(root, '../src/api/generated')
await mkdir(targetDir, { recursive: true })
await writeFile(resolve(targetDir, 'schemas.ts'), `// 中文说明：003 OpenAPI 未冻结前使用占位类型，真实生成物不得手写覆盖。\nexport interface GeneratedPlaceholder {\n  readonly generatedAt: string\n}\n`)
await writeFile(resolve(targetDir, 'paths.ts'), `// 中文说明：003 OpenAPI 未冻结前使用占位路径类型。\nexport interface ApiPathsPlaceholder {\n  readonly path: string\n}\n`)
await writeFile(resolve(targetDir, 'client-types.ts'), `// 中文说明：003 OpenAPI 未冻结前使用占位客户端类型。\nexport interface ApiClientTypesPlaceholder {\n  readonly requestId: string\n}\n`)
