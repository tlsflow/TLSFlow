<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { GcAcmeDnsCredentialSelect, GcButton, GcModal } from '@/design-system/components'

type AcmeStatus = 'READY' | 'BLOCKED' | 'UNKNOWN'
type AcmeProvider = InternalCaRecord & {
  id?: string
  name?: string
  endpoint?: string
  status?: string
  configuration?: InternalCaRecord
}

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  created: []
}>()

const { t } = useI18n()
const contextPending = ref(false)
const actionPending = ref(false)
const formError = ref('')
const status = ref<AcmeStatus>('UNKNOWN')
const providerName = ref('')
const hostProviderId = ref('')
const providers = ref<AcmeProvider[]>([])
const dnsProviders = ref<InternalCaRecord[]>([])
const termsOpen = ref(false)
const termsRead = ref(false)
let activeContextLoad: Promise<void> | null = null

const draft = reactive({
  name: '',
  providerId: '',
  domains: '',
  contactEmail: '',
  challengeType: 'http-01',
  dnsProvider: '',
  dnsCredentialId: '',
  dnsPropagationSeconds: 60,
  keyType: 'rsa',
  autoRenew: true,
  renewalWindowDays: 7,
  termsOfServiceAgreed: false,
})

const modelOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
})

const activeProviders = computed(() => providers.value.filter((item) => (
  text(item.type, 'acme') === 'acme' && text(item.status, 'active') === 'active'
)))
const defaultProvider = computed(() => activeProviders.value.find((item) => providerConfig(item).isDefault === true) ?? activeProviders.value[0])
const selectedProvider = computed(() => activeProviders.value.find((item) => text(item.id) === draft.providerId) ?? defaultProvider.value)
const selectedDnsProvider = computed(() => dnsProviders.value.find((item) => text(item.id) === draft.dnsProvider))
const canSubmit = computed(() => {
  if (status.value !== 'READY' || !normalizeDomains(draft.domains).length || !draft.contactEmail.trim()) return false
  return draft.challengeType !== 'dns-01' || Boolean(draft.dnsProvider && draft.dnsCredentialId)
})

// Provider 列表是异步加载的，始终把表单值对齐到当前可选项，避免原生 required
// 在选项已经渲染但 v-model 仍为空时拦截提交。
watch(activeProviders, (available) => {
  const current = text(draft.providerId)
  if (current && available.some((item) => text(item.id) === current)) return
  draft.providerId = text((available.find((item) => providerConfig(item).isDefault === true) ?? available[0])?.id, hostProviderId.value)
}, { immediate: true })

watch(
  () => props.open,
  (open) => {
    if (open) void prepareCreate()
  },
  { immediate: true },
)

async function prepareCreate(): Promise<void> {
  resetDraft()
  formError.value = ''
  await loadRequestContext()
  draft.providerId = text(defaultProvider.value?.id, hostProviderId.value)
}

async function loadRequestContext(): Promise<void> {
  if (activeContextLoad) return activeContextLoad
  contextPending.value = true
  const request = loadRequestContextOnce()
  activeContextLoad = request
  try {
    await request
  } finally {
    if (activeContextLoad === request) activeContextLoad = null
    contextPending.value = false
  }
}

async function loadRequestContextOnce(): Promise<void> {
  const [statusResult, providerResult, dnsProviderResult] = await Promise.allSettled([
    internalCaApi.getAcmeStatus(),
    internalCaApi.listAcmeProviders(),
    internalCaApi.listAcmeDnsProviders(),
  ])
  if (statusResult.status === 'fulfilled') {
    const statusData = statusResult.value.data ?? {}
    status.value = normalizeStatus(statusData.status)
    const hostProvider = recordValue(statusData.provider)
    hostProviderId.value = text(hostProvider.id)
    providerName.value = text(hostProvider.name, t('acme.issuer.letsencrypt'))
    if (hostProviderId.value) draft.providerId = hostProviderId.value
  } else {
    status.value = 'UNKNOWN'
  }
  if (providerResult.status === 'fulfilled') {
    const data = providerResult.value.data ?? {}
    providers.value = Array.isArray(data) ? [...data] : Array.isArray(data.items) ? [...data.items] : []
    if (!providerName.value && defaultProvider.value) providerName.value = text(defaultProvider.value.name, t('acme.issuer.letsencrypt'))
  }
  if (dnsProviderResult.status === 'fulfilled') dnsProviders.value = readRecords(dnsProviderResult.value.data)
  const failures = [statusResult, providerResult, dnsProviderResult]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failures.length && status.value !== 'READY') {
    const first = failures[0]?.reason
    formError.value = first instanceof ApiClientError ? first.message : t('acme.messages.loadFailed')
  }
}

function resetDraft(): void {
  Object.assign(draft, {
    name: '',
    providerId: text(defaultProvider.value?.id),
    domains: '',
    contactEmail: '',
    challengeType: 'http-01',
    dnsProvider: '',
    dnsCredentialId: '',
    dnsPropagationSeconds: 60,
    keyType: 'rsa',
    autoRenew: true,
    renewalWindowDays: 7,
    termsOfServiceAgreed: false,
  })
}

