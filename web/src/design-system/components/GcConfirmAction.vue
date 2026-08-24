<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

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
const { t } = useI18n()
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
        <h2>{{ t('designSystem.confirm.title', { action: actionName }) }}</h2>
        <p>{{ t('designSystem.confirm.impactCount', { count: impactCount ?? 0 }) }}</p>
        <p class="gc-confirm__risk" :class="{ 'gc-confirm__risk--danger': danger }">
          {{ riskText ?? t('designSystem.confirm.defaultRisk') }}
        </p>
        <label v-if="confirmText" class="gc-form-field">
          <span>{{ t('designSystem.confirm.typeToConfirm', { text: confirmText }) }}</span>
          <input v-model="typed" />
        </label>
        <footer>
          <button class="gc-button" type="button" @click="opened = false">{{ t('designSystem.confirm.cancel') }}</button>
          <button class="gc-button" :class="{ 'gc-button--danger': danger }" type="button" @click="confirm">{{ t('designSystem.confirm.confirm') }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.gc-confirm__mask { position: fixed; inset: 0; display: grid; place-items: center; padding: 16px; background: var(--gc-color-backdrop); z-index: 60; }
.gc-confirm { width: min(480px, calc(100vw - 32px)); max-width: 100%; }
.gc-confirm__risk { white-space: normal; overflow-wrap: anywhere; word-break: break-word; line-height: 1.6; color: var(--gc-color-text-muted); }
.gc-confirm__risk--danger { color: var(--gc-color-danger); }
footer { display: flex; justify-content: flex-end; gap: var(--gc-space-2); margin-top: var(--gc-space-4); }
</style>
