import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './app.vue'
import { router } from './router'
import { permissionDirective } from './directives/permission.directive'
import './design-system/tokens/index.css'
import './design-system/patterns/layout.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.directive('permission', permissionDirective)
app.mount('#app')
