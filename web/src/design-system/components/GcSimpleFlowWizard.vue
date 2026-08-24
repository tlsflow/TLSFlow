<script setup lang="ts">
import { computed } from 'vue'
import GcHelpTip from './GcHelpTip.vue'

export interface SimpleFlowSection {
  id: string
  label: string
  help: string
  helpLabel: string
}

const props = defineProps<{
  sections: readonly SimpleFlowSection[]
  activeSection: string
  title: string
  subtitle?: string
  ariaLabel: string
}>()

const emit = defineEmits<{
  select: [sectionId: string]
}>()

const activeIndex = computed(() => Math.max(0, props.sections.findIndex((section) => section.id === props.activeSection)))
</script>

<template>
  <section class="gc-simple-flow-wizard">
    <header class="gc-simple-flow-wizard__header">
      <div class="gc-simple-flow-wizard__title-group">
        <h1>{{ title }}</h1>
        <p v-if="subtitle">{{ subtitle }}</p>
      </div>
      <div class="gc-simple-flow-wizard__actions">
        <slot name="actions" />
      </div>
    </header>

    <nav class="gc-simple-flow-wizard__sections" :aria-label="ariaLabel">
      <button
        v-for="(section, index) in sections"
        :key="section.id"
        class="gc-simple-flow-wizard__section"
        :class="{ 'is-active': section.id === activeSection }"
        type="button"
        :aria-current="section.id === activeSection ? 'step' : undefined"
        @click="emit('select', section.id)"
      >
        <span class="gc-simple-flow-wizard__section-number">{{ index + 1 }}</span>
        <div class="gc-simple-flow-wizard__section-content">
          <span class="gc-simple-flow-wizard__section-label">{{ section.label }}</span>
          <GcHelpTip :content="section.help" :ariaLabel="section.helpLabel" />
        </div>
      </button>
    </nav>

    <div class="gc-simple-flow-wizard__stage">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.gc-simple-flow-wizard {
  display: grid;
  gap: var(--gc-space-6);
  min-width: 0;
}

.gc-simple-flow-wizard__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: var(--gc-space-6) var(--gc-space-4);
  border-radius: var(--gc-radius-xl);
  background: var(--gc-color-primary-soft);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
}

.gc-simple-flow-wizard__title-group {
  display: grid;
  gap: var(--gc-space-2);
  min-width: 0;
}

.gc-simple-flow-wizard__title-group h1 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-2xl);
  font-weight: 800;
  line-height: var(--gc-line-height-tight);
}

.gc-simple-flow-wizard__title-group p {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
}

.gc-simple-flow-wizard__actions {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  flex-wrap: wrap;
}

.gc-simple-flow-wizard__sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-4);
  padding: 0;
}

.gc-simple-flow-wizard__section {
  display: flex;
  align-items: center;
  gap: var(--gc-space-4);
  min-height: calc(var(--gc-space-12) + var(--gc-space-4));
  padding: var(--gc-space-4) var(--gc-space-5);
  border: var(--gc-border-width-thick) solid var(--gc-color-border-muted);
  border-radius: var(--gc-radius-xl);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-solid);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}

.gc-simple-flow-wizard__section:hover {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-surface-hover);
  transform: translateY(calc(var(--gc-border-width-thick) * -1));
  box-shadow: var(--gc-shadow-hover);
}

.gc-simple-flow-wizard__section.is-active {
  border-color: var(--gc-color-primary);
  color: var(--gc-color-text);
  background: var(--gc-color-primary-soft);
  box-shadow: var(--gc-shadow-hover);
  transform: translateY(calc(var(--gc-border-width-thick) * -1));
}

.gc-simple-flow-wizard__section-number {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: var(--gc-space-10);
  height: var(--gc-space-10);
  border-radius: var(--gc-radius-full);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
  font-size: var(--gc-font-size-lg);
  font-weight: 900;
  transition: all 0.25s ease;
}

.gc-simple-flow-wizard__section.is-active .gc-simple-flow-wizard__section-number {
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-primary);
  box-shadow: 0 var(--gc-space-1) var(--gc-space-3) var(--gc-color-primary-weak);
}

.gc-simple-flow-wizard__section-content {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  min-width: 0;
  flex: 1;
}

.gc-simple-flow-wizard__section-label {
  flex: 1;
  min-width: 0;
  color: inherit;
  font-size: var(--gc-font-size-lg);
  font-weight: 750;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gc-simple-flow-wizard__section.is-active .gc-simple-flow-wizard__section-label {
  color: var(--gc-color-primary-strong);
}

.gc-simple-flow-wizard__stage {
  min-width: 0;
}

@media (max-width: 48rem) {
  .gc-simple-flow-wizard__header {
    flex-direction: column;
    align-items: stretch;
  }

  .gc-simple-flow-wizard__actions {
    justify-content: flex-end;
  }

  .gc-simple-flow-wizard__sections {
    grid-template-columns: 1fr;
  }
}
</style>
