<script setup lang="ts">
const model = defineModel<string>({ default: '' })
defineProps<{ label?: string; placeholder?: string }>()
</script>

<template>
  <label class="gc-secret-input">
    <span>{{ label ?? 'Secret 引用' }}</span>
    <input v-model="model" :placeholder="placeholder ?? '选择或输入 SecretRef，不保存明文'" autocomplete="off" />
    <small>敏感字段只保存引用，不在浏览器长期明文保存。</small>
  </label>
</template>

<style scoped>
.gc-secret-input { display: flex; flex-direction: column; gap: var(--gc-space-2); }
.gc-secret-input input { border: 1px solid var(--gc-color-border); border-radius: var(--gc-radius-sm); padding: 8px 10px; }
.gc-secret-input small { color: var(--gc-color-text-muted); }
</style>
