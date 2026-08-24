import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

const gcacVersion = readFileSync(fileURLToPath(new URL('../version', import.meta.url)), 'utf8').trim()

function resolveProductEdition(value: string | undefined): 'public' | 'enterprise' {
  if (!value) return 'public'
  if (value === 'public' || value === 'enterprise') return value
  throw new Error('VITE_PRODUCT_EDITION 只允许 public 或 enterprise')
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const productEdition = resolveProductEdition(process.env.VITE_PRODUCT_EDITION ?? environment.VITE_PRODUCT_EDITION)
  const productName = productEdition === 'enterprise' ? 'GCAC' : 'TlsFlow'

  return {
    plugins: [
      vue(),
      {
        name: 'product-brand-html',
        transformIndexHtml: (html) => html.replaceAll('__PRODUCT_BRAND__', productName),
      }
    ],
    define: {
      __GCAC_VERSION__: JSON.stringify(gcacVersion),
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
        '/tls-inspector': {
          target: 'http://127.0.0.1:8788',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/tls-inspector/, '')
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
