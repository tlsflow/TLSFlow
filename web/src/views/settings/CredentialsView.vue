<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createCredential,
  acquireBrowserCredentialSession,
  cancelBrowserCredentialSession,
  createBrowserCredentialSession,
  deleteCredential,
  getBrowserCredentialSession,
  getCredential,
  getCredentialUsage,
  getCredentialHealth,
  listCredentialHealthChecks,
  listCredentials,
  triggerCredentialHealthCheck,
  updateCredential,
  updateCredentialStatus,
  type CredentialKind,
  type CredentialProfileDetail,
  type CredentialProfileSummary,
  type CredentialSecretValueInput,
  type CredentialUsage,
  type CredentialHealthState,
  type CredentialHealthCheckRecord,
  type BrowserCredentialSession,
} from '@/api/modules/credentials.api'
import { GcModal, GcPagination, GcPageToolbar, GcSecretInput, GcStatusTag } from '@/design-system/components'
import { getUnifiedPluginUiResources, listPluginCatalog } from '@/api/modules/plugins.api'
import type { PluginCatalogItem } from '@/api/generated/schemas'
import { internalCaApi, type InternalCaRecord } from '@/api/modules/internal-ca.api'
import { formatBrowserLocalTime, formatMaybeLocalTime, getExpiryRemaining } from '@/utils/browser-local-time'

type EditorMode = 'create' | 'edit'
type UsageItem = CredentialUsage['items'][number]
type DurationInput = string | number

interface CloudCredentialSlot {
  name: string
  secretType: 'password' | 'api_token' | 'private_key'
  required: boolean
  labelKey: string
}

interface CloudProviderDefinition {
  pluginId: string
  pluginVersionId: string
  displayName: string
  credentialSlots: CloudCredentialSlot[]
  messages: Record<string, string>
  available: boolean
  unavailableReason?: string
}

interface CredentialFormState {
  name: string
  kind: CredentialKind
  scopeType: CredentialProfileSummary['scopeType']
  scopeId: string
  username: string
  deliveryLocation: 'header' | 'query'
  deliveryName: string
  dnsProviderId: string
  cloudProviderKey: string
  cloudSecretValues: Record<string, string>
  primarySecret: string
  secondarySecret: string
  validityDays: DurationInput
  validityHours: DurationInput
  validityMinutes: DurationInput
  browserLoginUrl: string
}

interface BrowserOptionItem {
  id: string
  label: string
}

interface DnsProviderOption {
  id: string
  name: string
}

const { t, locale } = useI18n()
const loading = ref(false)
const loadingSelection = ref(false)
const saving = ref(false)
const error = ref('')
const items = ref<CredentialProfileSummary[]>([])
const page = ref(1)
const pageSize = ref(20)
const visibleItems = computed<CredentialProfileSummary[]>(() => {
  const start = (page.value - 1) * pageSize.value
  return items.value.slice(start, start + pageSize.value)
})

function changePage(nextPage: number): void {
  const target = Math.min(Math.max(1, nextPage), Math.max(1, Math.ceil(items.value.length / pageSize.value)))
  if (target !== page.value) page.value = target
}

function changePageSize(nextPageSize: number): void {
  if (nextPageSize <= 0 || nextPageSize === pageSize.value) return
  pageSize.value = nextPageSize
  page.value = 1
}
const editorOpen = ref(false)
const deleteOpen = ref(false)
const editorMode = ref<EditorMode>('create')
const selected = ref<CredentialProfileDetail | null>(null)
const usage = ref<CredentialUsage | null>(null)
const healthModalOpen = ref(false)
const healthLoading = ref(false)
const healthTesting = ref(false)
const healthError = ref('')
const healthCredential = ref<CredentialProfileSummary | null>(null)
const healthState = ref<CredentialHealthState | null>(null)
const healthChecks = ref<CredentialHealthCheckRecord[]>([])
const form = ref<CredentialFormState>(emptyForm())
const cloudProviders = ref<CloudProviderDefinition[]>([])
const cloudProvidersLoading = ref(false)
const cloudProvidersError = ref('')
const dnsProviders = ref<DnsProviderOption[]>([])
const dnsProvidersLoading = ref(false)
const initialValidityDays = ref('')
const initialValidityHours = ref('')
const initialValidityMinutes = ref('')
const initialExpiresAt = ref<string | null>(null)
const now = ref(Date.now())
let remainingTimer: ReturnType<typeof setInterval> | undefined
let browserPollTimer: number | undefined

const kinds: CredentialKind[] = ['USERNAME_PASSWORD', 'SSH_KEY', 'BEARER_TOKEN', 'API_KEY', 'CLIENT_CERTIFICATE', 'DNS_PROVIDER', 'CLOUD_PROVIDER', 'BROWSER_SESSION']
const scopes: CredentialProfileSummary['scopeType'][] = ['global', 'team', 'zone', 'host', 'plugin']
const isEditing = computed(() => editorMode.value === 'edit')
const requiresUsername = computed(() => requiresUsernameFor(form.value.kind))
const isDnsProviderCredential = computed(() => form.value.kind === 'DNS_PROVIDER')
const isCloudProviderCredential = computed(() => form.value.kind === 'CLOUD_PROVIDER')
const isBrowserSessionCredential = computed(() => form.value.kind === 'BROWSER_SESSION')
const requiresSecondarySecret = computed(() => form.value.kind === 'CLIENT_CERTIFICATE')
const selectedCloudProvider = computed(() => cloudProviders.value.find((provider) => provider.pluginId === form.value.cloudProviderKey))
const cloudProviderSlots = computed(() => selectedCloudProvider.value?.credentialSlots ?? [])
const cloudProviderReady = computed(() => Boolean(selectedCloudProvider.value?.available && cloudProviderSlots.value.length > 0))
const dnsProviderOptions = computed(() => {
  const currentId = form.value.dnsProviderId.trim()
  if (!currentId || dnsProviders.value.some((item) => item.id === currentId)) return dnsProviders.value
  return [{ id: currentId, name: currentId }, ...dnsProviders.value]
})
const editorTitle = computed(() => t(isEditing.value ? 'credentials.edit.title' : 'credentials.create.title'))
const editorDescription = computed(() => t('credentials.create.description'))
const validityDurationValid = computed(() => {
  const days = parseDurationPart(form.value.validityDays)
  const hours = parseDurationPart(form.value.validityHours, isBrowserSessionCredential.value ? 23 : undefined)
  const minutes = parseDurationPart(form.value.validityMinutes, isBrowserSessionCredential.value ? 59 : undefined)
  return days !== null && hours !== null && minutes !== null
})
const canSubmit = computed(() => {
  const hasRequiredFields = Boolean(
    form.value.name.trim()
    && (!requiresUsername.value || form.value.username.trim())
    && (form.value.scopeType === 'global' || form.value.scopeId.trim()),
  )
  if (!hasRequiredFields || !validityDurationValid.value) return false
  if (isDnsProviderCredential.value && !form.value.dnsProviderId.trim()) return false
  if (isCloudProviderCredential.value) {
    if (!cloudProviderReady.value) return false
    if (isEditing.value) return true
    return cloudProviderSlots.value.every((slot) => !slot.required || Boolean(form.value.cloudSecretValues[slot.name]?.trim()))
  }
  if (isEditing.value) return true
  if (isBrowserSessionCredential.value) return Boolean(form.value.browserLoginUrl.trim())
  return Boolean(form.value.primarySecret && (!requiresSecondarySecret.value || form.value.secondarySecret))
})
const usageGroups = computed(() => ({
  devices: usage.value?.items.filter((item) => item.type === 'DEVICE') ?? [],
  workflows: usage.value?.items.filter((item) => item.type === 'DEPLOYMENT_PLAN') ?? [],
  plugins: usage.value?.items.filter((item) => item.type === 'PLUGIN_BINDING') ?? [],
  acmeCertificates: usage.value?.items.filter((item) => item.type === 'ACME_RENEWAL_POLICY') ?? [],
  cloudAccounts: usage.value?.items.filter((item) => item.type === 'CLOUD_ACCOUNT_ASSET') ?? [],
  browserSessions: usage.value?.items.filter((item) => item.type === 'BROWSER_CREDENTIAL_SESSION') ?? [],
}))
const visibleUsageGroups = computed(() =>
  (['devices', 'workflows', 'plugins', 'acmeCertificates', 'cloudAccounts', 'browserSessions'] as const)
    .filter((group) => usageGroups.value[group].length > 0))
