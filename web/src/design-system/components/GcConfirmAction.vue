<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  actionName: string
  impactCount?: number
  riskText?: string
  confirmText?: string
}>()
const emit = defineEmits<{ confirm: [] }>()
const opened = ref(false)
const typed = ref('')

function confirm() {
  if (props.confirmText && typed.value !== props.confirmText) return
  opened.value = false
  emit('confirm')
}
</script>

<template>
  <button class="gc-button gc-button--danger" type="button" @click="opened = true">
    {{ actionName }}
  </button>
  <Teleport to="body">
    <div v-if="opened" class="gc-confirm__mask" role="dialog" aria-modal="true">
      <section class="gc-card gc-confirm">
        <h2>确认{{ actionName }}</h2>
        <p>影响资源数量：{{ impactCount ?? 0 }}</p>
        <p class="gc-confirm__risk">{{ riskText ?? '该操作可能触发部署、重启、回滚或不可逆变更。' }}</p>
        <label v-if="confirmText" class="gc-form-field">
          <span>输入 {{ confirmText }} 二次确认</span>
          <input v-model="typed" />
        </label>
        <footer>
          <button class="gc-button" type="button" @click="opened = false">取消</button>
          <button class="gc-button gc-button--danger" type="button" @click="confirm">确认</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.gc-confirm__mask { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; background: rgb(15 23 42 / 45%); z-index: 60; }
.gc-confirm { width: min(480px, calc(100vw - 32px)); max-width: 100%; }
.gc-confirm__risk { color: var(--gc-color-danger); white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.6; }
footer { display: flex; justify-content: flex-end; gap: var(--gc-space-2); margin-top: var(--gc-space-4); }
</style>
