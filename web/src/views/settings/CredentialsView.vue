<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createCredential,
  deleteCredential,
  getCredential,
  getCredentialUsage,
  listCredentials,
  updateCredential,
  updateCredentialStatus,
  type CredentialKind,
  type CredentialProfileDetail,
  type CredentialProfileSummary,
  type CredentialSecretValueInput,
  type CredentialUsage,
} from '@/api/modules/credentials.api'
import { GcModal, GcPageHeader, GcSecretInput, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

type EditorMode = 'create' | 'edit'
type UsageItem = CredentialUsage['items'][number]

interface CredentialFormState {
  name: string
  kind: CredentialKind
  scopeType: CredentialProfileSummary['scopeType']
  scopeId: string
  username: string
  deliveryLocation: 'header' | 'query'
  deliveryName: string
  primarySecret: string
  secondarySecret: string
}

const { t } = useI18n()
const loading = ref(false)
const loadingSelection = ref(false)
const saving = ref(false)
const error = ref('')
const items = ref<CredentialProfileSummary[]>([])
const editorOpen = ref(false)
const deleteOpen = ref(false)
const editorMode = ref<EditorMode>('create')
const selected = ref<CredentialProfileDetail | null>(null)
const usage = ref<CredentialUsage | null>(null)
const form = ref<CredentialFormState>(emptyForm())

const kinds: CredentialKind[] = ['USERNAME_PASSWORD', 'SSH_KEY', 'BEARER_TOKEN', 'API_KEY', 'CLIENT_CERTIFICATE', 'DNS_PROVIDER']
const scopes: CredentialProfileSummary['scopeType'][] = ['global', 'team', 'zone', 'host', 'plugin']
const isEditing = computed(() => editorMode.value === 'edit')
const requiresUsername = computed(() => requiresUsernameFor(form.value.kind))
const requiresSecondarySecret = computed(() => form.value.kind === 'CLIENT_CERTIFICATE')
const editorTitle = computed(() => t(isEditing.value ? 'credentials.edit.title' : 'credentials.create.title'))
const editorDescription = computed(() => t('credentials.create.description'))
const canSubmit = computed(() => {
  const hasRequiredFields = Boolean(
    form.value.name.trim()
    && (!requiresUsername.value || form.value.username.trim())
    && (form.value.scopeType === 'global' || form.value.scopeId.trim()),
  )
  if (!hasRequiredFields) return false
  if (isEditing.value) return true
  return Boolean(form.value.primarySecret && (!requiresSecondarySecret.value || form.value.secondarySecret))
})
const usageGroups = computed(() => ({
  devices: usage.value?.items.filter((item) => item.type === 'DEVICE') ?? [],
  workflows: usage.value?.items.filter((item) => item.type === 'DEPLOYMENT_PLAN') ?? [],
  plugins: usage.value?.items.filter((item) => item.type === 'PLUGIN_BINDING') ?? [],
}))

function emptyForm(): CredentialFormState {
  return {
    name: '',
    kind: 'USERNAME_PASSWORD',
    scopeType: 'global',
    scopeId: '',
    username: '',
    deliveryLocation: 'header',
    deliveryName: 'X-API-Key',
    primarySecret: '',
    secondarySecret: '',
  }
}

function requiresUsernameFor(kind: CredentialKind): boolean {
  return kind === 'USERNAME_PASSWORD' || kind === 'SSH_KEY'
}

function editForm(detail: CredentialProfileDetail): CredentialFormState {
  return {
    name: detail.name,
    kind: detail.kind,
    scopeType: detail.scopeType,
    scopeId: detail.scopeId ?? '',
    username: detail.username ?? '',
    deliveryLocation: detail.delivery?.location === 'query' ? 'query' : 'header',
    deliveryName: detail.delivery?.name ?? 'X-API-Key',
    primarySecret: '',
    secondarySecret: '',
  }
}

function buildSecretValues(kind: CredentialKind, primary: string, secondary: string): Record<string, CredentialSecretValueInput> {
  const values: Record<string, CredentialSecretValueInput> = {}
  if (primary) {
    const slot = kind === 'USERNAME_PASSWORD'
      ? 'password'
      : kind === 'SSH_KEY'
        ? 'privateKey'
        : kind === 'CLIENT_CERTIFICATE'
          ? 'certificate'
          : kind === 'DNS_PROVIDER'
            ? 'config'
            : 'token'
    values[slot] = { plainText: primary }
  }
  if (kind === 'CLIENT_CERTIFICATE' && secondary) values.privateKey = { plainText: secondary }
  return values
}

function usageItemName(item: UsageItem): string {
  return item.name ?? item.id
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const result = await listCredentials()
    items.value = result.data?.items ?? []
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.errors.load')
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  editorMode.value = 'create'
  selected.value = null
  usage.value = null
  form.value = emptyForm()
  error.value = ''
  editorOpen.value = true
}

async function loadSelection(id: string): Promise<void> {
  loadingSelection.value = true
  error.value = ''
  try {
    const [detailResult, usageResult] = await Promise.all([getCredential(id), getCredentialUsage(id)])
    selected.value = detailResult.data ?? null
    usage.value = usageResult.data ?? null
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.errors.load')
    throw cause
  } finally {
    loadingSelection.value = false
  }
}

async function openEdit(id: string): Promise<void> {
  try {
    await loadSelection(id)
    if (!selected.value) return
    editorMode.value = 'edit'
    form.value = editForm(selected.value)
    editorOpen.value = true
  } catch {
    // 错误已由 loadSelection 统一展示。
  }
}

async function openDelete(id: string): Promise<void> {
  try {
    await loadSelection(id)
    if (!selected.value) return
    deleteOpen.value = true
  } catch {
    // 错误已由 loadSelection 统一展示。
  }
}

async function submitEditor(): Promise<void> {
  if (!canSubmit.value) return
  saving.value = true
  error.value = ''
  try {
    const secretValues = buildSecretValues(form.value.kind, form.value.primarySecret, form.value.secondarySecret)
    const commonInput = {
      name: form.value.name.trim(),
      scopeType: form.value.scopeType,
      scopeId: form.value.scopeType === 'global' ? undefined : form.value.scopeId.trim(),
      username: requiresUsername.value ? form.value.username.trim() : undefined,
      delivery: form.value.kind === 'API_KEY'
        ? { location: form.value.deliveryLocation, name: form.value.deliveryName.trim() }
        : undefined,
    }
    if (isEditing.value && selected.value) {
      await updateCredential(selected.value.id, {
        ...commonInput,
        expectedVersion: selected.value.version,
        secretValues: Object.keys(secretValues).length > 0 ? secretValues : undefined,
      })
    } else {
      await createCredential({ ...commonInput, kind: form.value.kind, secretValues })
    }
    editorOpen.value = false
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.errors.save')
  } finally {
    saving.value = false
  }
}

async function toggleStatus(): Promise<void> {
  if (!selected.value) return
  saving.value = true
  error.value = ''
  try {
    const status = selected.value.status === 'active' ? 'disabled' : 'active'
    const result = await updateCredentialStatus(selected.value.id, selected.value.version, status)
    selected.value = result.data ?? selected.value
    form.value = editForm(selected.value)
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.errors.save')
  } finally {
    saving.value = false
  }
}

async function removeSelected(): Promise<void> {
  if (!selected.value) return
  saving.value = true
  error.value = ''
  try {
    const latestUsage = await getCredentialUsage(selected.value.id)
    usage.value = latestUsage.data ?? usage.value
    if ((usage.value?.total ?? 0) > 0) return
    await deleteCredential(selected.value.id)
    deleteOpen.value = false
    selected.value = null
    usage.value = null
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.errors.delete')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="gc-page credentials-page">
    <GcPageHeader :title="t('credentials.title')" :description="t('credentials.description')">
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="load">{{ t('credentials.actions.refresh') }}</button>
        <RouterLink class="gc-button" to="/settings/browser-credentials">{{ t('credentials.browser.actions.open') }}</RouterLink>
        <button class="gc-button gc-button--primary" type="button" @click="openCreate">{{ t('credentials.actions.create') }}</button>
      </template>
    </GcPageHeader>

    <p v-if="error" class="credentials-page__error" role="alert">{{ error }}</p>

    <section class="gc-card credentials-list">
      <header class="credentials-list__header">
        <div>
          <h2>{{ t('credentials.list.title') }}</h2>
          <p>{{ t('credentials.list.description', { count: items.length }) }}</p>
        </div>
      </header>

      <p v-if="loading" class="credentials-list__state">{{ t('common.loading') }}</p>
      <p v-else-if="items.length === 0" class="credentials-list__state">{{ t('credentials.empty') }}</p>
      <div v-else class="credentials-list__table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('credentials.columns.name') }}</th>
              <th>{{ t('credentials.columns.kind') }}</th>
              <th>{{ t('credentials.columns.scope') }}</th>
              <th>{{ t('credentials.columns.username') }}</th>
              <th>{{ t('credentials.columns.status') }}</th>
              <th>{{ t('credentials.columns.updatedAt') }}</th>
              <th class="credentials-list__actions-heading">{{ t('credentials.columns.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.id">
              <td>
                <div class="credential-name">
                  <span class="credential-name__mark" aria-hidden="true">{{ item.name.slice(0, 1).toUpperCase() }}</span>
                  <span><strong>{{ item.name }}</strong><small>{{ item.id }}</small></span>
                </div>
              </td>
              <td><span class="credential-kind">{{ t(`credentials.kinds.${item.kind}`) }}</span></td>
              <td>{{ t(`credentials.scopes.${item.scopeType}`) }}</td>
              <td>{{ item.username ?? '—' }}</td>
              <td>
                <div v-if="item.status === 'error'" class="credential-status credential-status--repair" :title="t('credentials.status.errorHint')">
                  <span>{{ t('credentials.status.errorLabel') }}</span>
                  <small>{{ t('credentials.status.errorSummary') }}</small>
                </div>
                <GcStatusTag v-else :status="item.status" />
              </td>
              <td>{{ formatMaybeLocalTime(item.updatedAt) }}</td>
              <td>
                <div class="credentials-list__actions">
                  <button class="gc-button" type="button" :disabled="loadingSelection" @click="openEdit(item.id)">{{ t('credentials.actions.edit') }}</button>
                  <button class="gc-button gc-button--danger" type="button" :disabled="loadingSelection" @click="openDelete(item.id)">{{ t('credentials.actions.delete') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <GcModal v-model:open="editorOpen" :title="editorTitle" :description="isEditing ? undefined : editorDescription" size="xl">
      <form class="credentials-editor" @submit.prevent="submitEditor">
        <section class="credentials-editor__section">
          <header><h3>{{ t('credentials.form.basicTitle') }}</h3><p>{{ t('credentials.form.basicDescription') }}</p></header>
          <div class="credentials-editor__grid">
            <label class="credentials-field gc-form-field"><span>{{ t('credentials.fields.name') }}</span><input v-model="form.name" required></label>
            <label class="credentials-field gc-form-field">
              <span>{{ t('credentials.fields.kind') }}</span>
              <span class="credentials-select">
                <select v-model="form.kind" :disabled="isEditing"><option v-for="kind in kinds" :key="kind" :value="kind">{{ t(`credentials.kinds.${kind}`) }}</option></select>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
              </span>
            </label>
            <label class="credentials-field gc-form-field">
              <span>{{ t('credentials.fields.scope') }}</span>
              <span class="credentials-select">
                <select v-model="form.scopeType"><option v-for="scope in scopes" :key="scope" :value="scope">{{ t(`credentials.scopes.${scope}`) }}</option></select>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
              </span>
            </label>
            <label v-if="form.scopeType !== 'global'" class="credentials-field gc-form-field"><span>{{ t('credentials.fields.scopeId') }}</span><input v-model="form.scopeId" required></label>
            <label v-if="requiresUsername" class="credentials-field gc-form-field"><span>{{ t('credentials.fields.username') }}</span><input v-model="form.username" autocomplete="username" required></label>
            <label v-if="form.kind === 'API_KEY'" class="credentials-field gc-form-field"><span>{{ t('credentials.fields.deliveryName') }}</span><input v-model="form.deliveryName" required></label>
          </div>
        </section>

        <section class="credentials-editor__section credentials-editor__section--secret">
          <header><h3>{{ t('credentials.form.secretTitle') }}</h3><p v-if="!isEditing">{{ t('credentials.form.secretCreateDescription') }}</p></header>
          <div class="credentials-editor__grid">
            <label v-if="form.kind === 'DNS_PROVIDER'" class="credentials-dns-config gc-form-field">
              <span>{{ t('credentials.secretLabels.DNS_PROVIDER') }}</span>
              <textarea v-model="form.primarySecret" rows="8" :placeholder="t(isEditing ? 'credentials.placeholders.keepSecret' : 'credentials.placeholders.primarySecret')" autocomplete="off" />
              <small>{{ t(isEditing ? 'credentials.hints.keepSecret' : 'credentials.hints.encrypted') }}</small>
            </label>
            <GcSecretInput v-else v-model="form.primarySecret" class="credentials-secret-field gc-form-field" :label="t(`credentials.secretLabels.${form.kind}`)" :placeholder="t(isEditing ? 'credentials.placeholders.keepSecret' : 'credentials.placeholders.primarySecret')" :hint="t(isEditing ? 'credentials.hints.keepSecret' : 'credentials.hints.encrypted')" />
            <GcSecretInput v-if="requiresSecondarySecret" v-model="form.secondarySecret" class="credentials-secret-field gc-form-field" :label="t('credentials.fields.secondarySecret')" :placeholder="t(isEditing ? 'credentials.placeholders.keepSecret' : 'credentials.placeholders.secondarySecret')" :hint="t(isEditing ? 'credentials.hints.keepSecret' : 'credentials.hints.encrypted')" />
          </div>
        </section>

        <section v-if="isEditing" class="credentials-editor__section">
          <header><h3>{{ t('credentials.usage.title') }}</h3></header>
          <div class="usage-summary" :class="{ 'usage-summary--empty': !usage?.total }">
            <strong>{{ t('credentials.usage.total', { count: usage?.total ?? 0 }) }}</strong>
            <span>{{ usage?.total ? t('credentials.usage.changeWarning') : t('credentials.usage.empty') }}</span>
          </div>
          <div v-if="usage?.total" class="usage-groups">
            <section v-for="group in (['devices', 'workflows', 'plugins'] as const)" :key="group" class="usage-group">
              <h4>{{ t(`credentials.usage.groups.${group}`, { count: usageGroups[group].length }) }}</h4>
              <ul v-if="usageGroups[group].length"><li v-for="item in usageGroups[group]" :key="`${item.type}:${item.id}`"><strong>{{ usageItemName(item) }}</strong><small>{{ item.id }}</small></li></ul>
              <p v-else>{{ t('credentials.usage.groupEmpty') }}</p>
            </section>
          </div>
        </section>
      </form>
      <template #actions>
        <button
          v-if="isEditing"
          class="gc-button credential-status-action"
          :class="selected?.status === 'active' ? 'credential-status-action--disable' : 'credential-status-action--enable'"
          type="button"
          :disabled="saving"
          @click="toggleStatus"
        >
          <span class="credential-status-action__dot" aria-hidden="true" />
          {{ selected?.status === 'active' ? t('credentials.actions.disable') : t('credentials.actions.enable') }}
        </button>
        <button class="gc-button" type="button" @click="editorOpen = false">{{ t('credentials.actions.close') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="saving || !canSubmit" @click="submitEditor">{{ t('credentials.actions.save') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="deleteOpen" :title="t('credentials.deleteDialog.title')" :description="t('credentials.deleteDialog.description')" size="lg">
      <section v-if="selected" class="delete-dialog">
        <div class="delete-dialog__credential"><span>{{ t('credentials.fields.credential') }}</span><strong>{{ selected.name }}</strong><small>{{ t(`credentials.kinds.${selected.kind}`) }} · {{ selected.id }}</small></div>
        <div class="usage-summary" :class="{ 'usage-summary--danger': usage?.total, 'usage-summary--empty': !usage?.total }">
          <strong>{{ usage?.total ? t('credentials.deleteDialog.inUseTitle', { count: usage.total }) : t('credentials.deleteDialog.availableTitle') }}</strong>
          <span>{{ usage?.total ? t('credentials.deleteDialog.inUseDescription') : t('credentials.deleteDialog.availableDescription') }}</span>
        </div>
        <div v-if="usage?.total" class="usage-groups">
          <section v-for="group in (['devices', 'workflows', 'plugins'] as const)" :key="group" class="usage-group">
            <h4>{{ t(`credentials.usage.groups.${group}`, { count: usageGroups[group].length }) }}</h4>
            <ul v-if="usageGroups[group].length"><li v-for="item in usageGroups[group]" :key="`${item.type}:${item.id}`"><strong>{{ usageItemName(item) }}</strong><small>{{ item.id }}</small></li></ul>
            <p v-else>{{ t('credentials.usage.groupEmpty') }}</p>
          </section>
        </div>
      </section>
      <template #actions>
        <button class="gc-button" type="button" @click="deleteOpen = false">{{ t('credentials.actions.close') }}</button>
        <button class="gc-button gc-button--danger" type="button" :disabled="saving || (usage?.total ?? 0) > 0" @click="removeSelected">{{ t('credentials.actions.confirmDelete') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.credentials-page { display: grid; gap: var(--gc-space-5); }
.credentials-page__error { margin: 0; padding: var(--gc-space-3) var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); background: var(--gc-color-danger-bg); color: var(--gc-color-danger); }
.credentials-list { overflow: hidden; padding: 0; }
.credentials-list__header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); padding: var(--gc-space-4) var(--gc-space-5); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); background: var(--gc-gradient-surface-soft); }
.credentials-list__header h2, .credentials-editor h3, .usage-group h4 { margin: 0; color: var(--gc-color-text-strong); }
.credentials-list__header p, .credentials-editor header p, .usage-group p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.credentials-list__state { margin: 0; padding: var(--gc-space-10); text-align: center; color: var(--gc-color-text-muted); }
.credentials-list__table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: separate; border-spacing: 0; }
th, td { padding: var(--gc-space-3) var(--gc-space-4); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); text-align: left; vertical-align: middle; }
th { background: var(--gc-color-surface-muted); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 800; }
td { color: var(--gc-color-text); }
tbody tr { background: var(--gc-color-surface); }
tbody tr:hover { background: var(--gc-color-surface-hover); }
tbody tr:last-child td { border-bottom: 0; }
.credentials-list__actions-heading { text-align: right; }
.credentials-list__actions { display: flex; justify-content: flex-end; gap: var(--gc-space-2); }
.credential-name { display: flex; align-items: center; gap: var(--gc-space-3); min-width: var(--gc-size-card-min); }
.credential-name__mark { display: grid; flex: 0 0 var(--gc-control-height-md); width: var(--gc-control-height-md); height: var(--gc-control-height-md); place-items: center; border-radius: var(--gc-radius-md); background: var(--gc-color-primary-soft); color: var(--gc-color-primary-strong); font-weight: 800; }
.credential-name > span:last-child { display: grid; gap: var(--gc-space-1); }
.credential-name small, .usage-group small, .delete-dialog__credential small { color: var(--gc-color-text-muted); }
.credential-kind { display: inline-flex; padding: var(--gc-space-1) var(--gc-space-2); border: var(--gc-border-width-default) solid var(--gc-color-info-border); border-radius: var(--gc-radius-xl); background: var(--gc-color-info-soft); color: var(--gc-color-info); font-size: var(--gc-font-size-xs); font-weight: 700; white-space: nowrap; }
.credential-status { display: grid; justify-items: start; gap: var(--gc-space-1); }
.credential-status span { display: inline-flex; padding: var(--gc-space-1) var(--gc-space-2); border-radius: var(--gc-radius-xl); font-size: var(--gc-font-size-xs); font-weight: 700; }
.credential-status small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); white-space: nowrap; }
.credential-status--repair span { border: var(--gc-border-width-default) solid var(--gc-color-warning-border); background: var(--gc-color-warning-bg); color: var(--gc-color-warning); }
.credential-status-action { font-weight: 700; }
.credential-status-action__dot { width: var(--gc-space-2); height: var(--gc-space-2); border-radius: var(--gc-radius-xl); background: currentColor; }
.credential-status-action--enable { border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); color: var(--gc-color-success); }
.credential-status-action--enable:hover { border-color: var(--gc-color-success); background: var(--gc-color-success-soft); }
.credential-status-action--disable { border-color: var(--gc-color-warning-border); background: var(--gc-color-warning-bg); color: var(--gc-color-warning); }
.credential-status-action--disable:hover { border-color: var(--gc-color-warning); background: var(--gc-color-warning-soft); }
.credentials-editor { display: grid; gap: var(--gc-space-4); }
.credentials-editor__section { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-raised); }
.credentials-editor__section--secret { border-color: var(--gc-color-primary-border); background: var(--gc-color-primary-weak); }
.credentials-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.credentials-field { align-content: start; color: var(--gc-color-text); }
.credentials-select { position: relative; display: block; }
.credentials-select select { appearance: none; padding-right: var(--gc-space-8); cursor: pointer; }
.credentials-select select:disabled { cursor: not-allowed; opacity: var(--gc-opacity-disabled); }
.credentials-select svg { position: absolute; top: 50%; right: var(--gc-space-3); width: var(--gc-space-4); height: var(--gc-space-4); transform: translateY(-50%); fill: none; stroke: var(--gc-color-text-muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.credentials-dns-config { display: grid; gap: var(--gc-space-2); }
.credentials-dns-config span { color: var(--gc-color-text); }
.credentials-dns-config textarea { width: 100%; min-height: var(--gc-control-height-xl); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-field); padding: var(--gc-space-2) var(--gc-space-3); color: var(--gc-color-text); font-family: var(--gc-font-family); resize: vertical; }
.credentials-dns-config textarea:focus { border-color: var(--gc-color-focus); background: var(--gc-color-surface-solid); box-shadow: var(--gc-shadow-focus); outline: none; }
.credentials-dns-config small { color: var(--gc-color-text-muted); }
.credentials-editor :deep(.credentials-secret-field input) { width: 100%; height: var(--gc-control-height-md); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-field); padding: 0 var(--gc-space-3); color: var(--gc-color-text); outline: none; box-shadow: inset 0 var(--gc-space-hairline) var(--gc-space-hairline) var(--gc-color-border-subtle); }
.credentials-editor :deep(.credentials-secret-field input:focus) { border-color: var(--gc-color-focus); background: var(--gc-color-surface-solid); box-shadow: var(--gc-shadow-focus); }
.usage-summary { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3) var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-warning-border); border-radius: var(--gc-radius-md); background: var(--gc-color-warning-bg); color: var(--gc-color-warning); }
.usage-summary span { color: var(--gc-color-text-muted); }
.usage-summary--empty { border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); color: var(--gc-color-success); }
.usage-summary--danger { border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-bg); color: var(--gc-color-danger); }
.usage-groups { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); }
.usage-group { min-width: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface); }
.usage-group ul { display: grid; gap: var(--gc-space-2); margin: var(--gc-space-3) 0 0; padding: 0; list-style: none; }
.usage-group li { display: grid; gap: var(--gc-space-1); min-width: 0; padding-top: var(--gc-space-2); border-top: var(--gc-border-width-default) solid var(--gc-color-border-subtle); }
.usage-group strong, .usage-group small { overflow-wrap: anywhere; }
.delete-dialog { display: grid; gap: var(--gc-space-4); }
.delete-dialog__credential { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-raised); }
.delete-dialog__credential > span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
@media (max-width: 56.25rem) {
  .credentials-editor__grid, .usage-groups { grid-template-columns: 1fr; }
}
</style>