const browserPlugins = ref<BrowserOptionItem[]>([])
const browserModalOpen = ref(false)
const browserSaveSuccessOpen = ref(false)
const browserAssetId = ref('')
const browserCredentialId = ref('')
const browserPluginVersionId = ref('')
const browserLoginUrl = ref('')
const browserTtlSeconds = ref(1800)
const browserSharePassword = ref('')
const browserSession = ref<BrowserCredentialSession | null>(null)
const browserCopied = ref(false)
const browserLoading = ref(false)
const browserAcquiring = ref(false)
const browserError = ref('')
const browserCanCreate = computed(() => Boolean(
  browserLoginUrl.value.trim()
  && browserPluginVersionId.value
  && browserSharePassword.value.length >= 8
  && Number.isInteger(browserTtlSeconds.value)
  && browserTtlSeconds.value >= 60
  && browserTtlSeconds.value <= 3600
  && !browserLoading.value
  && !browserSession.value,
))
const browserCanAcquire = computed(() => browserSession.value?.status === 'READY_FOR_ACQUISITION' && !browserAcquiring.value)
const browserCanCancel = computed(() => Boolean(
  browserSession.value
  && !['SAVED', 'FAILED', 'EXPIRED', 'CLOSED'].includes(browserSession.value.status),
))

function emptyForm(): CredentialFormState {
  return {
    name: '',
    kind: 'USERNAME_PASSWORD',
    scopeType: 'global',
    scopeId: '',
    username: '',
    deliveryLocation: 'header',
    deliveryName: 'X-API-Key',
    dnsProviderId: '',
    cloudProviderKey: '',
    cloudSecretValues: {},
    primarySecret: '',
    secondarySecret: '',
    validityDays: '',
    validityHours: '',
    validityMinutes: '',
    browserLoginUrl: '',
  }
}

function readBrowserCapabilityKey(value: unknown): string {
  return value && typeof value === 'object' && 'key' in value
    ? String((value as { key?: unknown }).key ?? '')
    : String(value ?? '')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readCloudCapabilityKey(value: unknown): string {
  const record = asRecord(value)
  return typeof record.key === 'string' ? record.key : String(value ?? '')
}

function readCloudSlots(value: unknown): CloudCredentialSlot[] {
  const contract = asRecord(value)
  const slots = Array.isArray(contract.slots) ? contract.slots : []
  return slots.flatMap((item) => {
    const slot = asRecord(item)
    if (typeof slot.name !== 'string' || typeof slot.labelKey !== 'string') return []
    const secretType = slot.secretType
    if (secretType !== 'password' && secretType !== 'api_token' && secretType !== 'private_key') return []
    return [{
      name: slot.name,
      secretType,
      required: slot.required === true,
      labelKey: slot.labelKey,
    }]
  })
}

function readCloudMessages(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(asRecord(value)).flatMap(([key, message]) => typeof message === 'string' ? [[key, message]] : []))
}

function cloudMessage(provider: CloudProviderDefinition | undefined, key: string): string {
  return provider?.messages[key] ?? t(key)
}

function catalogPluginVersionId(item: PluginCatalogItem): string {
  return String(item.pluginVersionId ?? item.id ?? '')
}

async function loadCloudProviders(preferredPluginId = form.value.cloudProviderKey): Promise<void> {
  cloudProvidersLoading.value = true
  cloudProvidersError.value = ''
  try {
    const catalogResult = await listPluginCatalog({ page: 1, pageSize: 200, filters: { locale: locale.value } })
    const candidates = (catalogResult.data?.items ?? []).filter((item) =>
      Array.isArray(item.capabilities)
      && item.capabilities.some((capability) => readCloudCapabilityKey(capability) === 'cloud.service.connection-test'))
    const loaded = await Promise.all(candidates.map(async (item): Promise<CloudProviderDefinition> => {
      const pluginVersionId = catalogPluginVersionId(item)
      try {
        const resourceResult = await getUnifiedPluginUiResources(pluginVersionId, locale.value)
        const payload = asRecord(resourceResult.data)
        const forms = asRecord(payload.forms)
        const cloudForm = asRecord(forms.cloud)
        const contract = asRecord(cloudForm.credentialContract)
        const slots = readCloudSlots(contract)
        const localeResource = asRecord(payload.locale)
        const messages = readCloudMessages(localeResource.messages)
        const displayName = typeof item.displayName === 'string' && item.displayName.trim()
          ? item.displayName
          : (typeof item.displayNameKey === 'string' ? (messages[item.displayNameKey] ?? item.displayNameKey) : item.pluginId)
        if (slots.length === 0) {
          return { pluginId: item.pluginId, pluginVersionId, displayName, credentialSlots: [], messages, available: false, unavailableReason: 'PLUGIN_CREDENTIAL_CONTRACT_MISSING' }
        }
        return { pluginId: item.pluginId, pluginVersionId, displayName, credentialSlots: slots, messages, available: true }
      } catch (cause) {
        return {
          pluginId: item.pluginId,
          pluginVersionId,
          displayName: item.displayName ?? item.pluginId,
          credentialSlots: [],
          messages: {},
          available: false,
          unavailableReason: cause instanceof Error ? cause.message : 'PLUGIN_UI_RESOURCE_UNAVAILABLE',
        }
      }
    }))
    cloudProviders.value = loaded.sort((left, right) => left.displayName.localeCompare(right.displayName))
    if (!cloudProviders.value.some((provider) => provider.pluginId === form.value.cloudProviderKey)) {
      form.value.cloudProviderKey = cloudProviders.value.find((provider) => provider.pluginId === preferredPluginId && provider.available)?.pluginId
        ?? cloudProviders.value.find((provider) => provider.available)?.pluginId
        ?? ''
    }
  } catch (cause) {
    cloudProviders.value = []
    cloudProvidersError.value = cause instanceof Error ? cause.message : t('credentials.cloudProviders.errors.load')
  } finally {
    cloudProvidersLoading.value = false
  }
}

