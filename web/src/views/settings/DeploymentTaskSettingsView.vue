<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { getDeploymentTaskSettings, updateDeploymentTaskSettings } from '@/api/modules/security.api'
import { usePermissionStore } from '@/stores/permission.store'

const { t } = useI18n()
const permissionStore = usePermissionStore()
const canWrite = computed(() => permissionStore.hasPermission('settings.write'))
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const settings = reactive({
  dryRunEnabled: false,
})

async function loadSettings(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const result = await getDeploymentTaskSettings()
    if (result.data?.deploymentTasks) {
      settings.dryRunEnabled = result.data.deploymentTasks.dryRunEnabled
    }
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('settings.deploymentTasks.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

async function saveSettings(): Promise<void> {
  if (!canWrite.value || saving.value) return
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await updateDeploymentTaskSettings({ ...settings })
    if (result.data?.deploymentTasks) {
      settings.dryRunEnabled = result.data.deploymentTasks.dryRunEnabled
    }
    successMessage.value = t('settings.deploymentTasks.messages.saved')
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('settings.deploymentTasks.errors.saveFailed')
  } finally {
    saving.value = false
  }
}

onMounted(() => { void loadSettings() })
</script>

<template>
  <section class="gc-page deployment-task-settings">
    <header class="deployment-task-settings__header">
      <div>
        <p class="deployment-task-settings__eyebrow">{{ t('settings.deploymentTasks.eyebrow') }}</p>
        <h2>{{ t('settings.deploymentTasks.title') }}</h2>
        <p>{{ t('settings.deploymentTasks.description') }}</p>
      </div>
    </header>

    <p v-if="loading" class="deployment-task-settings__state">{{ t('common.loading') }}</p>
    <p v-if="errorMessage" class="gc-form-error">{{ errorMessage }}</p>
    <p v-if="successMessage" class="deployment-task-settings__success">{{ successMessage }}</p>

    <form class="gc-card deployment-task-settings__card" @submit.prevent="saveSettings">
      <label class="deployment-task-settings__option">
        <span class="deployment-task-settings__copy">
          <strong>{{ t('settings.deploymentTasks.fields.dryRun.title') }}</strong>
          <small>{{ t('settings.deploymentTasks.fields.dryRun.description') }}</small>
        </span>
        <input
          v-model="settings.dryRunEnabled"
          type="checkbox"
          role="switch"
          :aria-label="t('settings.deploymentTasks.fields.dryRun.aria')"
          :disabled="!canWrite || loading || saving"
        />
      </label>
      <footer class="deployment-task-settings__actions">
        <span v-if="!canWrite" class="deployment-task-settings__readonly">{{ t('settings.deploymentTasks.readonly') }}</span>
        <button class="gc-button gc-button--primary" type="submit" :disabled="!canWrite || loading || saving">
          {{ saving ? t('settings.deploymentTasks.actions.saving') : t('settings.deploymentTasks.actions.save') }}
        </button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.deployment-task-settings {
  display: grid;
  gap: var(--gc-space-5);
}

.deployment-task-settings__header {
  display: grid;
  gap: var(--gc-space-2);
}

.deployment-task-settings__header h2,
.deployment-task-settings__header p {
  margin: 0;
}

.deployment-task-settings__header p:not(.deployment-task-settings__eyebrow) {
  color: var(--gc-color-text-muted);
  line-height: 1.6;
}

.deployment-task-settings__eyebrow {
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

.deployment-task-settings__card {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-6);
}

.deployment-task-settings__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-5);
  padding: var(--gc-space-4) 0;
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  cursor: pointer;
}

.deployment-task-settings__copy {
  display: grid;
  gap: var(--gc-space-1);
}

.deployment-task-settings__copy small {
  color: var(--gc-color-text-muted);
  line-height: 1.5;
}

.deployment-task-settings__option input {
  flex: 0 0 auto;
  inline-size: var(--gc-control-height-xs);
  block-size: var(--gc-control-height-xs);
  accent-color: var(--gc-color-primary);
}

.deployment-task-settings__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--gc-space-3);
  padding-top: var(--gc-space-5);
}

.deployment-task-settings__readonly,
.deployment-task-settings__state {
  color: var(--gc-color-text-muted);
}

.deployment-task-settings__success {
  color: var(--gc-color-success);
}

@media (max-width: 40rem) {
  .deployment-task-settings__option {
    align-items: flex-start;
  }

  .deployment-task-settings__actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