function openTerms(): void {
  termsRead.value = false
  termsOpen.value = true
}

function confirmTerms(): void {
  if (!termsRead.value) return
  draft.termsOfServiceAgreed = true
  termsOpen.value = false
  formError.value = ''
}

async function submitCreate(): Promise<void> {
  if (!canSubmit.value) {
    formError.value = draft.challengeType === 'dns-01' ? t('acme.messages.dnsFieldsRequired') : t('acme.messages.requiredFields')
    return
  }
  if (!draft.termsOfServiceAgreed) {
    formError.value = t('acme.messages.termsRequired')
    openTerms()
    return
  }
  actionPending.value = true
  formError.value = ''
  try {
    await internalCaApi.createAcmeCertificate({
      name: draft.name.trim() || undefined,
      providerId: text(selectedProvider.value?.id, text(draft.providerId, hostProviderId.value)) || undefined,
      domains: normalizeDomains(draft.domains),
      contactEmail: draft.contactEmail.trim(),
      challengeType: draft.challengeType,
      dnsProvider: draft.challengeType === 'dns-01' ? draft.dnsProvider : undefined,
      dnsCredentialId: draft.challengeType === 'dns-01' ? draft.dnsCredentialId : undefined,
      dnsPropagationSeconds: draft.challengeType === 'dns-01' ? draft.dnsPropagationSeconds : undefined,
      keyType: draft.keyType,
      autoRenew: draft.autoRenew,
      renewalWindowDays: draft.renewalWindowDays,
      termsOfServiceAgreed: true,
    })
    modelOpen.value = false
    notify(t('acme.messages.created'), 'success')
    emit('created')
  } catch (caught) {
    formError.value = caught instanceof ApiClientError ? caught.message : t('acme.messages.actionFailed')
  } finally {
    actionPending.value = false
  }
}

function notify(message: string, tone: 'success' | 'warning' | 'danger' | 'info'): void {
  window.dispatchEvent(new CustomEvent('gcac:toast', { detail: { message, tone } }))
}

function providerConfig(provider: AcmeProvider | undefined): InternalCaRecord {
  return recordValue(provider?.configuration)
}

function challengeLabel(value: unknown): string {
  const key = text(value, 'http-01')
  return t(`acme.challengeTypes.${key}`, key)
}

function normalizeDomains(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map((item) => item.trim().toLowerCase()).filter(Boolean))]
}

function normalizeStatus(value: unknown): AcmeStatus {
  return value === 'READY' || value === 'BLOCKED' ? value : 'UNKNOWN'
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function recordValue(value: unknown): InternalCaRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as InternalCaRecord : {}
}

function readRecords(value: unknown): InternalCaRecord[] {
  if (Array.isArray(value)) return value.map(recordValue).filter((item) => Object.keys(item).length > 0)
  if (recordValue(value).items && Array.isArray(recordValue(value).items)) return readRecords(recordValue(value).items)
  return []
}
</script>

