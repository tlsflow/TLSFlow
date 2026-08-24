import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const gcacVersion = readFileSync(fileURLToPath(new URL('../version', import.meta.url)), 'utf8').trim()

export default defineConfig({
  plugins: [vue()],
  define: {
    __GCAC_VERSION__: JSON.stringify(gcacVersion)
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
})
