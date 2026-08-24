import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './app.vue'
import { router } from './router'
import { i18n } from './i18n'
import { permissionDirective } from './directives/permission.directive'
import { setApiRequestContextProvider } from './api/client'
import { useAppStore } from './stores/app.store'
import { useAuthStore } from './stores/auth.store'
import { useTenantStore } from './stores/tenant.store'
import './design-system/tokens/index.css'
import './design-system/patterns/layout.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
useAppStore(pinia).initializePreferences()

setApiRequestContextProvider(() => {
  const authStore = useAuthStore(pinia)
  const tenantStore = useTenantStore(pinia)
  return {
    actorId: authStore.user?.id ?? null,
    actorType: 'user',
    tenantId: authStore.user?.tenantId ?? tenantStore.currentTenantId ?? null
  }
})

app.use(i18n)
app.use(router)
app.directive('permission', permissionDirective)

app.mount('#app')