<template>
  <GcModal v-model:open="modelOpen" size="lg" :title="t('acme.form.title')" :busy="contextPending || actionPending" :error="formError">
    <form class="acme-page__form" @submit.prevent="submitCreate">
      <label class="gc-form-field acme-page__field--wide"><span>{{ t('acme.fields.domains') }}</span><textarea v-model="draft.domains" :placeholder="t('acme.placeholders.domains')" required /></label>
      <label class="gc-form-field">
        <span>{{ t('acme.fields.issuer') }}</span>
        <select v-model="draft.providerId" required>
          <option v-for="provider in activeProviders" :key="text(provider.id)" :value="text(provider.id)">{{ text(provider.name, text(provider.id)) }}</option>
          <option v-if="!activeProviders.length" :value="hostProviderId">{{ providerName || t('acme.issuer.letsencrypt') }}</option>
        </select>
      </label>
      <label class="gc-form-field"><span>{{ t('acme.fields.name') }}</span><input v-model="draft.name" :placeholder="t('acme.placeholders.name')" /></label>
      <label class="gc-form-field"><span>{{ t('acme.fields.email') }}</span><input v-model="draft.contactEmail" type="email" :placeholder="t('acme.placeholders.email')" required /></label>
      <fieldset class="acme-page__challenge-field">
        <legend>{{ t('acme.fields.challengeType') }}</legend>
        <div class="acme-page__challenge-options">
          <label><input v-model="draft.challengeType" type="radio" value="http-01" />{{ challengeLabel('http-01') }}</label>
          <label><input v-model="draft.challengeType" type="radio" value="dns-01" />{{ challengeLabel('dns-01') }}</label>
        </div>
      </fieldset>
      <section v-if="draft.challengeType === 'dns-01'" class="acme-page__dns-fields acme-page__field--wide">
        <label class="gc-form-field">
          <span>{{ t('acme.fields.dnsProvider') }}</span>
          <select v-model="draft.dnsProvider" required>
            <option value="" disabled>{{ t('acme.placeholders.dnsProvider') }}</option>
            <option v-for="provider in dnsProviders" :key="text(provider.id)" :value="text(provider.id)">{{ text(provider.name, text(provider.id)) }}</option>
          </select>
        </label>
        <label class="gc-form-field"><span>{{ t('acme.fields.dnsPropagation') }}</span><input v-model.number="draft.dnsPropagationSeconds" type="number" min="0" max="7200" required /></label>
        <GcAcmeDnsCredentialSelect
          v-if="selectedDnsProvider"
          v-model="draft.dnsCredentialId"
          class="acme-page__field--wide"
          :provider-id="text(selectedDnsProvider.id)"
          :provider-name="text(selectedDnsProvider.name, text(selectedDnsProvider.id))"
          :credential-template="text(selectedDnsProvider.credentialTemplate)"
          required
        />
      </section>
      <label class="gc-form-field"><span>{{ t('acme.fields.keyType') }}</span><select v-model="draft.keyType"><option value="rsa">{{ t('acme.keyTypes.rsa') }}</option><option value="ecdsa">{{ t('acme.keyTypes.ecdsa') }}</option></select></label>
      <label class="gc-form-field"><span>{{ t('acme.fields.renewalWindowDays') }}</span><input v-model.number="draft.renewalWindowDays" type="number" min="1" max="90" required /></label>
      <label class="acme-page__checkbox"><input v-model="draft.autoRenew" type="checkbox" /><span>{{ t('acme.fields.autoRenew') }}</span></label>
      <label class="acme-page__checkbox acme-page__field--wide">
        <input :checked="draft.termsOfServiceAgreed" type="checkbox" @click.prevent="openTerms" />
        <span>{{ t('acme.fields.terms') }}</span>
        <GcButton variant="secondary" :disabled="actionPending" @click.prevent="openTerms">{{ t('acme.actions.readTerms') }}</GcButton>
      </label>
      <footer class="acme-page__form-actions acme-page__field--wide"><GcButton variant="secondary" :disabled="actionPending" @click="modelOpen = false">{{ t('acme.actions.close') }}</GcButton><GcButton variant="primary" type="submit" :loading="actionPending" :disabled="!canSubmit">{{ t('acme.form.submit') }}</GcButton></footer>
    </form>
  </GcModal>

  <GcModal v-model:open="termsOpen" size="lg" :title="t('acme.terms.title')" :description="t('acme.terms.description')">
    <article class="acme-page__terms">
      <p>{{ t('acme.terms.intro') }}</p>
      <p>{{ t('acme.terms.responsibility') }}</p>
      <p>{{ t('acme.terms.credentials') }}</p>
      <p>{{ t('acme.terms.renewal') }}</p>
      <label class="acme-page__checkbox"><input v-model="termsRead" type="checkbox" /><span>{{ t('acme.terms.readConfirm') }}</span></label>
    </article>
    <template #actions><GcButton variant="secondary" @click="termsOpen = false">{{ t('acme.actions.close') }}</GcButton><GcButton variant="primary" :disabled="!termsRead" @click="confirmTerms">{{ t('acme.terms.confirm') }}</GcButton></template>
  </GcModal>
</template>

<style scoped>
.acme-page__form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.acme-page__field--wide { grid-column: 1 / -1; }
.acme-page__form textarea { min-height: var(--gc-control-height-xl); resize: vertical; }
.acme-page__checkbox, .acme-page__form-actions { display: flex; gap: var(--gc-space-3); align-items: center; }
.acme-page__checkbox { min-height: var(--gc-control-height-md); flex-wrap: wrap; }
.acme-page__form-actions { justify-content: flex-end; padding-top: var(--gc-space-3); border-top: var(--gc-border-width-default) solid var(--gc-color-border); }
.acme-page__challenge-field { display: grid; gap: var(--gc-space-1); margin: 0; padding: 0; border: 0; }
.acme-page__challenge-field legend { margin: 0 0 var(--gc-space-1); padding: 0; color: var(--gc-color-text-muted); font-weight: var(--gc-font-weight-semibold); }
.acme-page__challenge-options { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gc-space-4); min-height: var(--gc-control-height-md); }
.acme-page__challenge-field label { display: inline-flex; gap: var(--gc-space-2); align-items: center; min-height: var(--gc-control-height-md); color: var(--gc-color-text); }
.acme-page__dns-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); padding: var(--gc-space-4); border-inline-start: var(--gc-border-width-strong) solid var(--gc-color-info-border); background: var(--gc-color-info-bg); }
.acme-page__terms { display: grid; gap: var(--gc-space-3); }
.acme-page__terms p { margin: 0; color: var(--gc-color-text-muted); }
@media (max-width: 48rem) {
  .acme-page__form, .acme-page__dns-fields { grid-template-columns: 1fr; }
}
</style>
