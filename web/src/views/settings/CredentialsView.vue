<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createCredential,
  deleteCredential,
  getCredential,
  getCredentialUsage,
  listCredentials,
  rotateCredential,
  updateCredentialStatus,
  type CredentialKind,
  type CredentialProfileDetail,
  type CredentialProfileSummary,
  type CredentialUsage,
} from '@/api/modules/credentials.api'
import { GcModal, GcPageHeader, GcStatusTag } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const items = ref<CredentialProfileSummary[]>([])
const createOpen = ref(false)
const detailOpen = ref(false)
const selected = ref<CredentialProfileDetail | null>(null)
const usage = ref<CredentialUsage | null>(null)
const rotatePrimary = ref('')
const rotateSecondary = ref('')
const form = ref({
  name: '',
  kind: 'USERNAME_PASSWORD' as CredentialKind,
  scopeType: 'global' as CredentialProfileSummary['scopeType'],
  scopeId: '',
  username: '',
  deliveryLocation: 'header' as 'header' | 'query',
  deliveryName: 'X-API-Key',
  primarySecret: '',
  secondarySecret: '',
})

const kinds: CredentialKind[] = ['USERNAME_PASSWORD', 'SSH_KEY', 'BEARER_TOKEN', 'API_KEY', 'CLIENT_CERTIFICATE']
const scopes: CredentialProfileSummary['scopeType'][] = ['global', 'team', 'zone', 'host', 'plugin']
const requiresUsername = computed(() => form.value.kind === 'USERNAME_PASSWORD' || form.value.kind === 'SSH_KEY')
const requiresSecondarySecret = computed(() => form.value.kind === 'CLIENT_CERTIFICATE')
const canSubmit = computed(() => Boolean(
  form.value.name.trim()
  && form.value.primarySecret
  && (!requiresUsername.value || form.value.username.trim())
  && (!requiresSecondarySecret.value || form.value.secondarySecret)
  && (form.value.scopeType === 'global' || form.value.scopeId.trim()),
))

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

function secretValues(kind: CredentialKind, primary: string, secondary: string): Record<string, { plainText: string }> {
  if (kind === 'USERNAME_PASSWORD') return { password: { plainText: primary } }
  if (kind === 'SSH_KEY') return { privateKey: { plainText: primary } }
  if (kind === 'CLIENT_CERTIFICATE') return { certificate: { plainText: primary }, privateKey: { plainText: secondary } }
  return { token: { plainText: primary } }
}

async function submitCreate(): Promise<void> {
  if (!canSubmit.value) return
  saving.value = true
  error.value = ''
  try {
    await createCredential({
      name: form.value.name.trim(),
      kind: form.value.kind,
      scopeType: form.value.scopeType,
      scopeId: form.value.scopeType === 'global' ? undefined : form.value.scopeId.trim(),
      username: requiresUsername.value ? form.value.username.trim() : undefined,
      delivery: form.value.kind === 'API_KEY' ? { location: form.value.deliveryLocation, name: form.value.deliveryName.trim() } : undefined,
      secretValues: secretValues(form.value.kind, form.value.primarySecret, form.value.secondarySecret),
    })
    createOpen.value = false
    form.value = { name: '', kind: 'USERNAME_PASSWORD', scopeType: 'global', scopeId: '', username: '', deliveryLocation: 'header', deliveryName: 'X-API-Key', primarySecret: '', secondarySecret: '' }
    await load()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.errors.save')
  } finally {
    saving.value = false
  }
}

async function openDetail(id: string): Promise<void> {
  error.value = ''
  const [detailResult, usageResult] = await Promise.all([getCredential(id), getCredentialUsage(id)])
  selected.value = detailResult.data ?? null
  usage.value = usageResult.data ?? null
  rotatePrimary.value = ''
  rotateSecondary.value = ''
  detailOpen.value = true
}

async function submitRotate(): Promise<void> {
  if (!selected.value || !rotatePrimary.value || (selected.value.kind === 'CLIENT_CERTIFICATE' && !rotateSecondary.value)) return
  saving.value = true
  try {
    const result = await rotateCredential(selected.value.id, selected.value.version, secretValues(selected.value.kind, rotatePrimary.value, rotateSecondary.value))
    selected.value = result.data ?? selected.value
    rotatePrimary.value = ''
    rotateSecondary.value = ''
    await load()
  } finally {
    saving.value = false
  }
}

async function toggleStatus(): Promise<void> {
  if (!selected.value) return
  saving.value = true
  try {
    const status = selected.value.status === 'active' ? 'disabled' : 'active'
    const result = await updateCredentialStatus(selected.value.id, selected.value.version, status)
    selected.value = result.data ?? selected.value
    await load()
  } finally {
    saving.value = false
  }
}