function readMetadataString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : ''
}

function generateBrowserPassword(): void {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_'
  const values = new Uint32Array(16)
  crypto.getRandomValues(values)
  browserSharePassword.value = Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}

async function loadBrowserPlugins(preferredPluginVersionId = ''): Promise<void> {
  browserLoading.value = true
  browserError.value = ''
  try {
    const result = await listPluginCatalog({ page: 1, pageSize: 200 })
    browserPlugins.value = (result.data?.items ?? [])
      .filter((item) => Array.isArray(item.capabilities) && item.capabilities.some((capability) => readBrowserCapabilityKey(capability) === 'credential.acquire'))
      .map((item) => ({
        id: String(item.pluginVersionId ?? item.id ?? ''),
        label: String(item.displayName ?? item.name ?? item.pluginId ?? item.id ?? ''),
      }))
      .filter((item) => item.id)
    if (!browserPlugins.value.some((item) => item.id === browserPluginVersionId.value)) {
      browserPluginVersionId.value = browserPlugins.value.some((item) => item.id === preferredPluginVersionId)
        ? preferredPluginVersionId
        : browserPlugins.value[0]?.id ?? ''
    }
  } catch (cause) {
    browserError.value = cause instanceof Error ? cause.message : t('credentials.browser.errors.load')
  } finally {
    browserLoading.value = false
  }
}

function openBrowserAcquire(item: CredentialProfileSummary): void {
  if (browserSession.value && !['SAVED', 'FAILED', 'EXPIRED', 'CLOSED'].includes(browserSession.value.status)) {
    browserModalOpen.value = true
    return
  }
  browserSession.value = null
  browserModalOpen.value = true
  browserSaveSuccessOpen.value = false
  browserCredentialId.value = item.id
  browserAssetId.value = readMetadataString(item.metadata, 'assetId')
  browserPluginVersionId.value = readMetadataString(item.metadata, 'pluginVersionId')
  browserLoginUrl.value = readMetadataString(item.metadata, 'browserLoginUrl')
  browserTtlSeconds.value = 1800
  browserSharePassword.value = ''
  browserCopied.value = false
  browserError.value = ''
  void loadBrowserPlugins(browserPluginVersionId.value)
}

async function createBrowserSession(): Promise<void> {
  if (!browserCanCreate.value) return
  browserLoading.value = true
  browserError.value = ''
  try {
    const result = await createBrowserCredentialSession({
      credentialId: browserCredentialId.value,
      ...(browserAssetId.value ? { assetId: browserAssetId.value } : {}),
      pluginVersionId: browserPluginVersionId.value,
      loginUrl: browserLoginUrl.value.trim(),
      ttlSeconds: browserTtlSeconds.value,
      sharePassword: browserSharePassword.value,
      screenWidth: Math.round(window.innerWidth),
      screenHeight: Math.round(window.innerHeight),
    })
    browserSession.value = requireBrowserSession(result.data)
    startBrowserPolling()
  } catch (cause) {
    browserError.value = cause instanceof Error ? cause.message : t('credentials.browser.errors.create')
  } finally {
    browserLoading.value = false
  }
}

async function refreshBrowserSession(): Promise<void> {
  if (!browserSession.value) return
  const result = await getBrowserCredentialSession(browserSession.value.id)
  browserSession.value = requireBrowserSession(result.data, browserSession.value)
}

async function acquireBrowserSession(): Promise<void> {
  if (!browserSession.value || !browserCanAcquire.value) return
  browserAcquiring.value = true
  browserError.value = ''
  try {
    const result = await acquireBrowserCredentialSession(browserSession.value.id)
    browserSession.value = requireBrowserSession(result.data, browserSession.value)
    stopBrowserPolling()
    browserSaveSuccessOpen.value = true
    await load().catch(() => undefined)
  } catch (cause) {
    browserError.value = cause instanceof Error ? cause.message : t('credentials.browser.errors.acquire')
    await refreshBrowserSession().catch(() => undefined)
  } finally {
    browserAcquiring.value = false
  }
}

function closeBrowserSaveSuccess(): void {
  browserSaveSuccessOpen.value = false
  browserModalOpen.value = false
  browserSession.value = null
  browserCredentialId.value = ''
}

function updateBrowserSaveSuccessOpen(open: boolean): void {
  browserSaveSuccessOpen.value = open
  if (!open) closeBrowserSaveSuccess()
}

async function cancelBrowserSession(): Promise<void> {
  if (!browserSession.value || !browserCanCancel.value) return
  browserLoading.value = true
  browserError.value = ''
  try {
    const result = await cancelBrowserCredentialSession(browserSession.value.id)
    browserSession.value = requireBrowserSession(result.data, browserSession.value)
  } catch (cause) {
    browserError.value = cause instanceof Error ? cause.message : t('credentials.browser.errors.cancel')
  } finally {
    browserLoading.value = false
  }
}

async function copyBrowserLink(): Promise<void> {
  if (!browserSession.value?.temporaryUrl) return
  try {
    await navigator.clipboard.writeText(browserSession.value.temporaryUrl)
    browserCopied.value = true
    window.setTimeout(() => { browserCopied.value = false }, 2000)
  } catch {
    browserError.value = t('credentials.browser.errors.copy')
  }
}

function openBrowserLink(): void {
  if (!browserSession.value?.temporaryUrl) return
  window.open(browserSession.value.temporaryUrl, '_blank', 'noopener,noreferrer')
}

