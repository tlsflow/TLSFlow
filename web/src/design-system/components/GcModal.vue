<script lang="ts">
let bodyScrollLockCount = 0
let previousBodyOverflow = ''
let previousRootOverflow = ''
let rootHadModalOpenClass = false

function acquireBodyScrollLock() {
  if (typeof document === 'undefined') return
  if (bodyScrollLockCount === 0) {
    previousBodyOverflow = document.body.style.overflow
    previousRootOverflow = document.documentElement.style.overflow
    rootHadModalOpenClass = document.documentElement.classList.contains('gc-modal-open')
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    document.documentElement.classList.add('gc-modal-open')
  }
  bodyScrollLockCount += 1
}

function releaseBodyScrollLock() {
  if (typeof document === 'undefined' || bodyScrollLockCount === 0) return
  bodyScrollLockCount -= 1
  if (bodyScrollLockCount > 0) return
  document.body.style.overflow = previousBodyOverflow
  document.documentElement.style.overflow = previousRootOverflow
  if (!rootHadModalOpenClass) document.documentElement.classList.remove('gc-modal-open')
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useSlots, watch } from 'vue'
import { useI18n } from 'vue-i18n'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl'

let modalInstanceCount = 0

const props = withDefaults(defineProps<{
  /** 兼容 v-model:open 的受控开关。 */
  open?: boolean
  /** 兼容默认 v-model / modelValue 的受控开关。 */
  modelValue?: boolean
  /** 模态框标题。 */
  title?: string
  /** 标题下方的补充说明。 */
  description?: string
  /** 无标题模态框的翻译后区域名称。 */
  ariaLabel?: string
  /** 模态框宽度档位。 */
  size?: ModalSize
  /** 兼容旧调用参数；遮罩点击不再关闭模态框。 */
  closeOnBackdrop?: boolean
  /** 自定义模态框宽度，优先级高于 size（例如 '60vw'、'var(--gc-size-modal-wide)'）。 */
  width?: string
  /** 自定义模态框最大高度，例如 '60vh'。 */
  maxHeight?: string
  /** 追加到实际对话框容器的 CSS class，用于调用方的局部布局覆写。 */
  dialogClass?: string
  /** 只保留遮罩和内容插槽，不渲染默认卡片标题、内边距和 footer。 */
  frameless?: boolean
  /** 缩小遮罩和卡片边距，用于接近全屏的工作区。 */
  edgeToEdge?: boolean
  /** 自定义过渡动画名称；默认保持原有 gc-modal 动画。 */
  transitionName?: string
  /** 收起动画的目标元素选择器，用于把模态框动态收进入口按钮。 */
  collapseTargetSelector?: string
  /** 提交或异步操作进行中；会禁止内容区原生控件和关闭操作。 */
  busy?: boolean
  /** 忙碌期间是否仍允许点击右上角关闭按钮。 */
  closeableWhileBusy?: boolean
  /** 由调用方传入的已翻译错误信息。 */
  error?: string
  /** 是否渲染错误详情插槽。 */
  showErrorDetails?: boolean
}>(), {
  size: 'md',
  closeOnBackdrop: false,
  frameless: false,
  edgeToEdge: false,
  transitionName: 'gc-modal',
  collapseTargetSelector: '',
  busy: false,
  closeableWhileBusy: false,
  error: '',
  showErrorDetails: false,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:modelValue': [value: boolean]
}>()
const { t } = useI18n()
const slots = useSlots()
const modalRef = ref<HTMLElement | null>(null)
const instanceId = ++modalInstanceCount
const titleId = `gc-modal-title-${instanceId}`
const descriptionId = `gc-modal-description-${instanceId}`
const errorId = `gc-modal-error-${instanceId}`
let restoreFocusElement: HTMLElement | null = null
const busyControlStates = new Map<HTMLElement, boolean>()

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
  props.dialogClass ?? '',
  !props.title && !props.description ? 'gc-modal--without-header' : '',
  !slots.actions ? 'gc-modal--without-actions' : '',
  props.frameless ? '' : 'gc-card',
  props.frameless ? 'gc-modal--frameless' : '',
  props.edgeToEdge ? 'gc-modal--edge-to-edge' : '',
].filter(Boolean).join(' '))
const maskClass = computed(() => [
  'gc-modal__mask',
  props.edgeToEdge ? 'gc-modal__mask--edge-to-edge' : '',
].filter(Boolean).join(' '))
const modalStyle = computed(() => ({
  ...(props.width ? { '--gc-modal-width': props.width } : {}),
  ...(props.maxHeight ? { '--gc-modal-max-height': props.maxHeight } : {}),
}))
const labelledBy = computed(() => props.title ? titleId : undefined)
const describedBy = computed(() => [props.description ? descriptionId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined)

function closeModal() {
  if (props.busy && !props.closeableWhileBusy) return
  isOpen.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    handleModalKeydown(event)
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    closeModal()
    return
  }
}

