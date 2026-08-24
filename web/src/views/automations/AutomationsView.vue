<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { automationAction, createAutomation, deleteAutomation, listAutomations, previewAutomation, runAutomation, updateAutomation, type AutomationConfiguration, type AutomationPreviewRecord, type AutomationRecord } from '@/api/modules/automations.api'
import { GcModal, GcPageHeader, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'
import AutomationEditor from './AutomationEditor.vue'
import AutomationPreviewPanel from './AutomationPreviewPanel.vue'

const { t } = useI18n()
const router = useRouter()
const items = ref<AutomationRecord[]>([])
const loading = ref(false)
const editorOpen = ref(false)
const previewOpen = ref(false)
const editing = ref<AutomationRecord | null>(null)
const previewing = ref<AutomationRecord | null>(null)
const preview = ref<AutomationPreviewRecord | null>(null)
const previewLoading = ref(false)
const errorMessage = ref('')

async function load() {
  loading.value = true
  errorMessage.value = ''
  try { items.value = await listAutomations() } catch { errorMessage.value = t('automations.errors.loadFailed') } finally { loading.value = false }
}

function openCreate() { editing.value = null; editorOpen.value = true }
function openEdit(item: AutomationRecord) { editing.value = item; editorOpen.value = true }

async function save(payload: AutomationConfiguration & { name: string; description?: string }) {
  if (editing.value) await updateAutomation(editing.value.id, { expectedVersion: editing.value.version, name: payload.name, description: payload.description, configuration: payload })
  else await createAutomation(payload)
  editorOpen.value = false
  await load()
}

async function toggle(item: AutomationRecord) { await automationAction(item.id, item.status === 'active' ? 'disable' : 'enable', item.version); await load() }
async function copy(item: AutomationRecord) { await automationAction(item.id, 'copy'); await load() }
async function remove(item: AutomationRecord) { await deleteAutomation(item.id, item.version); await load() }

async function openPreview(item: AutomationRecord) {
  previewing.value = item
  preview.value = null
  previewOpen.value = true
  previewLoading.value = true
  try { preview.value = await previewAutomation(item.id) } finally { previewLoading.value = false }
}

async function confirmRun() {
  if (!previewing.value) return
  const run = await runAutomation(previewing.value.id, previewing.value.version)
  previewOpen.value = false
  await router.push(`/automation-runs/${run.id}`)
}

function triggerLabelKey(triggerType: AutomationRecord['configuration']['trigger']['type']): string {
  if (triggerType === 'api') return 'automations.scheduleBuilder.api'
  if (triggerType === 'once') return 'automations.scheduleBuilder.once'
  if (triggerType === 'schedule') return 'automations.scheduleBuilder.recurring'
  return 'automations.triggers.onDemand'
}

onMounted(load)
</script>

<template>
  <section class="automations-page">
    <GcPageHeader :title="t('automations.title')" :description="t('automations.description')">
      <template #actions><button class="gc-button gc-button--primary" type="button" @click="openCreate">{{ t('automations.actions.create') }}</button></template>
    </GcPageHeader>
    <p v-if="errorMessage" class="automations-page__error">{{ errorMessage }}</p>
    <p v-if="loading">{{ t('common.loading') }}</p>
    <div v-else class="automation-grid">
      <article v-for="item in items" :key="item.id" class="automation-card">
        <header><div><h2>{{ item.name }}</h2><p>{{ item.description || t('automations.emptyDescription') }}</p></div><GcStatusTag :status="item.status" /></header>
        <dl>
          <div><dt>{{ t('automations.columns.trigger') }}</dt><dd>{{ t(triggerLabelKey(item.configuration.trigger.type)) }}</dd></div>
          <div><dt>{{ t('automations.columns.targets') }}</dt><dd>{{ t('automations.summaries.targets', { count: item.configuration.guardrails.maxTargetsPerRun }) }}</dd></div>
          <div><dt>{{ t('automations.columns.actions') }}</dt><dd>{{ item.configuration.actions.map((action) => t(`automations.actionTypes.${action.type}`)).join(', ') }}</dd></div>
          <div><dt>{{ t('automations.columns.nextRun') }}</dt><dd>{{ formatMaybeLocalTime(item.nextRunAt, t('automations.common.notAvailable')) }}</dd></div>
          <div><dt>{{ t('automations.columns.lastRun') }}</dt><dd>{{ formatMaybeLocalTime(item.lastRunAt, t('automations.common.notAvailable')) }}</dd></div>
        </dl>
        <footer>
          <button class="gc-button" type="button" @click="openEdit(item)">{{ t('automations.actions.edit') }}</button>
          <button class="gc-button" type="button" @click="copy(item)">{{ t('automations.actions.copy') }}</button>
          <button class="gc-button" type="button" @click="toggle(item)">{{ t(item.status === 'active' ? 'automations.actions.disable' : 'automations.actions.enable') }}</button>
          <button class="gc-button gc-button--primary" type="button" @click="openPreview(item)">{{ t('automations.actions.preview') }}</button>
          <button class="gc-button" type="button" @click="router.push(`/automation-runs?automationId=${item.id}`)">{{ t('automations.actions.history') }}</button>
          <button class="gc-button gc-button--danger" type="button" @click="remove(item)">{{ t('automations.actions.delete') }}</button>
        </footer>
      </article>
      <p v-if="items.length === 0">{{ t('automations.empty') }}</p>
    </div>

    <GcModal v-model:open="editorOpen" :title="editing ? t('automations.editor.editTitle') : t('automations.editor.createTitle')" size="xxl" width="var(--gc-size-modal-wide)">
      <AutomationEditor :automation="editing" @save="save" @cancel="editorOpen = false" />
    </GcModal>
    <GcModal v-model:open="previewOpen" :title="t('automations.preview.title')" :description="t('automations.preview.description')" size="lg">
      <AutomationPreviewPanel :preview="preview" :loading="previewLoading" @confirm="confirmRun" />
    </GcModal>
  </section>
</template>

<style scoped>
.automations-page, .automation-grid, .automation-card { display: grid; gap: var(--gc-space-4); }
.automation-grid { grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 7), 1fr)); }
.automation-card { padding: var(--gc-space-5); border: var(--gc-border-width-default) solid var(--gc-color-border-muted); border-radius: var(--gc-radius-lg); background: var(--gc-gradient-surface); box-shadow: var(--gc-shadow-sm); }
.automation-card header, .automation-card footer { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--gc-space-3); flex-wrap: wrap; }
.automation-card h2, .automation-card p { margin: 0; }
.automation-card p, .automation-card dt { color: var(--gc-color-text-muted); }
.automation-card dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.automation-card dl div { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-raised); }
.automation-card dd { margin: 0; color: var(--gc-color-text); overflow-wrap: anywhere; }
.automations-page__error { padding: var(--gc-space-3); color: var(--gc-color-danger); background: var(--gc-color-danger-soft); border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); }
</style>
