<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  open?: boolean
  title?: string
  description?: string
  width?: string
  labelledBy?: string
}>(), {
  open: false,
  width: 'min(var(--gc-size-drawer-wide), 100vw)',
})

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
const { t } = useI18n()

function close(): void {
  emit('update:open', false)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

watch(() => props.open, (open) => {
  if (open) window.addEventListener('keydown', handleKeydown)
  else window.removeEventListener('keydown', handleKeydown)
}, { immediate: true })

onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="gc-drawer__layer">
      <button class="gc-drawer__backdrop" type="button" :aria-label="t('designSystem.drawer.closeAria')" @click="close" />
      <aside
        class="gc-drawer"
        :style="{ '--gc-drawer-width': width }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledBy"
      >
        <header class="gc-drawer__header">
          <div class="gc-drawer__heading">
            <h2 v-if="title" :id="labelledBy">{{ title }}</h2>
            <p v-if="description">{{ description }}</p>
          </div>
          <button class="gc-icon-button gc-drawer__close" type="button" :aria-label="t('designSystem.drawer.closeAria')" @click="close">
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div class="gc-drawer__body">
          <slot />
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.gc-drawer__layer {
  position: fixed;
  inset: 0;
  z-index: 45;
  pointer-events: none;
}

.gc-drawer__backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: var(--gc-color-backdrop);
  cursor: pointer;
  pointer-events: auto;
}

.gc-drawer {
  position: absolute;
  top: 0;
  right: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: var(--gc-drawer-width);
  height: 100%;
  overflow: hidden;
  border-left: var(--gc-border-width-default) solid var(--gc-color-border);
  background: var(--gc-color-surface-overlay);
  box-shadow: var(--gc-shadow-overlay);
  pointer-events: auto;
}

.gc-drawer__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: var(--gc-space-5) var(--gc-space-6);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}

.gc-drawer__heading {
  min-width: 0;
}

.gc-drawer__heading h2,
.gc-drawer__heading p {
  margin: 0;
}

.gc-drawer__heading h2 {
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-lg);
}

.gc-drawer__heading p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.gc-drawer__close {
  flex: 0 0 auto;
  min-width: var(--gc-control-height-md);
  min-height: var(--gc-control-height-md);
  padding: 0;
  font-size: var(--gc-font-size-lg);
}

.gc-drawer__body {
  min-height: 0;
  overflow: auto;
  padding: var(--gc-space-4) var(--gc-space-6) var(--gc-space-6);
}

@media (max-width: 40rem) {
  .gc-drawer__header,
  .gc-drawer__body {
    padding-inline: var(--gc-space-4);
  }
}
</style>
