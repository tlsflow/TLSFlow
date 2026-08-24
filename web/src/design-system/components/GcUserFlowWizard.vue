<script setup lang="ts">
import { computed } from 'vue'
import GcHelpTip from './GcHelpTip.vue'

export interface UserFlowStep {
  id: string
  label: string
  help: string
  helpLabel: string
  completed?: boolean
}

const props = withDefaults(defineProps<{
  steps: readonly UserFlowStep[]
  activeStep: string
  title: string
  help: string
  helpLabel: string
  ariaLabel: string
  /** 是否显示当前步骤的阶段标题和帮助提示。 */
  showStageHeader?: boolean
}>(), {
  showStageHeader: true,
})

const emit = defineEmits<{
  select: [stepId: string]
}>()

const activeIndex = computed(() => Math.max(0, props.steps.findIndex((step) => step.id === props.activeStep)))
const activePosition = computed(() => activeIndex.value + 1)

function stepState(step: UserFlowStep, index: number): 'active' | 'complete' | 'upcoming' {
  if (step.id === props.activeStep) return 'active'
  if (step.completed || index < activeIndex.value) return 'complete'
  return 'upcoming'
}
</script>

<template>
  <section class="gc-user-flow-wizard">
    <nav class="gc-user-flow-wizard__steps" :aria-label="ariaLabel" :style="{ '--gc-user-flow-step-count': steps.length }">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        class="gc-user-flow-wizard__step"
        :class="`is-${stepState(step, index)}`"
      >
        <button
          class="gc-user-flow-wizard__step-button"
          type="button"
          :aria-current="step.id === activeStep ? 'step' : undefined"
          @click="emit('select', step.id)"
        >
          <span class="gc-user-flow-wizard__step-index" aria-hidden="true">
            <span v-if="stepState(step, index) === 'complete'">✓</span>
            <span v-else>{{ index + 1 }}</span>
          </span>
          <span class="gc-user-flow-wizard__step-label">{{ step.label }}</span>
        </button>
        <GcHelpTip :content="step.help" :ariaLabel="step.helpLabel" />
      </div>
    </nav>

    <header v-if="props.showStageHeader" class="gc-user-flow-wizard__stage-header">
      <div class="gc-user-flow-wizard__stage-title">
        <span class="gc-user-flow-wizard__stage-position" aria-hidden="true">{{ activePosition }}</span>
        <h2>{{ title }}</h2>
        <GcHelpTip :content="help" :ariaLabel="helpLabel" />
      </div>
      <div class="gc-user-flow-wizard__stage-actions">
        <slot name="actions" />
      </div>
    </header>

    <div class="gc-user-flow-wizard__content">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.gc-user-flow-wizard {
  display: grid;
  gap: var(--gc-space-4);
  min-width: 0;
}

.gc-user-flow-wizard__steps {
  display: grid;
  grid-template-columns: repeat(var(--gc-user-flow-step-count, 3), minmax(0, 1fr));
  overflow: visible;
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-glass);
  box-shadow: var(--gc-shadow-sm);
}

.gc-user-flow-wizard__step {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  min-width: 0;
  min-height: calc(var(--gc-space-10) + var(--gc-space-6));
  padding: var(--gc-space-3) var(--gc-space-4);
  border-right: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  background: transparent;
}

.gc-user-flow-wizard__step:last-child {
  border-right: 0;
}

.gc-user-flow-wizard__step.is-active {
  color: var(--gc-color-text-inverse);
  background: var(--gc-color-primary);
}

.gc-user-flow-wizard__step.is-complete {
  background: var(--gc-color-success-soft);
}

.gc-user-flow-wizard__step-button {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.gc-user-flow-wizard__step-button:focus-visible {
  outline: var(--gc-border-width-default) solid currentColor;
  outline-offset: var(--gc-space-1);
}

.gc-user-flow-wizard__step-index,
.gc-user-flow-wizard__stage-position {
  display: inline-grid;
  place-items: center;
  flex: 0 0 auto;
  width: var(--gc-space-8);
  height: var(--gc-space-8);
  border-radius: var(--gc-radius-full);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: var(--gc-font-size-sm);
  font-weight: 900;
}

.gc-user-flow-wizard__step.is-active .gc-user-flow-wizard__step-index {
  color: var(--gc-color-primary);
  background: var(--gc-color-surface-solid);
}

.gc-user-flow-wizard__step.is-complete .gc-user-flow-wizard__step-index {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.gc-user-flow-wizard__step-label {
  min-width: 0;
  overflow: hidden;
  color: inherit;
  font-size: var(--gc-font-size-md);
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gc-user-flow-wizard__step .gc-help-tip :deep(.gc-help-tip__button) {
  border-color: var(--gc-color-border-muted);
}

.gc-user-flow-wizard__step.is-active .gc-help-tip :deep(.gc-help-tip__button) {
  border-color: var(--gc-color-text-inverse-muted);
  color: var(--gc-color-text-inverse);
  background: transparent;
}

.gc-user-flow-wizard__stage-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: 0 var(--gc-space-1);
}

.gc-user-flow-wizard__stage-title,
.gc-user-flow-wizard__stage-actions {
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  min-width: 0;
}

.gc-user-flow-wizard__stage-title h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xl);
  line-height: var(--gc-line-height-tight);
}

.gc-user-flow-wizard__content {
  min-width: 0;
}

@media (max-width: 48rem) {
  .gc-user-flow-wizard__steps {
    grid-template-columns: 1fr;
  }

  .gc-user-flow-wizard__step {
    min-height: 0;
    border-right: 0;
    border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-muted);
  }

  .gc-user-flow-wizard__step:last-child {
    border-bottom: 0;
  }

  .gc-user-flow-wizard__stage-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
