<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import {
  createCloudAccountAsset,
  deleteCloudAccountAsset,
  discoverCloudAccountAsset,
  executeProviderCapability,
  listCloudAccountAssets,
  listProviderCapabilities,
  listProviders,
  testCloudAccountAsset,
  updateCloudAccountAsset,
} from '@/api/modules/providers.api'
import type { ApiRecord } from '@/api/modules/common'
import { createCredential, type CredentialKind } from '@/api/modules/credentials.api'
import { GcCredentialSelect, GcModal, GcSecretInput } from '@/design-system/components'
import aliyunLogo from '@/assets/provider-logos/aliyun.svg'
import tencentLogo from '@/assets/provider-logos/tencent.svg'
import huaweiLogo from '@/assets/provider-logos/huawei.svg'
import volcengineLogo from '@/assets/provider-logos/volcengine.svg'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import type { ViewRow } from '@/composables/useBusinessPage'
import { usePermissionStore } from '@/stores/permission.store'

type AccountWizardStep = 1 | 2 | 3
type ProviderToken = 'aliyun' | 'tencent' | 'huawei' | 'volcengine' | 'unknown'
type CloudProviderKey = 'cloud.aliyun' | 'cloud.tencent' | 'cloud.huawei' | 'cloud.volcengine'
type CloudProviderCredentialFields = {
  primary: { slot: string; labelKey: string }
  secondary: { slot: string; labelKey: string }
}

const credentialKinds: CredentialKind[] = ['CLOUD_PROVIDER']
const CLOUD_PROVIDER_CREDENTIAL_FIELDS: Record<CloudProviderKey, CloudProviderCredentialFields> = {
  'cloud.aliyun': {
    primary: { slot: 'accessKeyId', labelKey: 'providers.credentials.fields.aliyun.accessKeyId' },
    secondary: { slot: 'accessKeySecret', labelKey: 'providers.credentials.fields.aliyun.accessKeySecret' },
  },
  'cloud.tencent': {
    primary: { slot: 'secretId', labelKey: 'providers.credentials.fields.tencent.secretId' },
    secondary: { slot: 'secretKey', labelKey: 'providers.credentials.fields.tencent.secretKey' },
  },
  'cloud.huawei': {
    primary: { slot: 'accessKey', labelKey: 'providers.credentials.fields.huawei.accessKey' },
    secondary: { slot: 'secretKey', labelKey: 'providers.credentials.fields.huawei.secretKey' },
  },
  'cloud.volcengine': {
    primary: { slot: 'accessKeyId', labelKey: 'providers.credentials.fields.volcengine.accessKeyId' },
    secondary: { slot: 'secretAccessKey', labelKey: 'providers.credentials.fields.volcengine.secretAccessKey' },
  },
}

const { t, locale } = useI18n()
const permissionStore = usePermissionStore()
const catalogLoading = ref(false)
const catalogError = ref('')
const notice = ref('')
const providers = ref<ApiRecord[]>([])
const capabilities = ref<ApiRecord[]>([])
const accountFormOpen = ref(false)
const operationFormOpen = ref(false)
const editingAccountId = ref('')
const selectedAccount = ref<ApiRecord | null>(null)
const actionLoading = ref('')
const reloadKey = ref(0)
const accountFormStep = ref<AccountWizardStep>(1)
const accountError = ref('')
const credentialCreateOpen = ref(false)
const credentialCreateError = ref('')
const credentialCreating = ref(false)
const credentialRefreshKey = ref(0)

const accountDraft = reactive({
  displayName: '',
  providerKey: 'cloud.aliyun',
  accountId: '',
  credentialRef: '',
})

const credentialDraft = reactive({
  name: '',
  primarySecret: '',
  secondarySecret: '',
})

const scopeDraft = reactive({
  regionsText: '',
  projectId: '',
  resourceGroupId: '',
  enterpriseProjectId: '',
  availabilityZone: '',
  endpoint: '',
  metadataJson: '{}',
})

const operationDraft = reactive({
  frameworkType: 'cloud.aliyun.cdn',
  operationKey: 'certificate.deploy',
  domain: '',
  resourceId: '',
  listenerId: '',
  certificateId: '',
  checkpointId: '',
  certificatePem: '',
  privateKeyPem: '',
})

const providerOptions = computed(() => providers.value
  .map((item) => {
    const providerKey = stringValue(item.providerKey)
    const token = providerToken(providerKey)
    return {
      value: providerKey,
      label: providerLabel(providerKey),
      token,
      logoSrc: providerLogo(token),
      signerType: providerSignerTypeLabel(stringValue(item.signerType)),
      products: Array.isArray(item.supportedProducts)
        ? item.supportedProducts.map((value) => String(value).split('.').at(-1)?.toUpperCase() || String(value)).filter(Boolean)
        : [],
    }
  })
  .filter((item) => item.value))

const selectedProvider = computed(() => providerOptions.value.find((item) => item.value === accountDraft.providerKey) ?? providerOptions.value[0] ?? null)
const providerTokenValue = computed(() => providerToken(accountDraft.providerKey))
const isEditing = computed(() => Boolean(editingAccountId.value))
const selectedCredentialRef = computed(() => {
  const credentialId = accountDraft.credentialRef.trim()
  return credentialId ? `credential://${credentialId}` : ''
})
const scopeValidationError = computed(() => {
  try {
    void parseMetadataJson(scopeDraft.metadataJson)
    return ''
  } catch (cause) {
    return cause instanceof Error ? cause.message : t('providers.messages.metadataInvalid')
  }
})
const accountStepReady = computed(() => Boolean(accountDraft.displayName.trim()) && Boolean(accountDraft.credentialRef.trim()) && !scopeValidationError.value)
const accountStepTwoReady = computed(() => Boolean(accountDraft.displayName.trim()) && Boolean(accountDraft.credentialRef.trim()))
const accountWizardState = computed<'ready' | 'incomplete' | 'locked'>(() => {
  if (accountStepReady.value) return 'ready'
  if (accountStepTwoReady.value) return 'incomplete'
  return 'locked'
})
const accountFormTitle = computed(() => (isEditing.value ? t('providers.actions.edit') : t('providers.actions.add')))
const accountFormDescription = computed(() => t('providers.page.description'))

