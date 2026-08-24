<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl'

const props = withDefaults(defineProps<{
  /** 兼容 v-model:open 的受控开关。 */
  open?: boolean
  /** 兼容默认 v-model / modelValue 的受控开关。 */
  modelValue?: boolean
  /** 模态框标题。 */
  title?: string
  /** 标题下方的补充说明。 */
  description?: string
  /** 模态框宽度档位。 */
  size?: ModalSize
  /** 兼容旧调用参数；遮罩点击不再关闭模态框。 */
  closeOnBackdrop?: boolean
  /** 自定义模态框宽度，优先级高于 size（例如 '60vw'、'800px'）。 */
  width?: string
  /** 只保留遮罩和内容插槽，不渲染默认卡片标题、内边距和 footer。 */
  frameless?: boolean
}>(), {
  size: 'md',
  closeOnBackdrop: false,
  frameless: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:modelValue': [value: boolean]
}>()
const { t } = useI18n()

const isOpen = computed({
  get() {
    return props.open ?? props.modelValue ?? false
  },
  set(value: boolean) {
    emit('update:open', value)
    emit('update:modelValue', value)
  },
})

const modalClass = computed(() => [
  'gc-modal',
  `gc-modal--${props.size}`,
  props.frameless ? '' : 'gc-card',
  props.frameless ? 'gc-modal--frameless' : '',
].filter(Boolean).join(' '))
const modalStyle = computed(() => (props.width ? { '--gc-modal-width': props.width } : undefined))

function closeModal() {
  isOpen.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  closeModal()
}

// 只在打开时监听 ESC，关闭后立即释放，避免全局事件泄漏。
watch(isOpen, (opened) => {
  if (opened) {
    window.addEventListener('keydown', handleKeydown)
    return
  }

  window.removeEventListener('keydown', handleKeydown)
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="gc-modal__mask"
      role="presentation"
    >
      <section
        :class="modalClass"
        :style="modalStyle"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        @click.stop
      >
        <header v-if="!frameless && (title || description)" class="gc-modal__header">
          <div>
            <h2 v-if="title">{{ title }}</h2>
            <p v-if="description">{{ description }}</p>
          </div>
          <button class="gc-button gc-modal__close" type="button" :aria-label="t('designSystem.modal.closeAria')" @click="closeModal">
            ×
          </button>
        </header>

        <div class="gc-modal__body">
          <slot />
        </div>

        <footer v-if="!frameless && $slots.actions" class="gc-modal__actions">
          <slot name="actions" />
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.gc-modal__mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: clamp(10px, 2vw, 20px);
  background: var(--gc-color-backdrop);
  backdrop-filter: blur(14px) saturate(125%);
}

.gc-modal {
  width: min(var(--gc-modal-width), calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--gc-space-3);
  overflow: hidden;
  border-radius: 22px;
  padding: 16px;
  border-color: var(--gc-color-surface-field);
  box-shadow: 0 24px 80px var(--gc-color-border-strong);
}

.gc-modal--sm { --gc-modal-width: 420px; }
.gc-modal--md { --gc-modal-width: 560px; }
.gc-modal--lg { --gc-modal-width: 720px; }
.gc-modal--xl { --gc-modal-width: 860px; }
.gc-modal--xxl { --gc-modal-width: 1120px; }

.gc-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--gc-color-border);
}

.gc-modal__header h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 28px;
  line-height: 1.1;
  letter-spacing: -0.03em;
}

.gc-modal__header p {
  margin: 6px 0 0;
  color: var(--gc-color-text-muted);
  font-size: 14px;
  line-height: 1.55;
}

.gc-modal__close {
  min-width: 32px;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 10px;
  font-size: 18px;
  line-height: 1;
}

.gc-modal__body {
  min-height: 0;
  overflow: auto;
}

.gc-modal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--gc-space-2);
  padding-top: 10px;
  border-top: 1px solid var(--gc-color-border);
}

.gc-modal--frameless {
  padding: 0;
  gap: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}

.gc-modal--frameless .gc-modal__body {
  overflow: visible;
}

@media (max-width: 640px) {
  .gc-modal {
    padding: 12px;
    border-radius: 18px;
  }

  .gc-modal__header h2 {
    font-size: 22px;
  }
}
</style>
