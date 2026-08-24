<script setup lang="ts">
import { computed } from 'vue'
import { usePermissionStore } from '@/stores/permission.store'

const props = withDefaults(defineProps<{ permission: string; danger?: boolean }>(), { danger: false })
const permissionStore = usePermissionStore()
const allowed = computed(() => permissionStore.hasPermission(props.permission))
</script>

<template>
  <button v-if="allowed" class="gc-button" :class="{ 'gc-button--danger': danger }" type="button">
    <slot />
  </button>
</template>