const accountCapabilities = computed(() =>
  capabilities.value.filter((item) => stringValue(item.providerKey) === stringValue(selectedAccount.value?.providerKey)),
)

const operationFrameworkOptions = computed(() => {
  const values = new Set<string>()
  accountCapabilities.value
    .filter((item) => stringValue(item.operationKey).startsWith('certificate.'))
    .forEach((item) => {
      const value = stringValue(item.frameworkType)
      if (value) values.add(value)
    })
  return [...values]
})

const operationOptions = computed(() =>
  accountCapabilities.value
    .filter((item) => stringValue(item.frameworkType) === operationDraft.frameworkType)
    .map((item) => stringValue(item.operationKey))
    .filter(Boolean),
)

const accountScopeHint = computed(() => t(`providers.scopeHints.${providerTokenValue.value}`))

const accountScopeSummary = computed(() => {
  const items: string[] = []
  const regions = splitList(scopeDraft.regionsText)
  if (regions.length) items.push(`${t('providers.fields.regions')}：${regions.join(' / ')}`)
  if (providerTokenValue.value === 'aliyun') {
    if (scopeDraft.resourceGroupId.trim()) items.push(`${t('providers.fields.resourceGroupId')}：${scopeDraft.resourceGroupId.trim()}`)
    if (scopeDraft.enterpriseProjectId.trim()) items.push(`${t('providers.fields.enterpriseProjectId')}：${scopeDraft.enterpriseProjectId.trim()}`)
  } else {
    if (scopeDraft.projectId.trim()) items.push(`${t('providers.fields.projectId')}：${scopeDraft.projectId.trim()}`)
    if (scopeDraft.availabilityZone.trim()) items.push(`${t('providers.fields.availabilityZone')}：${scopeDraft.availabilityZone.trim()}`)
  }
  if (scopeDraft.endpoint.trim()) items.push(`${t('providers.fields.endpoint')}：${scopeDraft.endpoint.trim()}`)
  return items.length > 0 ? items.join(' · ') : t('providers.messages.scopeEmpty')
})

const accountCredentialSummary = computed(() => selectedCredentialRef.value || t('providers.messages.credentialRequired'))
const providerCredentialFields = computed(() => cloudProviderCredentialFields(accountDraft.providerKey))
const providerCredentialRequirements = computed(() => providerCredentialRequirement(providerCredentialFields.value))
const canCreateProviderCredential = computed(() => Boolean(
  providerCredentialFields.value
  && permissionStore.hasPermission('credential.create'),
))
const canSaveProviderCredential = computed(() => Boolean(
  providerCredentialFields.value
  && credentialDraft.name.trim()
  && credentialDraft.primarySecret
  && credentialDraft.secondarySecret,
))

const canGoNextFromStep1 = computed(() => Boolean(selectedProvider.value) && (isEditing.value || Boolean(accountDraft.providerKey.trim())))
const canGoNextFromStep2 = computed(() => accountStepTwoReady.value)
const canSaveAccount = computed(() => accountStepReady.value && !scopeValidationError.value)

const config = computed<BusinessPageConfig>(() => ({
  title: t('providers.page.title'),
  description: t('providers.page.description'),
  readPermission: 'cloud_account_asset.read',
  primaryPermission: 'cloud_account_asset.create',
  primaryActionLabel: t('providers.actions.add'),
  primaryAction: openAccountForm,
  toolbarPlacement: 'hero-leading',
  moduleName: 'cloud-providers',
  resourceName: t('providers.sections.accounts'),
  defaultStatus: 'UNKNOWN',
  defaultRisk: 'MEDIUM',
  showHeader: false,
  showMetrics: false,
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: t('providers.fields.displayName'), candidates: ['displayName', 'id'] },
    {
      key: 'provider',
      title: t('providers.fields.provider'),
      candidates: ['providerKey'],
      format: (record) => providerLabel(stringValue(record.providerKey)),
    },
    { key: 'accountId', title: t('providers.fields.accountId'), candidates: ['accountId'] },
    {
      key: 'scope',
      title: t('providers.fields.scope'),
      candidates: ['scope'],
      format: (record) => scopeLabel(record.scope),
    },
    { key: 'status', title: t('providers.fields.status'), candidates: ['status'], kind: 'status' },
    { key: 'updatedAt', title: t('providers.fields.updatedAt'), candidates: ['updatedAt'], kind: 'date' },
    { key: 'actions', title: t('providers.fields.actions'), candidates: [] },
  ],
  metrics: [],
  emptyTitle: t('providers.messages.noAccounts'),
  emptyDescription: t('providers.messages.noAccounts'),
  load: () => listCloudAccountAssets(),
  actions: [],
  rowActions: [
    {
      label: t('providers.actions.edit'),
      permission: 'cloud_account_asset.update',
      reloadAfterRun: false,
      run: async (row) => openEditForm(row),
    },
    {
      label: t('providers.actions.test'),
      permission: 'cloud_account_asset.control',
      reloadAfterRun: false,
      run: testAccount,
    },
    {
      label: t('providers.actions.discover'),
      permission: 'cloud_account_asset.control',
      reloadAfterRun: false,
      run: discoverAccount,
    },
    {
      label: t('providers.actions.execute'),
      permission: 'cloud_account_asset.control',
      reloadAfterRun: false,
      run: async (row) => openOperation(row),
    },
    {
      label: t('providers.actions.delete'),
      permission: 'cloud_account_asset.delete',
      danger: true,
      confirmText: t('providers.messages.deleteConfirmText'),
      riskText: t('providers.messages.deleteRisk'),
      run: removeAccount,
    },
  ],
}))

onMounted(() => {
  void loadCatalog()
})

watch(locale, () => {
  void loadCatalog()
  reloadKey.value += 1
})

async function loadCatalog(): Promise<void> {
  catalogLoading.value = true
  catalogError.value = ''
  try {
    const providerResult = await listProviders()
    const providerItems = records(providerResult)
    const capabilityResults = await Promise.all(
      providerItems
        .map((item) => stringValue(item.providerKey))
        .filter(Boolean)
        .map((providerKey) => listProviderCapabilities(providerKey)),
    )
    providers.value = records(providerResult)
    capabilities.value = capabilityResults.flatMap((result) => records(result))
    if (!accountDraft.providerKey && providerOptions.value[0]) {
      accountDraft.providerKey = providerOptions.value[0].value
    }
  } catch (cause) {
    catalogError.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    catalogLoading.value = false
  }
}

