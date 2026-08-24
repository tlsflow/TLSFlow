import type { Directive } from 'vue'
import { usePermissionStore } from '@/stores/permission.store'

export const permissionDirective: Directive<HTMLElement, string | string[]> = {
  mounted(el, binding) {
    const permissionStore = usePermissionStore()
    const required = Array.isArray(binding.value) ? binding.value : [binding.value]
    const allowed = required.every((permission) => permissionStore.hasPermission(permission))
    if (!allowed) {
      el.setAttribute('aria-disabled', 'true')
      el.style.display = 'none'
    }
  }
}
