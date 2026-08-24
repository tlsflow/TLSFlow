<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  actionName: string
  impactCount?: number
  riskText?: string
  confirmText?: string
  disabled?: boolean
  disabledReason?: string
  danger?: boolean
}>(), {
  danger: true,
})

const emit = defineEmits<{ confirm: [] }>()
const opened = ref(false)
const typed = ref('')

function confirm() {
  if (props.disabled) return
  if (props.confirmText && typed.value !== props.confirmText) return
  opened.value = false
  emit('confirm')
}
</script>

<template>
  <button class="gc-button" :class="{ 'gc-button--danger': danger }" type="button" :disabled="disabled" :title="disabledReason" @click="opened = true">
    {{ actionName }}
  </button>
  <Teleport to="body">
    <div v-if="opened" class="gc-confirm__mask" role="dialog" aria-modal="true">
      <section class="gc-card gc-confirm">
        <h2>确认{{ actionName }}</h2>
        <p>影响资源数量：{{ impactCount ?? 0 }}</p>
        <p class="gc-confirm__risk" :class="{ 'gc-confirm__risk--danger': danger }">
          {{ riskText ?? '该操作可能触发部署、重试、回滚或不可逆变更。' }}
        </p>
        <label v-if="confirmText" class="gc-form-field">
          <span>输入 {{ confirmText }} 二次确认</span>
          <input v-model="typed" />
        </label>
        <footer>
          <button class="gc-button" type="button" @click="opened = false">取消</button>
          <button class="gc-button" :class="{ 'gc-button--danger': danger }" type="button" @click="confirm">确认</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.gc-confirm__mask { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; background: rgb(15 23 42 / 45%); z-index: 60; }
.gc-confirm { width: min(480px, calc(100vw - 32px)); max-width: 100%; }
.gc-confirm__risk { white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.6; color: var(--gc-color-text-muted); }
.gc-confirm__risk--danger { color: var(--gc-color-danger); }
footer { display: flex; justify-content: flex-end; gap: var(--gc-space-2); margin-top: var(--gc-space-4); }
</style>