const focusableSelector = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusFirstElement(): void {
  const modal = modalRef.value
  if (!modal) return
  const firstElement = modal.querySelector<HTMLElement>(focusableSelector)
  ;(firstElement ?? modal).focus()
}

function handleModalKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  const modal = modalRef.value
  if (!modal) return
  const focusableElements = [...modal.querySelectorAll<HTMLElement>(focusableSelector)]
  if (focusableElements.length === 0) {
    event.preventDefault()
    modal.focus()
    return
  }
  const firstElement = focusableElements[0]
  const lastElement = focusableElements[focusableElements.length - 1]
  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault()
    lastElement.focus()
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault()
    firstElement.focus()
  }
}

async function updateFocus(opened: boolean): Promise<void> {
  if (opened) {
    const activeElement = document.activeElement
    restoreFocusElement = activeElement instanceof HTMLElement ? activeElement : null
    await nextTick()
    if (isOpen.value) {
      syncBusyControls()
      focusFirstElement()
    }
    return
  }

  await nextTick()
  if (restoreFocusElement?.isConnected) restoreFocusElement.focus()
  restoreFocusElement = null
}

function syncBusyControls(): void {
  const modal = modalRef.value
  if (!modal) return
  const controls = modal.querySelectorAll<HTMLElement>('button, input, select, textarea')
  controls.forEach((control) => {
    if (control.classList.contains('gc-modal__close') && props.closeableWhileBusy) {
      control.removeAttribute('disabled')
      busyControlStates.delete(control)
      return
    }
    if (props.busy) {
      if (!busyControlStates.has(control)) busyControlStates.set(control, control.hasAttribute('disabled'))
      control.setAttribute('disabled', '')
      return
    }
    const wasDisabled = busyControlStates.get(control)
    if (wasDisabled === false) control.removeAttribute('disabled')
    busyControlStates.delete(control)
  })
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

let ownsBodyScrollLock = false

// 只在打开时监听 ESC，关闭后立即释放，避免全局事件泄漏。
watch(isOpen, (opened) => {
  if (opened) {
    window.addEventListener('keydown', handleKeydown)
    if (!ownsBodyScrollLock) {
      acquireBodyScrollLock()
      ownsBodyScrollLock = true
    }
    void updateFocus(true)
    return
  }

  window.removeEventListener('keydown', handleKeydown)
  if (ownsBodyScrollLock) {
    releaseBodyScrollLock()
    ownsBodyScrollLock = false
  }
  void updateFocus(false)
}, { immediate: true })

watch(() => props.busy, () => {
  void nextTick(syncBusyControls)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (ownsBodyScrollLock) releaseBodyScrollLock()
  busyControlStates.clear()
  restoreFocusElement = null
})
</script>

<template>
  <Teleport to="body">
    <Transition :name="transitionName" @before-leave="prepareLeave" @after-leave="cleanupLeave">
      <div
        v-if="isOpen"
        :class="maskClass"
        role="presentation"
      >
        <section
          ref="modalRef"
          :class="modalClass"
          :style="modalStyle"
          role="dialog"
          aria-modal="true"
          :aria-label="title ? undefined : ariaLabel"
          :aria-labelledby="labelledBy"
          :aria-describedby="describedBy"
          :aria-busy="busy || undefined"
          tabindex="-1"
          @click.stop
        >
          <header v-if="!frameless && (title || description)" class="gc-modal__header">
            <div>
              <h2 v-if="title" :id="titleId"><slot name="title">{{ title }}</slot></h2>
              <p v-if="description" :id="descriptionId">{{ description }}</p>
            </div>
            <div class="gc-modal__header-actions">
              <slot name="header-actions" />
              <button class="gc-button gc-modal__close" type="button" :disabled="busy && !closeableWhileBusy" :aria-label="t('designSystem.modal.closeAria')" @click="closeModal">
                <span aria-hidden="true">×</span>
              </button>
            </div>
          </header>

          <fieldset class="gc-modal__content" :disabled="busy" :aria-busy="busy || undefined">
            <div class="gc-modal__body">
              <div v-if="error || showErrorDetails" :id="error ? errorId : undefined" class="gc-modal__error" role="alert">
                <p v-if="error">{{ error }}</p>
                <slot v-if="showErrorDetails" name="error-details" />
              </div>
              <slot />
            </div>
          </fieldset>

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
  z-index: var(--gc-z-modal);
  display: grid;
  place-items: center;
  padding: var(--gc-space-3);
  background: var(--gc-color-backdrop);
  backdrop-filter: blur(var(--gc-space-2));
}

