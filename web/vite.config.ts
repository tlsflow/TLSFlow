import { fileURLToPath, URL } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { loadEnv, type ViteDevServer } from 'vite'
import { defineConfig } from 'vitest/config'

const gcacVersion = readFileSync(fileURLToPath(new URL('../version', import.meta.url)), 'utf8').trim()
const docsDistDirectory = resolve(fileURLToPath(new URL('../docs/Documentation/.vitepress/dist/', import.meta.url)))

function normalizeDocsVersion(value: string) {
  const version = value.replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('VITE_DOCS_VERSION 必须是语义化版本号，例如 1.0.0')
  }
  return `v${version}`
}

function docsDevIndexPlugin() {
  return {
    name: 'docs-dev-index',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request, _response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost')
        const pathname = requestUrl.pathname
        if (!pathname.startsWith('/docs/')) {
          next()
          return
        }

        const encodedRelativePath = pathname.slice('/docs/'.length)
        const relativePath = decodeURIComponent(encodedRelativePath)
        const mappedRelativePath = relativePath === ''
          ? 'index.html'
          : relativePath.endsWith('/')
            ? `${relativePath}index.html`
            : `${relativePath}.html`
        const documentPath = resolve(docsDistDirectory, mappedRelativePath)
        const isInsideDocs = documentPath.startsWith(`${docsDistDirectory}${sep}`)
        if (!isInsideDocs || !existsSync(documentPath)) {
          next()
          return
        }

        const mappedUrlPath = encodedRelativePath === ''
          ? 'index.html'
          : encodedRelativePath.endsWith('/')
            ? `${encodedRelativePath}index.html`
            : `${encodedRelativePath}.html`
        request.url = `/docs/${mappedUrlPath}${requestUrl.search}`
        next()
      })
    }
  }
}

function resolveProductEdition(value: string | undefined): 'public' | 'enterprise' {
  if (!value) return 'public'
  if (value === 'public' || value === 'enterprise') return value
  throw new Error('VITE_PRODUCT_EDITION 只允许 public 或 enterprise')
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const productEdition = resolveProductEdition(process.env.VITE_PRODUCT_EDITION ?? environment.VITE_PRODUCT_EDITION)
  const docsVersionInput = process.env.VITE_DOCS_VERSION?.trim() || environment.VITE_DOCS_VERSION?.trim() || '1.0.0'
  const productName = productEdition === 'enterprise' ? 'GCAC' : 'TLSFlow'
  const docsVersion = normalizeDocsVersion(docsVersionInput)

  return {
    plugins: [
      vue(),
      docsDevIndexPlugin(),
      {
        name: 'product-brand-html',
        transformIndexHtml: (html) => html.replaceAll('__PRODUCT_BRAND__', productName),
      }
    ],
    define: {
      __GCAC_VERSION__: JSON.stringify(gcacVersion),
      __DOCS_VERSION__: JSON.stringify(docsVersion),
      __PRODUCT_EDITION__: JSON.stringify(productEdition),
    },
    server: {
      host: '0.0.0.0',
      port: 5172,
      allowedHosts: ['gcac.jacksonz.cn'],
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3003',
          changeOrigin: true,
          ws: true
        },
        '/agent-install': {
          target: 'http://127.0.0.1:3003',
          changeOrigin: true
        },
        '/agent-releases': {
          target: 'http://127.0.0.1:3003',
          changeOrigin: true
        },
        '/tls-inspector': {
          // 统一经过 Backend，Inspector 不可用时由 Backend 回放持久化快照。
          target: 'http://127.0.0.1:3003',
          changeOrigin: true
        }
      }
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts']
    }
  }
})