async function removeSelected(): Promise<void> {
  if (!selected.value || (usage.value?.total ?? 0) > 0) return
  saving.value = true
  try {
    await deleteCredential(selected.value.id)
    detailOpen.value = false
    selected.value = null
    await load()
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
        <button class="gc-button gc-button--primary" type="button" @click="createOpen = true">{{ t('credentials.actions.create') }}</button>
      </template>
    </GcPageHeader>

    <section class="gc-card credentials-page__content">
      <p v-if="error" class="credentials-page__error">{{ error }}</p>
      <p v-if="loading" class="credentials-page__message">{{ t('common.loading') }}</p>
      <p v-else-if="items.length === 0" class="credentials-page__message">{{ t('credentials.empty') }}</p>
      <div v-else class="credentials-page__table-wrap">
        <table>
          <thead><tr><th>{{ t('credentials.columns.name') }}</th><th>{{ t('credentials.columns.kind') }}</th><th>{{ t('credentials.columns.scope') }}</th><th>{{ t('credentials.columns.username') }}</th><th>{{ t('credentials.columns.status') }}</th><th>{{ t('credentials.columns.updatedAt') }}</th></tr></thead>
          <tbody>
            <tr v-for="item in items" :key="item.id" tabindex="0" @click="openDetail(item.id)" @keydown.enter="openDetail(item.id)">
              <td><strong>{{ item.name }}</strong><small>{{ item.id }}</small></td>
              <td>{{ t(`credentials.kinds.${item.kind}`) }}</td>
              <td>{{ t(`credentials.scopes.${item.scopeType}`) }}</td>
              <td>{{ item.username ?? '—' }}</td>
              <td><GcStatusTag :status="item.status" /></td>
              <td>{{ formatMaybeLocalTime(item.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <GcModal v-model:open="createOpen" :title="t('credentials.create.title')" size="lg">
      <form class="credentials-form" @submit.prevent="submitCreate">
        <label><span>{{ t('credentials.fields.name') }}</span><input v-model="form.name" class="gc-input" required></label>
        <label><span>{{ t('credentials.fields.kind') }}</span><select v-model="form.kind"><option v-for="kind in kinds" :key="kind" :value="kind">{{ t(`credentials.kinds.${kind}`) }}</option></select></label>
        <label><span>{{ t('credentials.fields.scope') }}</span><select v-model="form.scopeType"><option v-for="scope in scopes" :key="scope" :value="scope">{{ t(`credentials.scopes.${scope}`) }}</option></select></label>
        <label v-if="form.scopeType !== 'global'"><span>{{ t('credentials.fields.scopeId') }}</span><input v-model="form.scopeId" class="gc-input" required></label>
        <label v-if="requiresUsername"><span>{{ t('credentials.fields.username') }}</span><input v-model="form.username" class="gc-input" required></label>
        <label v-if="form.kind === 'API_KEY'"><span>{{ t('credentials.fields.deliveryName') }}</span><input v-model="form.deliveryName" class="gc-input" required></label>
        <label><span>{{ t('credentials.fields.primarySecret') }}</span><textarea v-model="form.primarySecret" class="gc-input" required /></label>
        <label v-if="requiresSecondarySecret"><span>{{ t('credentials.fields.secondarySecret') }}</span><textarea v-model="form.secondarySecret" class="gc-input" required /></label>
      </form>
      <template #actions><button class="gc-button" type="button" @click="createOpen = false">{{ t('credentials.actions.close') }}</button><button class="gc-button gc-button--primary" type="button" :disabled="saving || !canSubmit" @click="submitCreate">{{ t('credentials.actions.save') }}</button></template>
    </GcModal>

    <GcModal v-model:open="detailOpen" :title="selected?.name ?? t('credentials.detail.title')" size="lg">
      <section v-if="selected" class="credentials-detail">
        <dl><div><dt>{{ t('credentials.columns.kind') }}</dt><dd>{{ t(`credentials.kinds.${selected.kind}`) }}</dd></div><div><dt>{{ t('credentials.columns.status') }}</dt><dd><GcStatusTag :status="selected.status" /></dd></div></dl>
        <section><h3>{{ t('credentials.rotate.title') }}</h3><textarea v-model="rotatePrimary" class="gc-input" :placeholder="t('credentials.placeholders.primarySecret')" /><textarea v-if="selected.kind === 'CLIENT_CERTIFICATE'" v-model="rotateSecondary" class="gc-input" :placeholder="t('credentials.placeholders.secondarySecret')" /><button class="gc-button" type="button" :disabled="saving || !rotatePrimary" @click="submitRotate">{{ t('credentials.actions.rotate') }}</button></section>
        <section><h3>{{ t('credentials.usage.title') }}</h3><p v-if="!usage?.total">{{ t('credentials.usage.empty') }}</p><ul v-else><li v-for="item in usage.items" :key="`${item.type}:${item.id}`">{{ item.type }} · {{ item.name ?? item.id }}</li></ul></section>
      </section>
      <template #actions><button class="gc-button" type="button" :disabled="saving" @click="toggleStatus">{{ selected?.status === 'active' ? t('credentials.actions.disable') : t('credentials.actions.enable') }}</button><button class="gc-button gc-button--danger" type="button" :disabled="saving || (usage?.total ?? 0) > 0" @click="removeSelected">{{ t('credentials.actions.delete') }}</button><button class="gc-button" type="button" @click="detailOpen = false">{{ t('credentials.actions.close') }}</button></template>
    </GcModal>
  </section>
</template>

<style scoped>
.credentials-page { display: grid; gap: var(--gc-space-5); }
.credentials-page__content { padding: var(--gc-space-5); }
.credentials-page__message { margin: 0; color: var(--gc-color-text-muted); }
.credentials-page__error { color: var(--gc-color-danger); }
.credentials-page__table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: var(--gc-space-3); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); text-align: left; }
th { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
td { color: var(--gc-color-text); }
tbody tr { cursor: pointer; }
td:first-child { display: grid; gap: var(--gc-space-1); }
td small, dt { color: var(--gc-color-text-muted); }
.credentials-form, .credentials-detail, .credentials-detail section { display: grid; gap: var(--gc-space-3); }
.credentials-form label { display: grid; gap: var(--gc-space-2); }
.credentials-form select, .credentials-detail textarea { padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); color: var(--gc-color-text); }
.credentials-form textarea, .credentials-detail textarea { min-height: var(--gc-size-control-xl); }
.credentials-detail dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.credentials-detail dl div { padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); }
.credentials-detail dd { margin: var(--gc-space-1) 0 0; }
</style>
