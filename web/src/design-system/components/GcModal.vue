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
  /** 自定义模态框最大高度，例如 '60vh'。 */
  maxHeight?: string
  /** 只保留遮罩和内容插槽，不渲染默认卡片标题、内边距和 footer。 */
  frameless?: boolean
  /** 自定义过渡动画名称；默认保持原有 gc-modal 动画。 */
  transitionName?: string
  /** 收起动画的目标元素选择器，用于把模态框动态收进入口按钮。 */
  collapseTargetSelector?: string
}>(), {
  size: 'md',
  closeOnBackdrop: false,
  frameless: false,
  transitionName: 'gc-modal',
  collapseTargetSelector: '',
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
const modalStyle = computed(() => ({
  ...(props.width ? { '--gc-modal-width': props.width } : {}),
  ...(props.maxHeight ? { '--gc-modal-max-height': props.maxHeight } : {}),
}))

function closeModal() {
  isOpen.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  closeModal()
}

function prepareLeave(element: Element) {
  if (props.transitionName !== 'gc-modal-task-icon' || !props.collapseTargetSelector) return
  const modalElement = element.querySelector('.gc-modal') as HTMLElement | null
  const targetElement = document.querySelector(props.collapseTargetSelector) as HTMLElement | null
  if (!modalElement || !targetElement) return
  const modalRect = modalElement.getBoundingClientRect()
  const targetRect = targetElement.getBoundingClientRect()
  const modalCenterX = modalRect.left + modalRect.width / 2
  const modalCenterY = modalRect.top + modalRect.height / 2
  const targetCenterX = targetRect.left + targetRect.width / 2
  const targetCenterY = targetRect.top + targetRect.height / 2
  modalElement.style.setProperty('--gc-modal-collapse-x', `${targetCenterX - modalCenterX}px`)
  modalElement.style.setProperty('--gc-modal-collapse-y', `${targetCenterY - modalCenterY}px`)
}

function cleanupLeave(element: Element) {
  const modalElement = element.querySelector('.gc-modal') as HTMLElement | null
  modalElement?.style.removeProperty('--gc-modal-collapse-x')
  modalElement?.style.removeProperty('--gc-modal-collapse-y')
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
    <Transition :name="transitionName" @before-leave="prepareLeave" @after-leave="cleanupLeave">
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
            <div class="gc-modal__header-actions">
              <slot name="header-actions" />
              <button class="gc-button gc-modal__close" type="button" :aria-label="t('designSystem.modal.closeAria')" @click="closeModal">
                ×
              </button>
            </div>
          </header>

          <div class="gc-modal__body">
            <slot />
          </div>

          <footer v-if="!frameless && $slots.actions" class="gc-modal__actions">
            <slot name="actions" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.gc-modal__mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: var(--gc-space-3);
  background: var(--gc-color-backdrop);
  backdrop-filter: blur(var(--gc-space-3)) saturate(125%);
}

.gc-modal {
  width: min(var(--gc-modal-width), calc(100vw - var(--gc-space-6)));
  max-height: var(--gc-modal-max-height, calc(100vh - var(--gc-space-6)));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--gc-space-3);
  overflow: hidden;
  border-radius: var(--gc-radius-xl);
  padding: var(--gc-space-4);
  border-color: var(--gc-color-surface-field);
  box-shadow: var(--gc-shadow-overlay);
}

.gc-modal--sm { --gc-modal-width: 26.25rem; }
.gc-modal--md { --gc-modal-width: 35rem; }
.gc-modal--lg { --gc-modal-width: 45rem; }
.gc-modal--xl { --gc-modal-width: 53.75rem; }
.gc-modal--xxl { --gc-modal-width: 70rem; }

.gc-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding-bottom: var(--gc-space-3);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.gc-modal__header h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xl);
  line-height: 1.1;
  letter-spacing: 0;
}

.gc-modal__header p {
  margin: var(--gc-space-1) 0 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: 1.55;
}

.gc-modal__close {
  min-width: var(--gc-space-8);
  width: var(--gc-space-8);
  height: var(--gc-space-8);
  padding: 0;
  border-radius: var(--gc-radius-md);
  font-size: var(--gc-font-size-lg);
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
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

.gc-modal-enter-active,
.gc-modal-leave-active,
.gc-modal-task-icon-enter-active,
.gc-modal-task-icon-leave-active {
  transition: opacity 180ms ease;
}

.gc-modal-enter-active .gc-modal,
.gc-modal-leave-active .gc-modal,
.gc-modal-task-icon-enter-active .gc-modal,
.gc-modal-task-icon-leave-active .gc-modal {
  transition: opacity 180ms ease, transform 180ms ease;
}

.gc-modal-enter-from,
.gc-modal-leave-to,
.gc-modal-task-icon-enter-from,
.gc-modal-task-icon-leave-to {
  opacity: 0;
}

.gc-modal-enter-from .gc-modal,
.gc-modal-leave-to .gc-modal,
.gc-modal-task-icon-enter-from .gc-modal {
  opacity: 0;
  transform: translateY(var(--gc-space-3)) scale(0.98);
}

.gc-modal-task-icon-leave-active {
  transition-duration: 260ms;
}

.gc-modal-task-icon-leave-active .gc-modal {
  transform-origin: center;
  transition-duration: 260ms;
  transition-timing-function: cubic-bezier(.2, .8, .2, 1);
}

.gc-modal-task-icon-leave-to .gc-modal {
  opacity: 0;
  transform: translate3d(var(--gc-modal-collapse-x, 42vw), var(--gc-modal-collapse-y, -42vh), 0) scale(0.08);
}

.gc-modal__header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--gc-space-2);
  margin-left: auto;
}

.gc-modal--frameless {
  padding: 0;
  gap: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  overflow: hidden;
}

.gc-modal--frameless .gc-modal__body {
  overflow: auto;
}

@media (max-width: 40rem) {
  .gc-modal {
    padding: var(--gc-space-3);
    border-radius: var(--gc-radius-lg);
  }

  .gc-modal__header h2 {
    font-size: var(--gc-font-size-lg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .gc-modal-enter-active,
  .gc-modal-leave-active,
  .gc-modal-enter-active .gc-modal,
  .gc-modal-leave-active .gc-modal,
  .gc-modal-task-icon-enter-active,
  .gc-modal-task-icon-leave-active,
  .gc-modal-task-icon-enter-active .gc-modal,
  .gc-modal-task-icon-leave-active .gc-modal {
    transition: none;
  }
}
</style>