function openAccountForm(): void {
  editingAccountId.value = ''
  accountError.value = ''
  accountFormStep.value = 1
  Object.assign(accountDraft, {
    displayName: '',
    providerKey: providerOptions.value[0]?.value || 'cloud.aliyun',
    accountId: '',
    credentialRef: '',
  })
  resetCredentialDraft()
  resetScopeDraft()
  accountFormOpen.value = true
}

function openEditForm(row: ViewRow): void {
  editingAccountId.value = row.id
  accountError.value = ''
  accountFormStep.value = 1
  Object.assign(accountDraft, {
    displayName: stringValue(row.raw.displayName),
    providerKey: stringValue(row.raw.providerKey) || providerOptions.value[0]?.value || 'cloud.aliyun',
    accountId: stringValue(row.raw.accountId),
    credentialRef: credentialIdFromRef(stringValue(row.raw.credentialRef)),
  })
  resetCredentialDraft()
  fillScopeDraft(row.raw.scope)
  accountFormOpen.value = true
}

function goNextAccountStep(): void {
  if (accountFormStep.value === 1 && canGoNextFromStep1.value) {
    accountFormStep.value = 2
    return
  }
  if (accountFormStep.value === 2 && canGoNextFromStep2.value) {
    accountFormStep.value = 3
  }
}

function goPreviousAccountStep(): void {
  if (accountFormStep.value > 1) accountFormStep.value -= 1
}

function chooseProvider(providerKey: string): void {
  if (isEditing.value) return
  if (accountDraft.providerKey !== providerKey) accountDraft.credentialRef = ''
  accountDraft.providerKey = providerKey
  resetCredentialDraft()
  if (accountFormStep.value === 1) return
}

function accountStepState(step: AccountWizardStep): 'done' | 'active' | 'pending' {
  if (accountFormStep.value > step) return 'done'
  if (accountFormStep.value === step) return 'active'
  return 'pending'
}

function providerLabel(providerKey: string): string {
  const token = providerToken(providerKey)
  const label = t(`providers.providerNames.${token}`)
  return label === `providers.providerNames.${token}` ? providerKey : label
}

function providerLogo(token: ProviderToken): string {
  return {
    aliyun: aliyunLogo,
    tencent: tencentLogo,
    huawei: huaweiLogo,
    volcengine: volcengineLogo,
    unknown: '',
  }[token]
}

function providerCredentialRequirement(fields: CloudProviderCredentialFields | null): { type: string; fields: string[] } {
  return {
    type: t('providers.credentials.cloudProvider'),
    fields: fields ? [t(fields.primary.labelKey), t(fields.secondary.labelKey)] : [],
  }
}

function cloudProviderCredentialFields(providerKey: string): CloudProviderCredentialFields | null {
  return providerKey in CLOUD_PROVIDER_CREDENTIAL_FIELDS
    ? CLOUD_PROVIDER_CREDENTIAL_FIELDS[providerKey as CloudProviderKey]
    : null
}

function resetCredentialDraft(): void {
  credentialCreateOpen.value = false
  credentialCreateError.value = ''
  Object.assign(credentialDraft, {
    name: '',
    primarySecret: '',
    secondarySecret: '',
  })
}

function openCredentialCreate(): void {
  if (!canCreateProviderCredential.value) return
  credentialCreateError.value = ''
  credentialCreateOpen.value = true
}

async function createProviderCredential(): Promise<void> {
  const fields = providerCredentialFields.value
  if (!fields || !canSaveProviderCredential.value) return
  credentialCreating.value = true
  credentialCreateError.value = ''
  try {
    const result = await createCredential({
      name: credentialDraft.name.trim(),
      kind: 'CLOUD_PROVIDER',
      scopeType: 'global',
      metadata: { providerKey: accountDraft.providerKey },
      secretValues: {
        [fields.primary.slot]: { plainText: credentialDraft.primarySecret },
        [fields.secondary.slot]: { plainText: credentialDraft.secondarySecret },
      },
    })
    const credentialId = result.data?.id
    if (!credentialId) throw new Error(t('providers.messages.credentialCreateFailed'))
    accountDraft.credentialRef = credentialId
    credentialRefreshKey.value += 1
    notice.value = t('providers.messages.credentialCreated')
    resetCredentialDraft()
  } catch (cause) {
    credentialCreateError.value = errorMessage(cause, t('providers.messages.credentialCreateFailed'))
  } finally {
    credentialCreating.value = false
  }
}

function providerSignerTypeLabel(value: string): string {
  const token = value.toLowerCase()
  if (!token) return t('providers.signerTypes.custom')
  const label = t(`providers.signerTypes.${token}`)
  return label === `providers.signerTypes.${token}` ? value : label
}

function providerToken(providerKey: string): ProviderToken {
  const token = providerKey.split('.').at(-1) || ''
  if (token === 'aliyun' || token === 'tencent' || token === 'huawei' || token === 'volcengine') return token
  return 'unknown'
}

async function saveAccount(): Promise<void> {
  accountError.value = ''
  if (!canSaveAccount.value) {
    accountError.value = scopeValidationError.value || t('providers.messages.credentialRequired')
    return
  }
  actionLoading.value = editingAccountId.value ? `update:${editingAccountId.value}` : 'create'
  catalogError.value = ''
  try {
    const payload = {
      displayName: accountDraft.displayName.trim(),
      accountId: accountDraft.accountId.trim() || undefined,
      credentialRef: selectedCredentialRef.value,
      scope: buildScope(),
    }
    if (editingAccountId.value) {
      await updateCloudAccountAsset({ id: editingAccountId.value, ...payload })
      notice.value = t('providers.messages.updated')
    } else {
      await createCloudAccountAsset({
        ...payload,
        providerKey: accountDraft.providerKey,
      })
      notice.value = t('providers.messages.saved')
    }
    accountFormOpen.value = false
    reloadKey.value += 1
  } catch (cause) {
    accountError.value = errorMessage(cause, t('providers.messages.createFailed'))
  } finally {
    actionLoading.value = ''
  }
}