:global(html.gc-modal-open .gc-shell__content) {
  overflow: hidden;
}

.gc-modal__mask--edge-to-edge {
  padding: var(--gc-space-1);
}

.gc-modal {
  width: min(var(--gc-modal-width, var(--gc-size-modal-default)), calc(100vw - var(--gc-space-6)));
  height: fit-content;
  max-height: var(--gc-modal-max-height, calc(100vh - var(--gc-space-6)));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 0;
  overflow: hidden;
  border-radius: var(--gc-radius-modal);
  padding: 0;
  border-color: var(--gc-color-border-subtle);
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-overlay);
}

.gc-modal__content {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  margin: 0;
  border: 0;
  padding: 0;
  overflow: hidden;
}

.gc-modal--sm { --gc-modal-width: var(--gc-size-modal-confirm); }
.gc-modal--md { --gc-modal-width: var(--gc-size-modal-default); }
.gc-modal--lg { --gc-modal-width: var(--gc-size-modal-lg); }
.gc-modal--xl { --gc-modal-width: var(--gc-size-modal-xl); }
.gc-modal--xxl { --gc-modal-width: var(--gc-size-modal-xxl); }

.gc-modal--edge-to-edge {
  padding: var(--gc-space-2);
}

.gc-modal__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding: var(--gc-space-modal-edge-y) var(--gc-space-modal-x) var(--gc-space-modal-y);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
}

.gc-modal__header h2 {
  margin: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
  font-weight: 700;
  line-height: var(--gc-line-height-tight);
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
  border-color: transparent;
  border-radius: var(--gc-radius-full);
  color: var(--gc-color-text-soft);
  background: transparent;
  font-size: var(--gc-font-size-lg);
  line-height: 1;
}

.gc-modal__close:hover:not(:disabled) {
  border-color: var(--gc-color-border-subtle);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-hover);
  box-shadow: none;
}

.gc-modal__body {
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: var(--gc-space-modal-y) var(--gc-space-modal-x);
}

.gc-modal--without-header:not(.gc-modal--frameless) .gc-modal__body {
  padding-top: var(--gc-space-modal-edge-y);
}

.gc-modal--without-actions:not(.gc-modal--frameless) .gc-modal__body {
  padding-bottom: var(--gc-space-modal-edge-y);
}

.gc-modal__error {
  display: grid;
  gap: var(--gc-space-2);
  margin: 0 0 var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-soft);
  padding: var(--gc-space-3);
  font-size: var(--gc-font-size-sm);
}

.gc-modal__error > p {
  margin: 0;
}

.gc-modal__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--gc-space-2);
  padding: var(--gc-space-modal-y) var(--gc-space-modal-x) var(--gc-space-modal-edge-y);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  background: var(--gc-color-surface-muted);
}

.gc-modal-enter-active,
.gc-modal-leave-active,
.gc-modal-task-icon-enter-active,
.gc-modal-task-icon-leave-active {
  transition: opacity 300ms ease;
}

.gc-modal-enter-active .gc-modal,
.gc-modal-leave-active .gc-modal,
.gc-modal-task-icon-enter-active .gc-modal,
.gc-modal-task-icon-leave-active .gc-modal {
  transition: opacity 300ms ease, transform 300ms ease;
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
  transform: scale(0.98);
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

.gc-modal--frameless .gc-modal__content {
  display: block;
}

.gc-modal--frameless .gc-modal__body {
  overflow: auto;
  padding: 0;
}

@media (max-width: 40rem) {
  .gc-modal {
    border-radius: var(--gc-radius-modal);
  }

  .gc-modal__header h2 {
    font-size: var(--gc-font-size-lg);
  }

  .gc-modal--edge-to-edge {
    padding: var(--gc-space-2);
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

.gc-modal:focus-visible {
  outline: none;
  box-shadow: var(--gc-shadow-focus), var(--gc-shadow-overlay);
}
</style>