function startNewBrowserSession(): void {
  stopBrowserPolling()
  browserSaveSuccessOpen.value = false
  browserSession.value = null
  browserSharePassword.value = ''
  browserCopied.value = false
  browserError.value = ''
}

function startBrowserPolling(): void {
  stopBrowserPolling()
  browserPollTimer = window.setInterval(() => {
    if (!browserSession.value || ['SAVED', 'FAILED', 'EXPIRED', 'CLOSED'].includes(browserSession.value.status)) {
      stopBrowserPolling()
      return
    }
    void refreshBrowserSession().catch(() => undefined)
  }, 5000)
}

function stopBrowserPolling(): void {
  if (browserPollTimer !== undefined) window.clearInterval(browserPollTimer)
  browserPollTimer = undefined
}

function requireBrowserSession(value: BrowserCredentialSession | undefined, previous?: BrowserCredentialSession): BrowserCredentialSession {
  if (!value) throw new Error(t('credentials.browser.errors.emptyResponse'))
  return {
    ...value,
    ...(value.temporaryUrl || !previous?.temporaryUrl ? {} : { temporaryUrl: previous.temporaryUrl }),
  }
}

function browserSessionLocalTime(value: string | undefined): string {
  return value ? formatBrowserLocalTime(value, { includeSeconds: false }) || t('common.notAvailable') : t('common.notAvailable')
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
    dnsProviderId: readMetadataString(detail.metadata, 'providerId'),
    cloudProviderKey: typeof detail.metadata.providerKey === 'string' ? detail.metadata.providerKey : '',
    cloudSecretValues: {},
    primarySecret: '',
    secondarySecret: '',
    ...expiryToDuration(detail.expiresAt, detail.kind),
    browserLoginUrl: readMetadataString(detail.metadata, 'browserLoginUrl'),
  }
}

function expiryToDuration(expiresAt: string | undefined, kind: CredentialKind): { validityDays: string; validityHours: string; validityMinutes: string } {
  if (!expiresAt) return { validityDays: '', validityHours: '', validityMinutes: '' }
  const difference = Date.parse(expiresAt) - Date.now()
  if (!Number.isFinite(difference) || difference <= 0) return { validityDays: '0', validityHours: '0', validityMinutes: '0' }
  if (kind !== 'BROWSER_SESSION') {
    return { validityDays: String(Math.ceil(difference / (24 * 60 * 60 * 1000))), validityHours: '', validityMinutes: '' }
  }
  const totalMinutes = Math.max(1, Math.ceil(difference / 60_000))
  const validityDays = Math.floor(totalMinutes / (24 * 60))
  const remainderMinutes = totalMinutes % (24 * 60)
  return {
    validityDays: String(validityDays),
    validityHours: String(Math.floor(remainderMinutes / 60)),
    validityMinutes: String(remainderMinutes % 60),
  }
}

function parseDurationPart(value: unknown, maximum?: number): number | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) return 0
  const parsed = Number(normalized)
  if (!Number.isInteger(parsed) || parsed < 0 || (maximum !== undefined && parsed > maximum)) return null
  return parsed
}

function buildExpiresAt(daysValue: unknown, hoursValue: unknown, minutesValue: unknown): string | null {
  const days = parseDurationPart(daysValue)
  const hours = parseDurationPart(hoursValue, 23)
  const minutes = parseDurationPart(minutesValue, 59)
  if (days === null || hours === null || minutes === null) throw new Error(t('credentials.errors.invalidExpiry'))
  const totalMinutes = days * 24 * 60 + hours * 60 + minutes
  if (totalMinutes === 0) return null
  return new Date(Date.now() + totalMinutes * 60_000).toISOString()
}

function expiryInputKey(): string {
  return [
    String(form.value.validityDays ?? '').trim(),
    String(form.value.validityHours ?? '').trim(),
    String(form.value.validityMinutes ?? '').trim(),
  ].join('|')
}

function expiresAtForSubmit(): string | null {
  const unchanged = isEditing.value
    && expiryInputKey() === [initialValidityDays.value, initialValidityHours.value, initialValidityMinutes.value].join('|')
  if (unchanged && initialExpiresAt.value && Date.parse(initialExpiresAt.value) > Date.now()) {
    return initialExpiresAt.value
  }
  return buildExpiresAt(form.value.validityDays, form.value.validityHours, form.value.validityMinutes)
}

function remainingTime(expiresAt: string | undefined): string {
  const result = getExpiryRemaining(expiresAt, new Date(now.value))
  if (result.kind === 'longTerm') return t('credentials.expiry.longTerm')
  if (result.kind === 'expired') return t('credentials.expiry.expired')
  if (result.kind === 'days') return t('credentials.expiry.remainingDays', { days: result.days })
  return t('credentials.expiry.remainingHoursMinutes', { hours: result.hours, minutes: result.minutes })
}

function buildSecretValues(
  kind: CredentialKind,
  primary: string,
  secondary: string,
  provider: CloudProviderDefinition | undefined,
  cloudSecretValues: Record<string, string>,
): Record<string, CredentialSecretValueInput> {
  const values: Record<string, CredentialSecretValueInput> = {}
  if (kind === 'CLOUD_PROVIDER') {
    for (const slot of provider?.credentialSlots ?? []) {
      const plainText = cloudSecretValues[slot.name]?.trim()
      if (plainText) values[slot.name] = { plainText, type: slot.secretType }
    }
    return values
  }
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
  if (kind === 'CLIENT_CERTIFICATE' && secondary) {
    values.privateKey = { plainText: secondary }
  }
  return values
}

function createMetadata(): Record<string, unknown> | undefined {
  if (isDnsProviderCredential.value) {
    return {
      ...(isEditing.value ? (selected.value?.metadata ?? {}) : {}),
      providerId: form.value.dnsProviderId.trim(),
    }
  }
  if (isCloudProviderCredential.value) {
    return {
      ...(isEditing.value ? (selected.value?.metadata ?? {}) : {}),
      providerKey: form.value.cloudProviderKey,
      ...(selectedCloudProvider.value?.pluginVersionId ? { pluginVersionId: selectedCloudProvider.value.pluginVersionId } : {}),
    }
  }
  if (isBrowserSessionCredential.value) {
    const metadata: Record<string, unknown> = isEditing.value
      ? { ...(selected.value?.metadata ?? {}) }
      : {
        outputContract: {
          version: 'credential.output/v1',
          parameters: {},
        },
      }
    metadata.browserLoginUrl = form.value.browserLoginUrl.trim()
    return metadata
  }
  return undefined
}