async function testAccount(row: ViewRow): Promise<void> {
  const id = row.id
  actionLoading.value = `test:${id}`
  catalogError.value = ''
  try {
    await testCloudAccountAsset(id)
    notice.value = t('providers.messages.testCompleted')
  } catch (cause) {
    catalogError.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

async function discoverAccount(row: ViewRow): Promise<void> {
  const id = row.id
  actionLoading.value = `discover:${id}`
  catalogError.value = ''
  try {
    const result = await discoverCloudAccountAsset(id)
    const summary = readRecord(result.data)
    const projection = readRecord(readRecord(summary.resultSummary).projection)
    notice.value = t('providers.messages.discoverySummary', {
      frameworks: numberValue(projection.frameworks),
      sites: numberValue(projection.sites),
      managedTargets: numberValue(projection.managedTargets),
    })
  } catch (cause) {
    catalogError.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

async function removeAccount(row: ViewRow): Promise<void> {
  actionLoading.value = `delete:${row.id}`
  catalogError.value = ''
  try {
    await deleteCloudAccountAsset(row.id)
    notice.value = t('providers.messages.deleted')
  } catch (cause) {
    catalogError.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

function openOperation(row: ViewRow): void {
  selectedAccount.value = row.raw
  operationDraft.frameworkType = operationFrameworkOptions.value.find((item) => item.startsWith(`${stringValue(row.raw.providerKey)}.`))
    ?? `${stringValue(row.raw.providerKey)}.cdn`
  operationDraft.operationKey = 'certificate.deploy'
  Object.assign(operationDraft, {
    domain: '',
    resourceId: '',
    listenerId: '',
    certificateId: '',
    checkpointId: '',
    certificatePem: '',
    privateKeyPem: '',
  })
  operationFormOpen.value = true
}

async function runOperation(): Promise<void> {
  const accountId = stringValue(selectedAccount.value?.id)
  if (!accountId) return
  actionLoading.value = `execute:${accountId}`
  catalogError.value = ''
  try {
    const result = await executeProviderCapability(accountId, {
      frameworkType: operationDraft.frameworkType,
      operationKey: operationDraft.operationKey,
      target: {
        frameworkType: operationDraft.frameworkType,
        resourceId: operationDraft.resourceId || operationDraft.domain,
        listenerId: operationDraft.listenerId || undefined,
        domain: operationDraft.domain || undefined,
        certificateId: operationDraft.certificateId || undefined,
      },
      input: {
        certificateId: operationDraft.certificateId || undefined,
        checkpointId: operationDraft.checkpointId || undefined,
        certificatePem: operationDraft.certificatePem || undefined,
        privateKeyPem: operationDraft.privateKeyPem || undefined,
      },
    })
    const checkpointId = stringValue(readRecord(result.data).checkpointId)
    notice.value = checkpointId
      ? `${t('providers.messages.operationCompleted')} ${t('providers.fields.checkpointId')}: ${checkpointId}`
      : t('providers.messages.operationCompleted')
    operationFormOpen.value = false
  } catch (cause) {
    catalogError.value = errorMessage(cause, t('providers.messages.loadFailed'))
  } finally {
    actionLoading.value = ''
  }
}

function operationLabel(operationKey: string): string {
  const token = operationKey.replaceAll('.', '_')
  const label = t(`providers.operationNames.${token}`)
  return label === `providers.operationNames.${token}` ? operationKey : label
}

function frameworkLabel(frameworkType: string): string {
  return frameworkType.split('.').at(-1)?.toUpperCase() || frameworkType
}

function records(result: { data?: unknown }): ApiRecord[] {
  const data = readRecord(result.data)
  return Array.isArray(data.items) ? data.items.filter(isRecord) : []
}

function buildScope(): Record<string, unknown> {
  const scope: Record<string, unknown> = {}
  const regions = splitList(scopeDraft.regionsText)
  if (regions.length > 0) scope.regions = regions
  if (providerTokenValue.value === 'aliyun') {
    if (scopeDraft.resourceGroupId.trim()) scope.resourceGroupId = scopeDraft.resourceGroupId.trim()
    if (scopeDraft.enterpriseProjectId.trim()) scope.enterpriseProjectId = scopeDraft.enterpriseProjectId.trim()
  } else {
    if (scopeDraft.projectId.trim()) scope.projectId = scopeDraft.projectId.trim()
    if (scopeDraft.availabilityZone.trim()) scope.availabilityZone = scopeDraft.availabilityZone.trim()
  }
  if (scopeDraft.endpoint.trim()) scope.endpoint = scopeDraft.endpoint.trim()
  const metadata = parseMetadataJson(scopeDraft.metadataJson)
  if (Object.keys(metadata).length > 0) scope.metadata = metadata
  return scope
}

function fillScopeDraft(value: unknown): void {
  const scope = isRecord(value) ? value : {}
  scopeDraft.regionsText = Array.isArray(scope.regions) ? scope.regions.map((item) => String(item)).filter(Boolean).join(', ') : ''
  scopeDraft.projectId = stringValue(scope.projectId)
  scopeDraft.resourceGroupId = stringValue(scope.resourceGroupId)
  scopeDraft.enterpriseProjectId = stringValue(scope.enterpriseProjectId)
  scopeDraft.availabilityZone = stringValue(scope.availabilityZone)
  scopeDraft.endpoint = stringValue(scope.endpoint)
  scopeDraft.metadataJson = JSON.stringify(isRecord(scope.metadata) ? scope.metadata : {}, null, 2)
}

function resetScopeDraft(): void {
  scopeDraft.regionsText = ''
  scopeDraft.projectId = ''
  scopeDraft.resourceGroupId = ''
  scopeDraft.enterpriseProjectId = ''
  scopeDraft.availabilityZone = ''
  scopeDraft.endpoint = ''
  scopeDraft.metadataJson = '{}'
}

function parseMetadataJson(value: string): Record<string, unknown> {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '{}') return {}
  const parsed = JSON.parse(trimmed) as unknown
  if (!isRecord(parsed)) throw new Error(t('providers.messages.metadataInvalid'))
  return parsed
}

function splitList(value: string): string[] {
  return value
    .split(/[\s,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

function credentialIdFromRef(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('credential://')) return ''
  return trimmed.slice('credential://'.length).split('#', 1)[0]?.trim() || ''
}

function scopeLabel(value: unknown): string {
  if (!isRecord(value)) return t('common.notAvailable')
  const items: string[] = []
  const regions = Array.isArray(value.regions) ? value.regions.map((item) => String(item)).filter(Boolean) : []
  if (regions.length) items.push(`${t('providers.fields.regions')}：${regions.join(' / ')}`)
  if (stringValue(value.projectId)) items.push(`${t('providers.fields.projectId')}：${stringValue(value.projectId)}`)
  if (stringValue(value.resourceGroupId)) items.push(`${t('providers.fields.resourceGroupId')}：${stringValue(value.resourceGroupId)}`)
  if (stringValue(value.enterpriseProjectId)) items.push(`${t('providers.fields.enterpriseProjectId')}：${stringValue(value.enterpriseProjectId)}`)
  if (stringValue(value.availabilityZone)) items.push(`${t('providers.fields.availabilityZone')}：${stringValue(value.availabilityZone)}`)
  if (stringValue(value.endpoint)) items.push(`${t('providers.fields.endpoint')}：${stringValue(value.endpoint)}`)
  return items.length > 0 ? items.join(' · ') : t('providers.messages.scopeEmpty')
}

function readRecord(value: unknown): ApiRecord {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is ApiRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function errorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiClientError) return cause.message
  return cause instanceof Error && cause.message ? cause.message : fallback
}
</script>

<template>
  <main class="provider-page">
    <p v-if="catalogError" class="provider-message provider-message--error">{{ catalogError }}</p>
    <p v-if="notice" class="provider-message provider-message--success">{{ notice }}</p>

    <BusinessResourcePage :key="reloadKey" :config="config" />

    <GcModal
      v-model:open="accountFormOpen"
      :title="accountFormTitle"
      :description="accountFormDescription"
      size="xxl"
      :close-on-backdrop="false"
    >
      <div class="provider-wizard">
        <ol class="provider-wizard__steps" :aria-label="t('providers.wizard.ariaLabel')">
          <li :class="`is-${accountStepState(1)}`">
            <button type="button" class="provider-wizard__step-button" :disabled="accountFormStep === 1" @click="accountFormStep = 1">
              <span class="provider-wizard__step-index">1</span>
              <span>
                <strong>{{ t('providers.wizard.steps.provider') }}</strong>
                <small>{{ t('providers.wizard.stepDescriptions.provider') }}</small>
              </span>
            </button>
          </li>
          <li :class="`is-${accountStepState(2)}`">
            <button type="button" class="provider-wizard__step-button" :disabled="!canGoNextFromStep1 || accountFormStep === 2" @click="accountFormStep = 2">
              <span class="provider-wizard__step-index">2</span>
              <span>
                <strong>{{ t('providers.wizard.steps.credential') }}</strong>
                <small>{{ t('providers.wizard.stepDescriptions.credential') }}</small>
              </span>
            </button>
          </li>
          <li :class="`is-${accountStepState(3)}`">
            <button type="button" class="provider-wizard__step-button" :disabled="!canGoNextFromStep2 || accountFormStep === 3" @click="accountFormStep = 3">
              <span class="provider-wizard__step-index">3</span>
              <span>
                <strong>{{ t('providers.wizard.steps.scope') }}</strong>
                <small>{{ t('providers.wizard.stepDescriptions.scope') }}</small>
              </span>
            </button>
          </li>
        </ol>

        <section v-if="accountFormStep === 1" class="provider-wizard__panel">
          <header class="provider-wizard__panel-header">
            <div>
              <h3>{{ t('providers.wizard.panels.providerTitle') }}</h3>
              <p>{{ t('providers.wizard.panels.providerDescription') }}</p>
            </div>
            <span class="provider-wizard__state" :class="`is-${accountWizardState}`">
              {{ t(`providers.wizard.state.${accountWizardState}`) }}
            </span>
          </header>
          <div class="provider-wizard__provider-grid">
            <button
              v-for="item in providerOptions"
              :key="item.value"
              type="button"
              class="provider-card"
              :class="{ 'provider-card--selected': accountDraft.providerKey === item.value }"
              :disabled="catalogLoading || (isEditing && accountDraft.providerKey !== item.value)"
              @click="chooseProvider(item.value)"
            >
              <span class="provider-card__logo" :class="`provider-card__logo--${item.token}`">
                <img v-if="item.logoSrc" :src="item.logoSrc" :alt="item.label" />
                <span v-else aria-hidden="true">{{ t('providers.providerMarks.unknown') }}</span>
              </span>
              <span class="provider-card__body">
                <strong>{{ item.label }}</strong>
                <small>{{ t('providers.wizard.providerCard.signerType') }}：{{ item.signerType }}</small>
                <small>{{ t('providers.wizard.providerCard.products') }}：{{ item.products.length ? item.products.join(' / ') : '—' }}</small>
              </span>
            </button>
          </div>
          <p v-if="isEditing" class="provider-wizard__hint">{{ t('providers.messages.providerLocked') }}</p>
        </section>

        <section v-else-if="accountFormStep === 2" class="provider-wizard__panel">
          <header class="provider-wizard__panel-header">
            <div>
              <h3>{{ t('providers.wizard.panels.credentialTitle') }}</h3>
              <p>{{ t('providers.wizard.panels.credentialDescription') }}</p>
            </div>
            <span class="provider-wizard__state is-active">{{ t('providers.wizard.state.active') }}</span>
          </header>
          <div class="provider-wizard__summary">
            <div><span>{{ t('providers.wizard.summary.provider') }}</span><strong>{{ selectedProvider?.label ?? accountDraft.providerKey }}</strong></div>
            <div><span>{{ t('providers.wizard.summary.account') }}</span><strong>{{ accountDraft.displayName || t('providers.messages.scopeEmpty') }}</strong></div>
            <div><span>{{ t('providers.wizard.summary.credential') }}</span><strong>{{ accountCredentialSummary }}</strong></div>
          </div>
          <section class="provider-credential-requirements">
            <div>
              <span>{{ t('providers.credentials.requiredKind') }}</span>
              <strong>{{ providerCredentialRequirements.type }}</strong>
            </div>
            <div>
              <span>{{ t('providers.credentials.requiredFields') }}</span>
              <strong>{{ providerCredentialRequirements.fields.join(' / ') || t('common.notAvailable') }}</strong>
            </div>
            <p>{{ t('providers.credentials.createHint') }}</p>
          </section>
          <div class="provider-wizard__grid">
            <label class="provider-field">
              <span>{{ t('providers.fields.displayName') }}</span>
              <input v-model="accountDraft.displayName" required :placeholder="t('providers.placeholders.displayName')" />
            </label>
            <label class="provider-field">
              <span>{{ t('providers.fields.accountId') }}</span>
              <input v-model="accountDraft.accountId" :placeholder="t('providers.placeholders.accountId')" />
            </label>
            <div class="provider-credential-select provider-field--wide">
              <GcCredentialSelect
                v-model="accountDraft.credentialRef"
                :label="t('providers.fields.credentialProfile')"
                :hint="t('providers.messages.credentialSelectHint')"
                :required="true"
                :accepted-kinds="credentialKinds"
                :required-metadata="{ providerKey: accountDraft.providerKey }"
                :refresh-key="credentialRefreshKey"
              />
              <button
                class="gc-button provider-credential-select__create"
                type="button"
                :disabled="!canCreateProviderCredential || credentialCreating"
                @click="openCredentialCreate"
              >
                {{ t('providers.actions.addCredential') }}
              </button>
            </div>
            <section v-if="credentialCreateOpen" class="provider-inline-credential provider-field--wide">
              <header class="provider-inline-credential__header">
                <div>
                  <h4>{{ t('providers.credentials.inlineTitle') }}</h4>
                  <p>{{ t('providers.credentials.inlineDescription') }}</p>
                </div>
                <strong>{{ selectedProvider?.label ?? accountDraft.providerKey }}</strong>
              </header>
              <form :aria-label="t('providers.aria.credentialCreateForm')" @submit.prevent="createProviderCredential">
                <div class="provider-wizard__grid">
                  <label class="provider-field provider-field--wide">
                    <span>{{ t('providers.credentials.name') }}</span>
                    <input v-model="credentialDraft.name" :placeholder="t('providers.credentials.namePlaceholder')" required />
                  </label>
                  <GcSecretInput
                    v-if="providerCredentialFields"
                    v-model="credentialDraft.primarySecret"
                    class="provider-inline-credential__secret"
                    :label="t(providerCredentialFields.primary.labelKey)"
                    :hint="t('credentials.hints.encrypted')"
                  />
                  <GcSecretInput
                    v-if="providerCredentialFields"
                    v-model="credentialDraft.secondarySecret"
                    class="provider-inline-credential__secret"
                    :label="t(providerCredentialFields.secondary.labelKey)"
                    :hint="t('credentials.hints.encrypted')"
                  />
                </div>
                <p v-if="credentialCreateError" class="provider-wizard__error" role="alert">{{ credentialCreateError }}</p>
                <footer class="provider-inline-credential__actions">
                  <button class="gc-button" type="button" :disabled="credentialCreating" @click="resetCredentialDraft">
                    {{ t('providers.actions.cancelCredential') }}
                  </button>
                  <button class="gc-button gc-button--primary" type="submit" :disabled="credentialCreating || !canSaveProviderCredential">
                    {{ t('providers.actions.saveCredential') }}
                  </button>
                </footer>
              </form>
            </section>
          </div>
          <p class="provider-wizard__hint">{{ t('providers.messages.credentialHint') }}</p>
        </section>

        <section v-else class="provider-wizard__panel">
          <header class="provider-wizard__panel-header">
            <div>
              <h3>{{ t('providers.wizard.panels.scopeTitle') }}</h3>
              <p>{{ t('providers.wizard.panels.scopeDescription') }}</p>
            </div>
            <span class="provider-wizard__state is-active">{{ t('providers.wizard.state.active') }}</span>
          </header>
          <div class="provider-wizard__summary">
            <div><span>{{ t('providers.wizard.summary.provider') }}</span><strong>{{ selectedProvider?.label ?? accountDraft.providerKey }}</strong></div>
            <div><span>{{ t('providers.wizard.summary.account') }}</span><strong>{{ accountDraft.displayName || t('providers.messages.scopeEmpty') }}</strong></div>
            <div><span>{{ t('providers.wizard.summary.credential') }}</span><strong>{{ accountCredentialSummary }}</strong></div>
          </div>
          <p class="provider-wizard__hint">{{ accountScopeHint }}</p>
          <div class="provider-wizard__grid">
            <label class="provider-field provider-field--wide">
              <span>{{ t('providers.fields.regions') }}</span>
              <textarea v-model="scopeDraft.regionsText" :placeholder="t('providers.placeholders.regions')" />
              <small>{{ t('providers.messages.regionHint') }}</small>
            </label>
            <template v-if="providerTokenValue === 'aliyun'">
              <label class="provider-field">
                <span>{{ t('providers.fields.resourceGroupId') }}</span>
                <input v-model="scopeDraft.resourceGroupId" :placeholder="t('providers.placeholders.resourceGroupId')" />
              </label>
              <label class="provider-field">
                <span>{{ t('providers.fields.enterpriseProjectId') }}</span>
                <input v-model="scopeDraft.enterpriseProjectId" :placeholder="t('providers.placeholders.enterpriseProjectId')" />
              </label>
            </template>
            <template v-else>
              <label class="provider-field">
                <span>{{ t('providers.fields.projectId') }}</span>
                <input v-model="scopeDraft.projectId" :placeholder="t('providers.placeholders.projectId')" />
              </label>
              <label class="provider-field">
                <span>{{ t('providers.fields.availabilityZone') }}</span>
                <input v-model="scopeDraft.availabilityZone" :placeholder="t('providers.placeholders.availabilityZone')" />
              </label>
            </template>
            <label class="provider-field provider-field--wide">
              <span>{{ t('providers.fields.endpoint') }}</span>
              <input v-model="scopeDraft.endpoint" :placeholder="t('providers.placeholders.endpoint')" />
            </label>
            <label class="provider-field provider-field--wide">
              <span>{{ t('providers.fields.metadataJson') }}</span>
              <textarea v-model="scopeDraft.metadataJson" :placeholder="t('providers.placeholders.metadataJson')" />
              <small>{{ t('providers.messages.metadataHint') }}</small>
            </label>
          </div>
          <p v-if="scopeValidationError" class="provider-wizard__error">{{ scopeValidationError }}</p>
          <p v-else class="provider-wizard__hint">{{ t('providers.messages.scopeHint') }}</p>
          <div class="provider-wizard__preview">
            <div><span>{{ t('providers.fields.scope') }}</span><strong>{{ accountScopeSummary }}</strong></div>
          </div>
        </section>

        <p v-if="accountError" class="provider-wizard__error">{{ accountError }}</p>
      </div>
      <template #actions>
        <button class="gc-button" type="button" @click="accountFormOpen = false">{{ t('providers.actions.cancel') }}</button>
        <button class="gc-button" type="button" :disabled="accountFormStep === 1 || Boolean(actionLoading)" @click="goPreviousAccountStep">{{ t('providers.actions.previous') }}</button>
        <button
          v-if="accountFormStep < 3"
          class="gc-button gc-button--primary"
          type="button"
          :disabled="accountFormStep === 1 ? !canGoNextFromStep1 : !canGoNextFromStep2"
          @click="goNextAccountStep"
        >
          {{ t('providers.actions.next') }}
        </button>
        <button
          v-else
          class="gc-button gc-button--primary"
          type="button"
          :disabled="!canSaveAccount || Boolean(actionLoading)"
          @click="saveAccount"
        >
          {{ t('providers.actions.save') }}
        </button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="operationFormOpen"
      :title="t('providers.sections.operation')"
      size="xl"
      :close-on-backdrop="false"
    >
      <form class="provider-form" :aria-label="t('providers.aria.operationForm')" @submit.prevent="runOperation">
        <label>
          <span>{{ t('providers.fields.framework') }}</span>
          <select v-model="operationDraft.frameworkType">
            <option v-for="frameworkType in operationFrameworkOptions" :key="frameworkType" :value="frameworkType">
              {{ frameworkLabel(frameworkType) }}
            </option>
          </select>
        </label>
        <label>
          <span>{{ t('providers.fields.operation') }}</span>
          <select v-model="operationDraft.operationKey">
            <option v-for="operationKey in operationOptions" :key="operationKey" :value="operationKey">
              {{ operationLabel(operationKey) }}
            </option>
          </select>
        </label>
        <label><span>{{ t('providers.fields.domain') }}</span><input v-model="operationDraft.domain" :placeholder="t('providers.placeholders.domain')" /></label>
        <label><span>{{ t('providers.fields.resourceId') }}</span><input v-model="operationDraft.resourceId" :placeholder="t('providers.placeholders.resourceId')" /></label>
        <label><span>{{ t('providers.fields.listenerId') }}</span><input v-model="operationDraft.listenerId" :placeholder="t('providers.placeholders.listenerId')" /></label>
        <label><span>{{ t('providers.fields.certificateId') }}</span><input v-model="operationDraft.certificateId" :placeholder="t('providers.placeholders.certificateId')" /></label>
        <label><span>{{ t('providers.fields.checkpointId') }}</span><input v-model="operationDraft.checkpointId" :placeholder="t('providers.placeholders.checkpointId')" /></label>
        <label class="provider-form__wide"><span>{{ t('providers.fields.certificatePem') }}</span><textarea v-model="operationDraft.certificatePem" :placeholder="t('providers.placeholders.certificatePem')" /></label>
        <label class="provider-form__wide"><span>{{ t('providers.fields.privateKeyPem') }}</span><textarea v-model="operationDraft.privateKeyPem" :placeholder="t('providers.placeholders.privateKeyPem')" /></label>
        <p class="provider-form__hint">{{ t('providers.messages.rollbackHint') }}</p>
      </form>
      <template #actions>
        <button class="gc-button" type="button" @click="operationFormOpen = false">{{ t('providers.actions.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="Boolean(actionLoading)" @click="runOperation">
          {{ t('providers.actions.execute') }}
        </button>
      </template>
    </GcModal>
  </main>
</template>

<style scoped>
.provider-page {
  display: grid;
  gap: var(--gc-space-3);
}

.provider-message {
  margin: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  padding: var(--gc-space-3);
  color: var(--gc-color-text-muted);
}

.provider-message--error {
  color: var(--gc-color-danger);
  border-color: var(--gc-color-danger-border);
  background: var(--gc-color-danger-bg);
}

.provider-message--success {
  color: var(--gc-color-success);
  border-color: var(--gc-color-success-border);
  background: var(--gc-color-success-bg);
}

.provider-wizard {
  display: grid;
  gap: var(--gc-space-4);
}

.provider-wizard__steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gc-space-2);
  padding: 0;
  margin: 0;
  list-style: none;
}

.provider-wizard__steps li {
  margin: 0;
}

.provider-wizard__step-button {
  width: 100%;
  min-height: var(--gc-space-12);
  display: flex;
  align-items: center;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-soft);
  color: var(--gc-color-text);
  text-align: left;
}

.provider-wizard__steps li.is-active .provider-wizard__step-button,
.provider-wizard__steps li.is-done .provider-wizard__step-button {
  border-color: var(--gc-color-primary-border-strong);
  background: var(--gc-color-primary-soft);
}

.provider-wizard__step-button:disabled {
  cursor: not-allowed;
  opacity: var(--gc-opacity-disabled);
}

.provider-wizard__step-index {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  inline-size: var(--gc-space-8);
  block-size: var(--gc-space-8);
  border-radius: 999px;
  color: var(--gc-color-primary);
  background: var(--gc-color-surface-solid);
  font-weight: 900;
}

.provider-wizard__step-button span:last-child {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.provider-wizard__step-button strong,
.provider-wizard__panel-header h3,
.provider-wizard__summary strong,
.provider-wizard__preview strong {
  overflow-wrap: anywhere;
}

.provider-wizard__step-button strong {
  font-size: var(--gc-font-size-sm);
  line-height: 1.2;
}

.provider-wizard__step-button small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
  line-height: 1.45;
}

.provider-wizard__panel {
  display: grid;
  gap: var(--gc-space-4);
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-lg);
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-subtle));
}

.provider-wizard__panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--gc-space-3);
}

.provider-wizard__panel-header h3,
.provider-wizard__panel-header p {
  margin: 0;
}

.provider-wizard__panel-header h3 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-lg);
  line-height: 1.2;
}

