/// <reference types="vite/client" />

declare const __PRODUCT_EDITION__: 'public' | 'enterprise'

interface ImportMetaEnv {
  readonly VITE_PRODUCT_EDITION?: 'public' | 'enterprise'
  readonly VITE_DOCS_VERSION?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