async function loadDnsProviders(): Promise<void> {
  if (dnsProviders.value.length > 0 || dnsProvidersLoading.value) return
  dnsProvidersLoading.value = true
  try {
    const result = await internalCaApi.listAcmeDnsProviders()
    dnsProviders.value = (result.data ?? [])
      .map((item: InternalCaRecord) => ({
        id: typeof item.id === 'string' ? item.id : '',
        name: typeof item.name === 'string' ? item.name : typeof item.id === 'string' ? item.id : '',
      }))
      .filter((item) => item.id)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('credentials.errors.load')
  } finally {
    dnsProvidersLoading.value = false
  }
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

async function openHealth(item: CredentialProfileSummary): Promise<void> {
  healthCredential.value = item
  healthModalOpen.value = true
  healthLoading.value = true
  healthError.value = ''
  try {
    const [stateResult, checksResult] = await Promise.all([getCredentialHealth(item.id), listCredentialHealthChecks(item.id)])
    healthState.value = stateResult.data ?? null
    healthChecks.value = checksResult.data?.items ?? []
  } catch (cause) {
    healthError.value = cause instanceof Error ? cause.message : t('credentials.health.errors.load')
  } finally {
    healthLoading.value = false
  }
}

async function runHealthTest(): Promise<void> {
  if (!healthCredential.value) return
  healthTesting.value = true
  healthError.value = ''
  try {
    await triggerCredentialHealthCheck(healthCredential.value.id)
    const [stateResult, checksResult] = await Promise.all([getCredentialHealth(healthCredential.value.id), listCredentialHealthChecks(healthCredential.value.id)])
    healthState.value = stateResult.data ?? healthState.value
    healthChecks.value = checksResult.data?.items ?? healthChecks.value
  } catch (cause) {
    healthError.value = cause instanceof Error ? cause.message : t('credentials.health.errors.test')
  } finally {
    healthTesting.value = false
  }
}

function healthStatus(item: CredentialProfileSummary): string {
  return item.healthStatus ?? (item.status === 'active' ? 'UNUSED' : 'DISABLED')
}

function openCreate(): void {
  editorMode.value = 'create'
  selected.value = null
  usage.value = null
  form.value = emptyForm()
  initialValidityDays.value = ''
  initialValidityHours.value = ''
  initialValidityMinutes.value = ''
  initialExpiresAt.value = null
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
    initialValidityDays.value = String(form.value.validityDays ?? '')
    initialValidityHours.value = String(form.value.validityHours ?? '')
    initialValidityMinutes.value = String(form.value.validityMinutes ?? '')
    initialExpiresAt.value = selected.value.expiresAt ?? null
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
    const secretValues = buildSecretValues(
      form.value.kind,
      form.value.primarySecret,
      form.value.secondarySecret,
      selectedCloudProvider.value,
      form.value.cloudSecretValues,
    )
    const commonInput = {
      name: form.value.name.trim(),
      scopeType: form.value.scopeType,
      scopeId: form.value.scopeType === 'global' ? undefined : form.value.scopeId.trim(),
      username: requiresUsername.value ? form.value.username.trim() : undefined,
      delivery: form.value.kind === 'API_KEY'
        ? { location: form.value.deliveryLocation, name: form.value.deliveryName.trim() }
        : undefined,
      metadata: createMetadata(),
      expiresAt: expiresAtForSubmit(),
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

onMounted(() => {
  void load()
  void loadCloudProviders()
  remainingTimer = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})

watch(isDnsProviderCredential, (enabled) => {
  if (enabled) void loadDnsProviders()
})

watch(locale, () => {
  void loadCloudProviders(form.value.cloudProviderKey)
})

onUnmounted(() => {
  if (remainingTimer) clearInterval(remainingTimer)
  stopBrowserPolling()
})
</script>

<template>
  <section class="gc-page credentials-page">
    <GcPageToolbar>
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="load">{{ t('credentials.actions.refresh') }}</button>
      </template>
      <template #primary>
        <button class="gc-button gc-button--primary" type="button" @click="openCreate">{{ t('credentials.actions.create') }}</button>
      </template>
    </GcPageToolbar>

    <p v-if="error" class="credentials-page__error" role="alert">{{ error }}</p>

    <section class="gc-card credentials-list">
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
              <th>{{ t('credentials.columns.expiresAt') }}</th>
              <th>{{ t('credentials.columns.remainingTime') }}</th>
              <th>{{ t('credentials.columns.updatedAt') }}</th>
              <th class="credentials-list__actions-heading">{{ t('credentials.columns.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in visibleItems" :key="item.id">
              <td>
                <div class="credential-name">
                  <span class="credential-name__mark" aria-hidden="true">{{ item.name.slice(0, 1).toUpperCase() }}</span>
                  <span><strong>{{ item.name }}</strong><small>{{ item.id }}</small></span>
                </div>
              </td>
              <td><span class="credential-kind">{{ t(`credentials.kinds.${item.kind}`) }}</span></td>
              <td>{{ t(`credentials.scopes.${item.scopeType}`) }}</td>
              <td>{{ item.username ?? t('common.notAvailable') }}</td>
              <td>
                <button class="credential-health-button" type="button" :aria-label="t('credentials.health.openAria', { name: item.name })" @click="openHealth(item)">
                  <GcStatusTag :status="item.status === 'error' ? 'ERROR' : healthStatus(item)" :label="item.status === 'error' ? t('credentials.health.status.ERROR') : t(`credentials.health.status.${healthStatus(item)}`)" />
                </button>
                <div v-if="item.status === 'error'" class="credential-status credential-status--repair" :title="t('credentials.status.errorHint')">
                  <small>{{ t('credentials.status.errorSummary') }}</small>
                </div>
              </td>
              <td>{{ item.expiresAt ? formatBrowserLocalTime(item.expiresAt, { includeSeconds: false }) : t('credentials.expiry.longTerm') }}</td>
              <td>{{ remainingTime(item.expiresAt) }}</td>
              <td>{{ formatMaybeLocalTime(item.updatedAt) }}</td>
              <td>
                <div class="credentials-list__actions">
                  <button v-if="item.kind === 'BROWSER_SESSION'" class="gc-button" type="button" :disabled="browserLoading" @click="openBrowserAcquire(item)">{{ t('credentials.browser.actions.open') }}</button>
                  <button class="gc-button" type="button" :disabled="loadingSelection" @click="openEdit(item.id)">{{ t('credentials.actions.edit') }}</button>
                  <button class="gc-button gc-button--danger" type="button" :disabled="loadingSelection" @click="openDelete(item.id)">{{ t('credentials.actions.delete') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer v-if="items.length > 0" class="gc-data-table__footer credentials-list__footer">
        <GcPagination
          :total="items.length"
          :page="page"
          :page-size="pageSize"
          @update:page="changePage"
          @update:page-size="changePageSize"
        />
      </footer>
    </section>

    <GcModal v-model:open="healthModalOpen" :title="t('credentials.health.title')" :description="healthCredential?.name" size="xl">
      <div class="credential-health-modal">
        <p v-if="healthError" class="credentials-page__error" role="alert">{{ healthError }}</p>
        <p v-if="healthLoading" class="credentials-list__state">{{ t('common.loading') }}</p>
        <template v-else-if="healthState">
          <div class="credential-health-modal__summary">
            <GcStatusTag :status="healthState.status" :label="t(`credentials.health.status.${healthState.status}`)" />
            <span>{{ t('credentials.health.deviceCount', { count: healthState.deviceCount }) }}</span>
            <span v-if="healthState.checkedAt">{{ t('credentials.health.checkedAt', { time: formatMaybeLocalTime(healthState.checkedAt) }) }}</span>
            <span v-if="healthState.reasonSummary">{{ healthState.reasonSummary }}</span>
          </div>
          <div class="credential-health-modal__actions">
            <button class="gc-button gc-button--primary" type="button" :disabled="healthTesting || healthState.status === 'DISABLED' || healthState.status === 'UNUSED'" @click="runHealthTest">{{ healthTesting ? t('credentials.health.testing') : t('credentials.health.test') }}</button>
          </div>
          <p v-if="healthChecks.length === 0" class="credentials-list__state">{{ t('credentials.health.empty') }}</p>
          <div v-else class="credential-health-modal__records">
            <div v-for="record in healthChecks" :key="record.id" class="credential-health-record">
              <div class="credential-health-record__heading">
                <GcStatusTag :status="record.resultStatus" :label="t(`credentials.health.status.${record.resultStatus}`)" />
                <span>{{ formatMaybeLocalTime(record.checkedAt) }}</span>
              </div>
              <div class="credential-health-record__meta"><span>{{ record.deviceAssetId }}</span><span v-if="record.reasonCode">{{ record.reasonCode }}</span><span v-if="record.reasonSummary">{{ record.reasonSummary }}</span></div>
            </div>
          </div>
        </template>
      </div>
    </GcModal>

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
            <label v-if="isDnsProviderCredential" class="credentials-field gc-form-field">
              <span>{{ t('acme.fields.dnsProvider') }}</span>
              <span class="credentials-select">
                <select v-model="form.dnsProviderId" required :disabled="dnsProvidersLoading">
                  <option value="" disabled>{{ t('acme.placeholders.dnsProvider') }}</option>
                  <option v-for="provider in dnsProviderOptions" :key="provider.id" :value="provider.id">{{ provider.name }}</option>
                </select>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
              </span>
            </label>
            <label v-if="isCloudProviderCredential" class="credentials-field gc-form-field">
              <span>{{ t('credentials.cloudProviders.provider') }}</span>
              <span class="credentials-select">
                <select v-model="form.cloudProviderKey" :disabled="isEditing || cloudProvidersLoading" required>
                  <option value="" disabled>{{ t('credentials.cloudProviders.selectPlaceholder') }}</option>
                  <option v-for="provider in cloudProviders" :key="provider.pluginVersionId" :value="provider.pluginId" :disabled="!provider.available">
                    {{ provider.displayName }}<template v-if="!provider.available"> · {{ provider.unavailableReason }}</template>
                  </option>
                </select>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
              </span>
              <small>{{ t('credentials.cloudProviders.hint') }}</small>
              <small v-if="cloudProvidersError" class="credentials-page__error">{{ cloudProvidersError }}</small>
              <small v-else-if="isCloudProviderCredential && !cloudProviderReady && !cloudProvidersLoading" class="credentials-page__error">{{ t('credentials.cloudProviders.unavailable') }}</small>
            </label>
            <label v-if="isBrowserSessionCredential" class="credentials-field gc-form-field credentials-editor__field--wide">
              <span>{{ t('credentials.browser.fields.loginUrl') }}</span>
              <input v-model="form.browserLoginUrl" type="url" required autocomplete="url">
              <small>{{ t('credentials.browser.hints.savedLoginUrl') }}</small>
            </label>
            <div v-if="isBrowserSessionCredential" class="credentials-editor__expiry-duration credentials-editor__field--wide">
              <label class="credentials-field gc-form-field">
                <span>{{ t('credentials.fields.validityDays') }}</span>
                <input v-model="form.validityDays" type="number" min="0" step="1" inputmode="numeric">
              </label>
              <label class="credentials-field gc-form-field">
                <span>{{ t('credentials.fields.validityHours') }}</span>
                <input v-model="form.validityHours" type="number" min="0" max="23" step="1" inputmode="numeric">
              </label>
              <label class="credentials-field gc-form-field">
                <span>{{ t('credentials.fields.validityMinutes') }}</span>
                <input v-model="form.validityMinutes" type="number" min="0" max="59" step="1" inputmode="numeric">
              </label>
              <small>{{ t('credentials.hints.validityDuration') }}</small>
            </div>
            <label v-else class="credentials-field gc-form-field">
              <span>{{ t('credentials.fields.validityDays') }}</span>
              <input v-model="form.validityDays" type="number" min="0" step="1" inputmode="numeric">
              <small>{{ t('credentials.hints.validityDays') }}</small>
            </label>
          </div>
        </section>

        <section v-if="!isBrowserSessionCredential" class="credentials-editor__section credentials-editor__section--secret">
          <header><h3>{{ t('credentials.form.secretTitle') }}</h3><p v-if="!isEditing">{{ t('credentials.form.secretCreateDescription') }}</p></header>
          <div class="credentials-editor__grid">
            <label v-if="form.kind === 'DNS_PROVIDER'" class="credentials-dns-config gc-form-field">
              <span>{{ t('credentials.secretLabels.DNS_PROVIDER') }}</span>
              <textarea v-model="form.primarySecret" rows="8" :placeholder="t(isEditing ? 'credentials.placeholders.keepSecret' : 'credentials.placeholders.primarySecret')" autocomplete="off" />
              <small>{{ t(isEditing ? 'credentials.hints.keepSecret' : 'credentials.hints.encrypted') }}</small>
            </label>
            <template v-else-if="isCloudProviderCredential">
              <GcSecretInput
                v-for="slot in cloudProviderSlots"
                :key="slot.name"
                v-model="form.cloudSecretValues[slot.name]"
                class="credentials-secret-field gc-form-field"
                :label="cloudMessage(selectedCloudProvider, slot.labelKey)"
                :placeholder="t(isEditing ? 'credentials.placeholders.keepSecret' : 'credentials.placeholders.primarySecret')"
                :hint="slot.required ? t('credentials.hints.encryptedRequired') : t('credentials.hints.encrypted')"
              />
            </template>
            <GcSecretInput v-else v-model="form.primarySecret" class="credentials-secret-field gc-form-field" :label="t(`credentials.secretLabels.${form.kind}`)" :placeholder="t(isEditing ? 'credentials.placeholders.keepSecret' : 'credentials.placeholders.primarySecret')" :hint="t(isEditing ? 'credentials.hints.keepSecret' : 'credentials.hints.encrypted')" />
            <GcSecretInput v-if="requiresSecondarySecret" v-model="form.secondarySecret" class="credentials-secret-field gc-form-field" :label="t('credentials.fields.secondarySecret')" :placeholder="t(isEditing ? 'credentials.placeholders.keepSecret' : 'credentials.placeholders.secondarySecret')" :hint="t(isEditing ? 'credentials.hints.keepSecret' : 'credentials.hints.encrypted')" />
          </div>
        </section>
        <section v-else class="credentials-editor__section credentials-editor__section--secret">
          <header><h3>{{ t('credentials.form.secretTitle') }}</h3><p>{{ t('credentials.form.browserSessionDescription') }}</p></header>
        </section>

        <section v-if="isEditing" class="credentials-editor__section">
          <header><h3>{{ t('credentials.usage.title') }}</h3></header>
          <div class="usage-summary" :class="{ 'usage-summary--empty': !usage?.total }">
            <strong>{{ t('credentials.usage.total', { count: usage?.total ?? 0 }) }}</strong>
            <span>{{ usage?.total ? t('credentials.usage.changeWarning') : t('credentials.usage.empty') }}</span>
          </div>
          <div v-if="usage?.total" class="usage-groups">
            <section v-for="group in visibleUsageGroups" :key="group" class="usage-group">
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

    <GcModal v-model:open="browserModalOpen" :title="t('credentials.browser.title')" :description="t('credentials.browser.description')" size="xl">
      <form v-if="!browserSession" class="browser-session-modal" @submit.prevent="createBrowserSession">
        <div class="browser-session-modal__grid">
          <label class="gc-form-field browser-session-modal__field--wide">
            <span>{{ t('credentials.browser.fields.loginUrl') }}</span>
            <input v-model="browserLoginUrl" type="url" required autocomplete="url" :disabled="browserLoading">
          </label>
          <label class="gc-form-field">
            <span>{{ t('credentials.browser.fields.plugin') }}</span>
            <select v-model="browserPluginVersionId" required :disabled="browserLoading">
              <option v-for="item in browserPlugins" :key="item.id" :value="item.id">{{ item.label }}</option>
            </select>
          </label>
          <label class="gc-form-field">
            <span>{{ t('credentials.browser.fields.ttl') }}</span>
            <input v-model.number="browserTtlSeconds" type="number" min="60" max="3600" step="60" required :disabled="browserLoading">
          </label>
          <label class="gc-form-field browser-session-modal__field--wide">
            <span>{{ t('credentials.browser.fields.sharePassword') }}</span>
            <div class="browser-session-modal__password">
              <input v-model="browserSharePassword" type="text" minlength="8" maxlength="128" autocomplete="off" required :disabled="browserLoading">
              <button class="gc-button" type="button" :disabled="browserLoading" @click="generateBrowserPassword">{{ t('credentials.browser.actions.generatePassword') }}</button>
            </div>
          </label>
        </div>
      </form>

      <section v-else class="browser-session-modal">
        <header class="browser-session-modal__status">
          <div>
            <h3>{{ t('credentials.browser.session.title') }}</h3>
            <p>{{ t('credentials.browser.session.expiresAt', { time: browserSessionLocalTime(browserSession.expiresAt) }) }}</p>
          </div>
          <GcStatusTag :status="browserSession.status" />
        </header>
        <dl class="browser-session-modal__facts">
          <div><dt>{{ t('credentials.browser.fields.loginUrl') }}</dt><dd>{{ browserSession.capability.loginUrl }}</dd></div>
          <div><dt>{{ t('credentials.browser.fields.plugin') }}</dt><dd>{{ browserSession.capability.pluginId }}@{{ browserSession.capability.pluginVersion }}</dd></div>
          <div><dt>{{ t('credentials.browser.fields.outputs') }}</dt><dd>{{ browserSession.capability.outputParameters.join(', ') }}</dd></div>
          <div v-if="browserSession.credentialId"><dt>{{ t('credentials.browser.fields.credentialId') }}</dt><dd>{{ browserSession.credentialId }}</dd></div>
        </dl>
        <label v-if="browserSharePassword" class="gc-form-field browser-session-modal__share-password">
          <span>{{ t('credentials.browser.fields.sharePassword') }}</span>
          <input :value="browserSharePassword" readonly autocomplete="off">
        </label>
        <div v-if="browserSession.temporaryUrl" class="browser-session-modal__share">
          <label class="gc-form-field">
            <span>{{ t('credentials.browser.fields.shareUrl') }}</span>
            <input :value="browserSession.temporaryUrl" readonly>
          </label>
          <div class="browser-session-modal__share-actions">
            <button class="gc-button" type="button" @click="copyBrowserLink">{{ browserCopied ? t('credentials.browser.actions.copied') : t('credentials.browser.actions.copyShareUrl') }}</button>
            <button class="gc-button gc-button--primary" type="button" @click="openBrowserLink">{{ t('credentials.browser.actions.openShareUrl') }}</button>
          </div>
        </div>
        <p v-if="browserSession.errorMessage" class="credentials-page__error" role="alert">{{ browserSession.errorCode }} · {{ browserSession.errorMessage }}</p>
      </section>

      <p v-if="browserError" class="credentials-page__error" role="alert">{{ browserError }}</p>

      <template #actions>
        <button v-if="browserSession && ['SAVED', 'FAILED', 'EXPIRED', 'CLOSED'].includes(browserSession.status)" class="gc-button" type="button" @click="startNewBrowserSession">{{ t('credentials.browser.actions.newSession') }}</button>
        <button v-if="browserSession && browserCanCancel" class="gc-button" type="button" :disabled="browserLoading" @click="cancelBrowserSession">{{ t('common.cancel') }}</button>
        <button v-if="browserSession" class="gc-button gc-button--primary" type="button" :disabled="!browserCanAcquire" @click="acquireBrowserSession">{{ browserAcquiring ? t('credentials.browser.actions.acquiring') : t('credentials.browser.actions.acquire') }}</button>
        <button v-if="!browserSession" class="gc-button" type="button" @click="browserModalOpen = false">{{ t('credentials.actions.close') }}</button>
        <button v-if="!browserSession" class="gc-button gc-button--primary" type="button" :disabled="!browserCanCreate" @click="createBrowserSession">{{ t('credentials.browser.actions.create') }}</button>
        <button v-else class="gc-button" type="button" @click="browserModalOpen = false">{{ t('credentials.actions.close') }}</button>
      </template>
    </GcModal>

    <GcModal :open="browserSaveSuccessOpen" :title="t('credentials.browser.saveSuccess.title')" :description="t('credentials.browser.saveSuccess.description')" size="sm" @update:open="updateBrowserSaveSuccessOpen">
      <section class="browser-save-success">
        <GcStatusTag status="success" />
        <p>{{ t('credentials.browser.saveSuccess.message') }}</p>
        <dl v-if="browserSession?.credentialId">
          <dt>{{ t('credentials.browser.fields.credentialId') }}</dt>
          <dd>{{ browserSession.credentialId }}</dd>
        </dl>
      </section>
      <template #actions>
        <button class="gc-button gc-button--primary" type="button" @click="closeBrowserSaveSuccess">{{ t('credentials.actions.close') }}</button>
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
.credentials-editor h3, .usage-group h4 { margin: 0; color: var(--gc-color-text-strong); }
.credentials-editor header p, .usage-group p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.credentials-list__state { margin: 0; padding: var(--gc-space-10); text-align: center; color: var(--gc-color-text-muted); }
.credentials-list__table-wrap { overflow-x: auto; }
.credentials-list__footer {
  padding: var(--gc-space-3) var(--gc-space-5);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-glass);
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
}
table { width: 100%; min-width: var(--gc-size-modal-wide); border-collapse: separate; border-spacing: 0; }
th, td { padding: var(--gc-space-2) var(--gc-space-3); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); text-align: left; vertical-align: middle; line-height: 1.25; }
th { background: var(--gc-color-surface-muted); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 900; white-space: nowrap; }
td { color: var(--gc-color-text); font-size: var(--gc-font-size-xs); white-space: nowrap; }
tbody tr { background: var(--gc-color-surface); transition: background .16s ease; }
tbody tr:hover { background: var(--gc-color-surface-hover); }
tbody tr:last-child td { border-bottom: 0; }
.credentials-list__actions-heading { text-align: right; }
.credentials-list__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-1); }
.credentials-list__actions .gc-button { min-height: var(--gc-space-8); padding: 0 var(--gc-space-2); font-size: var(--gc-font-size-xs); white-space: nowrap; }
.credential-health-button { display: inline-flex; padding: 0; border: 0; background: transparent; cursor: pointer; }
.credential-health-button:focus-visible { outline: var(--gc-border-width-thick) solid var(--gc-color-focus); outline-offset: var(--gc-space-1); border-radius: var(--gc-radius-sm); }
.credential-health-modal { display: grid; gap: var(--gc-space-4); }
.credential-health-modal__summary { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gc-space-3); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-soft); color: var(--gc-color-text-muted); }
.credential-health-modal__actions { display: flex; justify-content: flex-end; }
.credential-health-modal__records { display: grid; gap: var(--gc-space-2); }
.credential-health-record { display: grid; gap: var(--gc-space-2); padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface); }
.credential-health-record__heading, .credential-health-record__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gc-space-2); }
.credential-health-record__heading { justify-content: space-between; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.credential-health-record__meta { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); overflow-wrap: anywhere; }
.credential-name { display: flex; align-items: center; gap: var(--gc-space-2); min-width: var(--gc-size-card-min); }
.credential-name__mark { display: grid; flex: 0 0 var(--gc-space-8); width: var(--gc-space-8); height: var(--gc-space-8); place-items: center; border-radius: var(--gc-radius-sm); background: var(--gc-color-primary-soft); color: var(--gc-color-primary-strong); font-size: var(--gc-font-size-xs); font-weight: 800; }
.credential-name > span:last-child { display: grid; min-width: 0; gap: var(--gc-space-1); }
.credential-name strong { overflow: hidden; text-overflow: ellipsis; }
.credential-name small, .usage-group small, .delete-dialog__credential small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
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
.browser-session-modal { display: grid; gap: var(--gc-space-4); }
.browser-session-modal__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.browser-session-modal__field--wide { grid-column: 1 / -1; }
.browser-session-modal__password { display: flex; align-items: center; gap: var(--gc-space-2); }
.browser-session-modal__password input { flex: 1; min-width: 0; }
.browser-session-modal__password .gc-button { flex: 0 0 auto; }
.browser-session-modal__status { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-4); padding-bottom: var(--gc-space-3); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); }
.browser-session-modal__status h3, .browser-session-modal__status p { margin: 0; }
.browser-session-modal__status h3 { color: var(--gc-color-text-strong); font-size: var(--gc-font-size-md); }
.browser-session-modal__status p { margin-top: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.browser-session-modal__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.browser-session-modal__facts div { min-width: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-soft); }
.browser-session-modal__facts dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.browser-session-modal__facts dd { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text); overflow-wrap: anywhere; }
.browser-session-modal__share-password { margin: 0; }
.browser-session-modal__share { display: flex; align-items: end; gap: var(--gc-space-3); }
.browser-session-modal__share .gc-form-field { flex: 1; min-width: 0; }
.browser-session-modal__share-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.browser-save-success { display: grid; gap: var(--gc-space-3); }
.browser-save-success p { margin: 0; color: var(--gc-color-text); }
.browser-save-success dl { display: grid; gap: var(--gc-space-1); margin: 0; padding: var(--gc-space-3); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-soft); }
.browser-save-success dt { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.browser-save-success dd { margin: 0; overflow-wrap: anywhere; color: var(--gc-color-text); }
.credentials-editor { display: grid; gap: var(--gc-space-4); }
.credentials-editor__section { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-4); border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-raised); }
.credentials-editor__section--secret { border-color: var(--gc-color-primary-border); background: var(--gc-color-primary-weak); }
.credentials-editor__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-4); }
.credentials-editor__field--wide { grid-column: 1 / -1; }
.credentials-editor__expiry-duration { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-4); }
.credentials-editor__expiry-duration > small { grid-column: 1 / -1; color: var(--gc-color-text-muted); }
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
  .credentials-editor__grid, .credentials-editor__expiry-duration, .usage-groups, .browser-session-modal__grid, .browser-session-modal__facts { grid-template-columns: 1fr; }
  .browser-session-modal__field--wide { grid-column: auto; }
  .browser-session-modal__share { align-items: stretch; flex-direction: column; }
  .browser-session-modal__share-actions { justify-content: flex-end; }
}
</style>