.provider-wizard__panel-header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: 1.55;
}

.provider-wizard__state {
  flex: 0 0 auto;
  padding: 0 var(--gc-space-3);
  min-height: var(--gc-space-8);
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.provider-wizard__state.is-ready {
  color: var(--gc-color-success);
  background: var(--gc-color-success-bg);
}

.provider-wizard__state.is-active {
  color: var(--gc-color-info);
  background: var(--gc-color-info-soft);
}

.provider-wizard__state.is-incomplete {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-soft);
}

.provider-wizard__state.is-locked {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-soft);
}

.provider-wizard__provider-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.provider-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--gc-space-3);
  align-items: center;
  padding: var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-soft);
  color: var(--gc-color-text);
  text-align: left;
}

.provider-card--selected {
  border-color: var(--gc-color-primary-border-strong);
  background: var(--gc-color-primary-soft);
}

.provider-card:disabled {
  cursor: not-allowed;
  opacity: var(--gc-opacity-disabled);
}

.provider-card__logo {
  display: grid;
  place-items: center;
  inline-size: var(--gc-size-provider-logo);
  block-size: var(--gc-size-provider-logo-height);
  overflow: hidden;
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-solid);
}

.provider-card__logo img {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  object-fit: contain;
}

.provider-card__logo--aliyun {
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
}

