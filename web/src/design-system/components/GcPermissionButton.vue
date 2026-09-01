<script setup lang="ts">
import { computed } from 'vue'
import { usePermissionStore } from '@/stores/permission.store'

const props = withDefaults(defineProps<{ permission: string; permissions?: readonly string[]; danger?: boolean; disabled?: boolean }>(), { danger: false, disabled: false })
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const permissionStore = usePermissionStore()
const allowed = computed(() => (props.permissions?.length ? props.permissions : [props.permission]).some((permission) => permissionStore.hasPermission(permission)))

function handleClick(event: MouseEvent) {
  // 中文说明：这里只处理权限可见性；业务动作必须由调用方显式绑定。
  emit('click', event)
}
</script>

<template>
  <button v-if="allowed" class="gc-button" :class="{ 'gc-button--danger': danger }" type="button" :disabled="disabled" @click="handleClick">
    <slot />
  </button>
</template>