.provider-card__logo--tencent {
  color: var(--gc-color-info);
  background: var(--gc-color-info-soft);
}

.provider-card__logo--huawei {
  color: var(--gc-color-success);
  background: var(--gc-color-success-soft);
}

.provider-card__logo--volcengine {
  color: var(--gc-color-warning);
  background: var(--gc-color-warning-soft);
}

.provider-card__logo--unknown {
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-muted);
}

.provider-credential-requirements {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-info-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-info-soft);
}

.provider-credential-requirements div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.provider-credential-requirements span,
.provider-credential-requirements p {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
}

.provider-credential-requirements strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  overflow-wrap: anywhere;
}

.provider-credential-requirements p {
  grid-column: 1 / -1;
  margin: 0;
  line-height: 1.5;
}

.provider-card__body {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
}

.provider-card__body strong {
  font-size: var(--gc-font-size-sm);
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.provider-card__body small {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.provider-wizard__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.provider-field {
  display: grid;
  gap: var(--gc-space-1);
  color: var(--gc-color-text);
}

.provider-field span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}

.provider-field input,
.provider-field textarea,
.provider-field select {
  width: 100%;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
  font: inherit;
}

.provider-field textarea {
  min-height: var(--gc-space-12);
  resize: vertical;
}

.provider-field small,
.provider-wizard__hint,
.provider-form__hint {
  color: var(--gc-color-text-muted);
}

.provider-field--wide {
  grid-column: 1 / -1;
}

.provider-credential-select :deep(.gc-credential-select) {
  gap: var(--gc-space-1);
  min-width: 0;
}

.provider-credential-select :deep(select) {
  min-height: var(--gc-space-10);
  border-radius: var(--gc-radius-md);
}

.provider-credential-select {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: var(--gc-space-3);
}

.provider-credential-select__create {
  min-height: var(--gc-space-10);
  white-space: nowrap;
}

.provider-inline-credential {
  display: grid;
  gap: var(--gc-space-3);
  padding-top: var(--gc-space-3);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
}

.provider-inline-credential__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gc-space-3);
}

.provider-inline-credential__header h4,
.provider-inline-credential__header p {
  margin: 0;
}

.provider-inline-credential__header h4 {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-md);
}

.provider-inline-credential__header p {
  margin-top: var(--gc-space-1);
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
}

.provider-inline-credential__header > strong {
  color: var(--gc-color-primary);
  font-size: var(--gc-font-size-sm);
}

.provider-inline-credential form {
  display: grid;
  gap: var(--gc-space-3);
}

.provider-inline-credential__secret {
  min-width: 0;
}

.provider-inline-credential :deep(.gc-secret-input) {
  gap: var(--gc-space-1);
}

.provider-inline-credential :deep(.gc-secret-input input) {
  min-height: var(--gc-space-10);
  border-radius: var(--gc-radius-md);
}

.provider-inline-credential__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--gc-space-2);
}

.provider-wizard__summary,
.provider-wizard__preview {
  display: grid;
  gap: var(--gc-space-2);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.provider-wizard__summary div,
.provider-wizard__preview div {
  display: grid;
  gap: var(--gc-space-1);
  padding: var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-soft);
}

.provider-wizard__summary span,
.provider-wizard__preview span {
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.provider-wizard__summary strong,
.provider-wizard__preview strong {
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
  line-height: 1.35;
}

.provider-wizard__hint {
  margin: 0;
}

.provider-wizard__error {
  margin: 0;
  color: var(--gc-color-danger);
  font-weight: 850;
}

.provider-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
}

.provider-form label {
  display: grid;
  gap: var(--gc-space-1);
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-sm);
}

.provider-form__wide {
  grid-column: 1 / -1;
}

.provider-form input,
.provider-form select,
.provider-form textarea {
  width: 100%;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  padding: var(--gc-space-2);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-solid);
  font: inherit;
}

.provider-form textarea {
  min-height: var(--gc-space-10);
  resize: vertical;
}

.provider-form small,
.provider-form__hint {
  color: var(--gc-color-text-muted);
}

.provider-form__hint {
  grid-column: 1 / -1;
  margin: 0;
}

@media (max-width: 48rem) {
  .provider-wizard__steps,
  .provider-wizard__provider-grid,
  .provider-wizard__grid,
  .provider-wizard__summary,
  .provider-wizard__preview,
  .provider-credential-requirements,
  .provider-credential-select,
  .provider-form {
    grid-template-columns: 1fr;
  }

  .provider-field--wide {
    grid-column: auto;
  }

  .provider-wizard__panel-header {
    display: grid;
  }

  .provider-credential-requirements p {
    grid-column: auto;
  }

  .provider-inline-credential__header {
    display: grid;
  }
}
</style>
