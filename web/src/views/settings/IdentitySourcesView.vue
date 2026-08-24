<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import type { ApiRecord } from '@/api/modules/common'
import {
  createIdentitySource,
  createSecret,
  deleteIdentitySource,
  listIdentitySources,
  listRoles,
  testIdentitySource,
  updateIdentitySource,
  type IdentitySourceConnectionCheck,
  type IdentitySourceConnectionCheckKey,
  type IdentitySourceConnectionCheckStatus,
  type IdentitySourceConnectionTestResult,
} from '@/api/modules/security.api'
import { GcConfirmAction, GcModal, GcPageToolbar } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'
import { translateDynamic } from '@/i18n/translate'

type IdentitySourceKind = 'active_directory' | 'ldap'
type IdentityProtocol = 'ldap' | 'ldaps'

interface IdentitySourceDraft {
  id: string
  name: string
  domain: string
  host: string
  protocol: IdentityProtocol
  baseDn: string
  bindDn: string
  bindPassword: string
  type: IdentitySourceKind
  defaultRoleId: string
  requireGroupMapping: boolean
  userDnTemplate: string
  userFilter: string
  groupFilter: string
  syncUserFilter: string
  enabled: boolean
}

const pageLoading = ref(false)
const pageError = ref('')
const sourceItems = ref<ApiRecord[]>([])
const roleItems = ref<ApiRecord[]>([])

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editorLoading = ref(false)
const editorError = ref('')
const editorMessage = ref('')
const advancedOpen = ref(false)
const { t, te } = useI18n()
const SETTINGS_PAGE_SIZE = 20

const deletingId = ref('')
const testingSourceId = ref('')
const connectionTestOpen = ref(false)
const connectionTestLoading = ref(false)
const connectionTestError = ref('')
const connectionTestSource = ref<ApiRecord | null>(null)
const connectionTestResult = ref<IdentitySourceConnectionTestResult | null>(null)

const draft = reactive<IdentitySourceDraft>(buildDefaultDraft())

function buildDefaultDraft(): IdentitySourceDraft {
  return {
    id: '',
    name: '',
    domain: '',
    host: '',
    protocol: 'ldaps',
    baseDn: '',
    bindDn: '',
    bindPassword: '',
    type: 'active_directory',
    defaultRoleId: '',
    requireGroupMapping: true,
    userDnTemplate: '',
    userFilter: '',
    groupFilter: '(member={{userDn}})',
    syncUserFilter: '',
    enabled: true,
  }
}

function resetDraft(): void {
  Object.assign(draft, buildDefaultDraft())
  advancedOpen.value = false
  editorError.value = ''
  editorMessage.value = ''
}

const roleOptions = computed(() =>
  roleItems.value
    .map((item) => ({
      label: String(item.name ?? item.code ?? item.id ?? ''),
      value: String(item.id ?? ''),
    }))
    .filter((item) => item.value),
)

const editorDisabled = computed(() => {
  const requirePassword = editorMode.value === 'create' || Boolean(draft.bindPassword.trim())
  return editorLoading.value
    || !draft.name.trim()
    || !draft.host.trim()
    || !draft.baseDn.trim()
    || !draft.bindDn.trim()
    || (editorMode.value === 'create' && !draft.bindPassword.trim())
    || (!requirePassword && false)
})

const derivedUrl = computed(() => `${draft.protocol}://${draft.host.trim()}`)
const connectionCheckKeys: readonly IdentitySourceConnectionCheckKey[] = ['dns', 'port', 'bind']

const connectionChecks = computed<IdentitySourceConnectionCheck[]>(() =>
  connectionCheckKeys.map((key) => connectionTestResult.value?.checks.find((check) => check.key === key) ?? {
    key,
    status: 'skipped',
    code: 'CHECK_NOT_RETURNED',
    message: t('settings.identitySources.test.messages.checkNotReturned'),
  }),
)

async function reloadSources() {
  pageLoading.value = true
  pageError.value = ''
  try {
    const result = await listIdentitySources({ page: 1, pageSize: 50 })
    sourceItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    if (cause instanceof ApiClientError) pageError.value = `${cause.message}（${cause.errorCode}）`
    else pageError.value = cause instanceof Error ? cause.message : t('settings.identitySources.errors.loadFailed')
  } finally {
    pageLoading.value = false
  }
}

async function loadRoles() {
  const result = await listRoles({ page: 1, pageSize: 200 })
  roleItems.value = [...(result.data?.items ?? [])]
}

function openCreateDialog() {
  resetDraft()
  editorMode.value = 'create'
  editorOpen.value = true
}

function openEditDialog(item: ApiRecord) {
  resetDraft()
  editorMode.value = 'edit'
  draft.id = String(item.id ?? '')
  draft.name = String(item.name ?? '')
  draft.type = normalizeType(item.type)
  draft.protocol = String(item.tlsMode ?? '') === 'ldaps' || String(item.url ?? '').startsWith('ldaps://') ? 'ldaps' : 'ldap'
  draft.host = normalizeHost(String(item.url ?? ''))
  draft.baseDn = String(item.baseDn ?? '')
  draft.bindDn = String(item.bindDn ?? '')
  draft.defaultRoleId = String(item.defaultRoleId ?? '')
  draft.requireGroupMapping = Boolean(item.requireGroupMapping ?? true)
  draft.userDnTemplate = String(item.userDnTemplate ?? '')
  draft.userFilter = String(item.userFilter ?? '')
  draft.groupFilter = String(item.groupFilter ?? '')
  draft.syncUserFilter = String(item.syncUserFilter ?? '')
  draft.enabled = item.enabled === undefined ? true : Boolean(item.enabled)
  draft.domain = inferDomainFromDraft()
  advancedOpen.value = Boolean(draft.userDnTemplate || draft.userFilter || draft.syncUserFilter || draft.defaultRoleId)
  editorOpen.value = true
}

function closeEditor() {
  if (!editorLoading.value) editorOpen.value = false
}

function normalizeType(value: unknown): IdentitySourceKind {
  return String(value) === 'ldap' ? 'ldap' : 'active_directory'
}

function normalizeHost(value: string): string {
  return value.trim().replace(/^\s*ldaps?:\/\//i, '').replace(/\/+$/, '')
}

function inferDomainFromDraft(): string {
  if (draft.userDnTemplate.includes('@')) return draft.userDnTemplate.split('@').pop()?.trim() ?? ''
  return ''
}

function defaultUserDnTemplate(type: IdentitySourceKind, domain: string): string | undefined {
  const normalizedDomain = domain.trim()
  if (type === 'active_directory' && normalizedDomain) return `{{username}}@${normalizedDomain}`
  return undefined
}

function defaultUserFilter(type: IdentitySourceKind): string | undefined {
  return type === 'ldap' ? '(uid={{username}})' : undefined
}

function defaultSyncUserFilter(type: IdentitySourceKind): string | undefined {
  return type === 'ldap' ? '(uid=*)' : undefined
}

function defaultGroupFilter(): string {
  return '(member={{userDn}})'
}

async function resolveBindPasswordSecretRef(): Promise<string | undefined> {
  if (!draft.bindPassword.trim()) return undefined
  const secret = await createSecret({
    name: t('settings.identitySources.secret.bindPasswordName', { name: draft.name.trim() }),
    type: 'password',
    scopeType: 'global',
    plainText: draft.bindPassword,
  })
  const secretRef = String(secret.data?.secretRef ?? '')
  if (!secretRef) throw new Error(t('settings.identitySources.errors.createBindPasswordSecretFailed'))
  return secretRef
}

function buildIdentitySourcePayload(bindPasswordSecretRef?: string): Record<string, unknown> {
  const type = draft.type
  const domain = draft.domain.trim()
  const userDnTemplate = draft.userDnTemplate.trim() || defaultUserDnTemplate(type, domain)
  const userFilter = draft.userFilter.trim() || defaultUserFilter(type)
  const groupFilter = draft.groupFilter.trim() || defaultGroupFilter()
  const syncUserFilter = draft.syncUserFilter.trim() || defaultSyncUserFilter(type)

  return {
    id: draft.id || undefined,
    name: draft.name.trim(),
    type,
    enabled: draft.enabled,
    url: `${draft.protocol}://${normalizeHost(draft.host)}`,
    baseDn: draft.baseDn.trim(),
    userDnTemplate,
    userFilter,
    groupFilter,
    syncUserFilter,
    bindDn: draft.bindDn.trim(),
    bindPasswordSecretRef,
    defaultRoleId: draft.defaultRoleId || undefined,
    requireGroupMapping: draft.requireGroupMapping,
    tlsMode: draft.protocol === 'ldaps' ? 'ldaps' : 'none',
    userAttributes: ['cn', 'displayName', 'mail', 'uid', 'sAMAccountName', 'userPrincipalName', 'memberOf', 'entryUUID', 'objectGUID'],
    groupAttributes: ['dn', 'cn', 'sAMAccountName'],
  }
}

async function submitEditor() {
  if (editorDisabled.value) return
  editorLoading.value = true
  editorError.value = ''
  editorMessage.value = ''
  try {
    const bindPasswordSecretRef = await resolveBindPasswordSecretRef()
    const payload = buildIdentitySourcePayload(bindPasswordSecretRef)
    if (editorMode.value === 'create') {
      await createIdentitySource(payload)
      editorMessage.value = t('settings.identitySources.messages.createSuccess')
    } else {
      if (!bindPasswordSecretRef) delete payload.bindPasswordSecretRef
      await updateIdentitySource(payload)
      editorMessage.value = t('settings.identitySources.messages.updateSuccess')
    }
    editorOpen.value = false
    await reloadSources()
  } catch (cause) {
    if (cause instanceof ApiClientError) editorError.value = `${cause.message}（${cause.errorCode}）`
    else editorError.value = cause instanceof Error ? cause.message : (editorMode.value === 'create' ? t('settings.identitySources.errors.createFailed') : t('settings.identitySources.errors.updateFailed'))
  } finally {
    editorLoading.value = false
  }
}

async function removeSource(sourceId: string) {
  deletingId.value = sourceId
  pageError.value = ''
  try {
    await deleteIdentitySource(sourceId)
    await reloadSources()
  } catch (cause) {
    if (cause instanceof ApiClientError) pageError.value = `${cause.message}（${cause.errorCode}）`
    else pageError.value = cause instanceof Error ? cause.message : t('settings.identitySources.errors.deleteFailed')
  } finally {
    deletingId.value = ''
  }
}

async function openConnectionTest(item: ApiRecord) {
  const sourceId = String(item.id ?? '')
  if (!sourceId || testingSourceId.value) return
  connectionTestSource.value = item
  connectionTestResult.value = null
  connectionTestError.value = ''
  connectionTestOpen.value = true
  connectionTestLoading.value = true
  testingSourceId.value = sourceId
  try {
    const result = await testIdentitySource(sourceId)
    if (!result.data) throw new Error(t('settings.identitySources.test.errors.emptyResult'))
    connectionTestResult.value = result.data
  } catch (cause) {
    connectionTestError.value = cause instanceof ApiClientError
      ? `${cause.message}（${cause.errorCode}）`
      : cause instanceof Error ? cause.message : t('settings.identitySources.test.errors.requestFailed')
  } finally {
    connectionTestLoading.value = false
    testingSourceId.value = ''
  }
}

function closeConnectionTest() {
  if (connectionTestLoading.value) return
  connectionTestOpen.value = false
}

function connectionCheckTitle(key: IdentitySourceConnectionCheckKey): string {
  return translateDynamic(t, te, 'settings.identitySources.test.checks', key, 'common.notAvailable', 'common.unknownValue', '.title')
}

function connectionCheckStatus(status: IdentitySourceConnectionCheckStatus): string {
  return translateDynamic(t, te, 'settings.identitySources.test.status', status)
}

function connectionTestSummary(result: IdentitySourceConnectionTestResult): string {
  return result.ok
    ? t('settings.identitySources.test.messages.summaryPassed')
    : t('settings.identitySources.test.messages.summaryFailed')
}

function connectionCheckMessage(check: IdentitySourceConnectionCheck): string {
  const details = check.details ?? {}
  const addresses = readStringArray(details.addresses)
  if (check.code === 'DNS_RESOLVED') {
    return details.lookupRequired === false
      ? t('settings.identitySources.test.messages.dnsIp')
      : t('settings.identitySources.test.messages.dnsResolved', {
          addresses: addresses.join(', ') || t('common.notAvailable'),
        })
  }
  if (check.code === 'LDAP_PORT_REACHABLE') {
    return t('settings.identitySources.test.messages.portReachable', {
      protocol: readString(details.protocol).toUpperCase(),
      port: readNumber(details.port),
    })
  }
  if (check.code === 'LDAP_BIND_OK') {
    return details.bindDnConfigured === false
      ? t('settings.identitySources.test.messages.bindAnonymousPassed')
      : t('settings.identitySources.test.messages.bindServicePassed')
  }
  if (check.code === 'SKIPPED_INVALID_URL') return t('settings.identitySources.test.messages.skippedInvalidUrl')
  if (check.code === 'SKIPPED_DNS_FAILED') return t('settings.identitySources.test.messages.skippedDnsFailed')
  if (check.code === 'SKIPPED_PORT_UNREACHABLE') return t('settings.identitySources.test.messages.skippedPortFailed')
  if (check.key === 'dns') return t('settings.identitySources.test.messages.dnsFailed')
  if (check.key === 'port') return t('settings.identitySources.test.messages.portFailed')
  if (check.key === 'bind') return t('settings.identitySources.test.messages.bindFailed')
  return t('settings.identitySources.test.messages.unknownCheck', { code: check.code })
}

function connectionCheckIcon(status: IdentitySourceConnectionCheckStatus): string {
  if (status === 'passed') return '✓'
  if (status === 'failed') return '×'
  return '–'
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number | string {
  return typeof value === 'number' && Number.isFinite(value) ? value : t('common.notAvailable')
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function displayValue(value: unknown): string {
  return formatMaybeLocalTime(value)
}

function displaySourceType(value: unknown): string {
  return String(value) === 'ldap'
    ? t('settings.identitySources.types.ldap')
    : t('settings.identitySources.types.activeDirectory')
}

function displayEnabled(value: unknown): string {
  return value === false ? t('settings.identitySources.status.disabled') : t('settings.identitySources.status.enabled')
}

function displayServer(value: unknown): string {
  return normalizeHost(String(value ?? '')) || '—'
}

onMounted(async () => {
  await Promise.all([reloadSources(), loadRoles()])
})
</script>

<template>
  <section class="gc-page identity-sources">
    <GcPageToolbar>
      <template #actions>
        <button class="gc-button" type="button" :disabled="pageLoading" @click="reloadSources">{{ t('common.refresh') }}</button>
      </template>
      <template #primary>
        <button class="gc-button gc-button--primary" type="button" @click="openCreateDialog">{{ t('settings.identitySources.actions.create') }}</button>
      </template>
    </GcPageToolbar>

    <p v-if="pageError" class="identity-sources__error">{{ pageError }}</p>

    <section class="gc-card identity-sources__table-card">
      <div class="identity-sources__table-head">
        <strong>{{ t('settings.identitySources.table.title') }}</strong>
      </div>
      <div class="identity-sources__table-scroll">
        <table class="identity-sources__table">
          <thead>
            <tr>
              <th>{{ t('settings.identitySources.columns.name') }}</th>
              <th>{{ t('settings.identitySources.columns.type') }}</th>
              <th>{{ t('settings.identitySources.columns.server') }}</th>
              <th>{{ t('settings.identitySources.columns.status') }}</th>
              <th>{{ t('settings.identitySources.columns.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="pageLoading">
              <td colspan="5">{{ t('designSystem.dataTable.loading') }}</td>
            </tr>
            <tr v-else-if="sourceItems.length === 0">
              <td colspan="5">{{ t('settings.identitySources.empty') }}</td>
            </tr>
            <tr v-for="item in sourceItems" v-else :key="String(item.id)">
              <td>
                <div class="identity-sources__name-cell">
                  <strong>{{ displayValue(item.name) }}</strong>
                </div>
              </td>
              <td>{{ displaySourceType(item.type) }}</td>
              <td>{{ displayServer(item.url) }}</td>
              <td>
                <div class="identity-sources__status-cell">
                  <span
                    class="identity-sources__enabled-badge"
                    :class="{ 'identity-sources__enabled-badge--disabled': item.enabled === false }"
                  >
                    {{ displayEnabled(item.enabled) }}
                  </span>
                </div>
              </td>
              <td>
                <div class="identity-sources__row-actions">
                  <button
                    class="gc-button"
                    type="button"
                    :disabled="Boolean(testingSourceId)"
                    @click="openConnectionTest(item)"
                  >
                    {{ testingSourceId === String(item.id) ? t('settings.identitySources.actions.testing') : t('settings.identitySources.actions.testConnection') }}
                  </button>
                  <button class="gc-button" type="button" @click="openEditDialog(item)">{{ t('settings.identitySources.actions.edit') }}</button>
                  <GcConfirmAction
                    :action-name="t('settings.identitySources.actions.delete')"
                    :impact-count="1"
                    :risk-text="t('settings.identitySources.risks.delete')"
                    confirm-text="DELETE"
                    @confirm="removeSource(String(item.id ?? ''))"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <footer class="gc-data-table__footer identity-sources__table-footer">
        {{ t('businessPage.pagination', { page: 1, pageSize: SETTINGS_PAGE_SIZE }) }}
      </footer>
    </section>

    <GcModal
      v-model:open="editorOpen"
      :title="editorMode === 'create' ? t('settings.identitySources.dialog.createTitle') : t('settings.identitySources.dialog.editTitle')"
      :description="editorMode === 'create' ? t('settings.identitySources.dialog.createDescription') : t('settings.identitySources.dialog.editDescription')"
      size="lg"
    >
      <section class="identity-source-form">
        <div class="identity-source-form__grid">
          <label class="identity-source-form__field">
            <span>{{ t('settings.identitySources.fields.name') }} <strong>*</strong></span>
            <input v-model="draft.name" :placeholder="t('settings.identitySources.placeholders.name')" autocomplete="off" />
          </label>
          <label class="identity-source-form__field">
            <span>{{ t('settings.identitySources.fields.domain') }}</span>
            <input v-model="draft.domain" :placeholder="t('settings.identitySources.placeholders.domain')" autocomplete="off" />
          </label>
          <label class="identity-source-form__field">
            <span>{{ t('settings.identitySources.fields.protocol') }} <strong>*</strong></span>
            <div class="identity-source-form__protocols">
              <label class="identity-source-form__protocol-option">
                <input v-model="draft.protocol" type="radio" value="ldap" />
                <span>{{ t('settings.identitySources.protocols.ldap') }}</span>
              </label>
              <label class="identity-source-form__protocol-option">
                <input v-model="draft.protocol" type="radio" value="ldaps" />
                <span>{{ t('settings.identitySources.protocols.ldaps') }}</span>
              </label>
            </div>
          </label>
          <label class="identity-source-form__field">
            <span>{{ t('settings.identitySources.fields.serverAddress') }} <strong>*</strong></span>
            <input v-model="draft.host" :placeholder="t('settings.identitySources.placeholders.serverAddress')" autocomplete="off" />
            <small>{{ t('settings.identitySources.labels.finalUrl', { url: derivedUrl }) }}</small>
          </label>
          <label class="identity-source-form__field">
            <span>{{ t('settings.identitySources.fields.baseDn') }} <strong>*</strong></span>
            <input v-model="draft.baseDn" :placeholder="t('settings.identitySources.placeholders.baseDn')" autocomplete="off" />
          </label>
          <label class="identity-source-form__field">
            <span>{{ t('settings.identitySources.fields.bindDn') }} <strong>*</strong></span>
            <input v-model="draft.bindDn" :placeholder="t('settings.identitySources.placeholders.bindDn')" autocomplete="off" />
          </label>
          <label class="identity-source-form__field identity-source-form__field--full">
            <span>{{ t('settings.identitySources.fields.bindPassword') }} <strong>{{ editorMode === 'create' ? '*' : '' }}</strong></span>
            <input
              v-model="draft.bindPassword"
              type="password"
              :placeholder="editorMode === 'create' ? t('settings.identitySources.placeholders.bindPasswordCreate') : t('settings.identitySources.placeholders.bindPasswordEdit')"
              autocomplete="new-password"
            />
          </label>
        </div>

        <section class="identity-source-form__advanced">
          <button class="identity-source-form__advanced-toggle" type="button" @click="advancedOpen = !advancedOpen">
            {{ advancedOpen ? t('settings.identitySources.actions.collapseAdvanced') : t('settings.identitySources.actions.expandAdvanced') }}
          </button>

          <div v-if="advancedOpen" class="identity-source-form__grid">
            <label class="identity-source-form__field">
              <span>{{ t('settings.identitySources.fields.directoryType') }}</span>
              <select v-model="draft.type">
                <option value="active_directory">{{ t('settings.identitySources.types.activeDirectory') }}</option>
                <option value="ldap">{{ t('settings.identitySources.types.ldap') }}</option>
              </select>
            </label>
            <label class="identity-source-form__field">
              <span>{{ t('settings.identitySources.fields.defaultRole') }}</span>
              <select v-model="draft.defaultRoleId">
                <option value="">{{ t('settings.identitySources.options.unset') }}</option>
                <option v-for="option in roleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="identity-source-form__field">
              <span>{{ t('settings.identitySources.fields.enabled') }}</span>
              <select v-model="draft.enabled">
                <option :value="true">{{ t('settings.identitySources.status.enabled') }}</option>
                <option :value="false">{{ t('settings.identitySources.status.disabledShort') }}</option>
              </select>
            </label>
            <label class="identity-source-form__field identity-source-form__field--full">
              <span>{{ t('settings.identitySources.fields.userDnTemplate') }}</span>
              <input v-model="draft.userDnTemplate" :placeholder="t('settings.identitySources.placeholders.autoByDirectoryType')" autocomplete="off" />
            </label>
            <label class="identity-source-form__field">
              <span>{{ t('settings.identitySources.fields.userFilter') }}</span>
              <input v-model="draft.userFilter" :placeholder="t('settings.identitySources.placeholders.userFilter')" autocomplete="off" />
            </label>
            <label class="identity-source-form__field">
              <span>{{ t('settings.identitySources.fields.groupFilter') }}</span>
              <input v-model="draft.groupFilter" :placeholder="t('settings.identitySources.placeholders.groupFilter')" autocomplete="off" />
            </label>
            <label class="identity-source-form__field identity-source-form__field--full">
              <span>{{ t('settings.identitySources.fields.syncUserFilter') }}</span>
              <input v-model="draft.syncUserFilter" :placeholder="t('settings.identitySources.placeholders.autoByDirectoryType')" autocomplete="off" />
            </label>
            <label class="identity-source-form__checkbox">
              <input v-model="draft.requireGroupMapping" type="checkbox" />
              <span>{{ t('settings.identitySources.fields.requireGroupMapping') }}</span>
            </label>
          </div>
        </section>

        <p v-if="editorError" class="identity-source-form__error">{{ editorError }}</p>
        <p v-else-if="editorMessage" class="identity-source-form__message">{{ editorMessage }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="editorLoading" @click="closeEditor">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="editorDisabled" @click="submitEditor">
          {{ editorLoading ? (editorMode === 'create' ? t('settings.identitySources.actions.creating') : t('settings.identitySources.actions.saving')) : (editorMode === 'create' ? t('settings.identitySources.actions.create') : t('settings.identitySources.actions.saveChanges')) }}
        </button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="connectionTestOpen"
      :title="t('settings.identitySources.test.dialogTitle')"
      :description="t('settings.identitySources.test.dialogDescription', {
        name: displayValue(connectionTestSource?.name),
        server: displayServer(connectionTestSource?.url),
      })"
      size="lg"
      @update:open="(value) => { if (!value) closeConnectionTest() }"
    >
      <section class="identity-source-test">
        <p v-if="connectionTestLoading" class="identity-source-test__loading">
          {{ t('settings.identitySources.test.loading') }}
        </p>
        <p v-else-if="connectionTestError" class="identity-source-test__error">
          {{ connectionTestError }}
        </p>
        <template v-else-if="connectionTestResult">
          <p
            class="identity-source-test__summary"
            :class="connectionTestResult.ok ? 'identity-source-test__summary--passed' : 'identity-source-test__summary--failed'"
          >
            {{ connectionTestSummary(connectionTestResult) }}
          </p>
          <div class="identity-source-test__checks">
            <article
              v-for="check in connectionChecks"
              :key="check.key"
              class="identity-source-test__check"
              :class="`identity-source-test__check--${check.status}`"
            >
              <span class="identity-source-test__icon" aria-hidden="true">{{ connectionCheckIcon(check.status) }}</span>
              <div class="identity-source-test__content">
                <strong>{{ connectionCheckTitle(check.key) }}</strong>
                <span class="identity-source-test__status">{{ connectionCheckStatus(check.status) }}</span>
                <p>{{ connectionCheckMessage(check) }}</p>
              </div>
            </article>
          </div>
        </template>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="connectionTestLoading" @click="closeConnectionTest">
          {{ t('common.close') }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.identity-sources { display: grid; gap: var(--gc-space-5); }
.identity-sources__table-card { overflow: hidden; padding: 0; }
.identity-sources__table-head { display: flex; justify-content: space-between; gap: var(--gc-space-3); padding: var(--gc-space-5) var(--gc-space-6); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); }
.identity-sources__table-head strong { font-size: var(--gc-font-size-md); }
.identity-sources__table-scroll { overflow-x: auto; }
.identity-sources__table-footer {
  padding: var(--gc-space-3) var(--gc-space-5);
  border-top: var(--gc-border-width-default) solid var(--gc-color-border);
  color: var(--gc-color-text-muted);
  background: var(--gc-color-surface-glass);
  font-size: var(--gc-font-size-xs);
  font-weight: 650;
}
.identity-sources__table { width: 100%; border-collapse: collapse; min-width: calc(var(--gc-space-10) * 21); table-layout: fixed; }
.identity-sources__table th,
.identity-sources__table td { padding: var(--gc-space-4) var(--gc-space-6); border-bottom: var(--gc-border-width-default) solid var(--gc-color-border); text-align: left; vertical-align: middle; }
.identity-sources__table th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-subtle); font-size: var(--gc-font-size-xs); font-weight: 850; letter-spacing: 0; }
.identity-sources__table td { font-size: var(--gc-font-size-sm); font-weight: 700; overflow-wrap: anywhere; }
.identity-sources__table th:nth-child(1) { width: 26%; }
.identity-sources__table th:nth-child(2) { width: 18%; }
.identity-sources__table th:nth-child(3) { width: 28%; }
.identity-sources__table th:nth-child(4) { width: 14%; }
.identity-sources__table th:nth-child(5) { width: calc(var(--gc-space-10) * 6); }
.identity-sources__name-cell,
.identity-sources__status-cell { display: grid; gap: var(--gc-space-2); }
.identity-sources__name-cell strong { color: var(--gc-color-text); font-size: var(--gc-font-size-md); font-weight: 900; }
.identity-sources__enabled-badge {
  width: fit-content;
  min-height: var(--gc-control-height-xs);
  display: inline-flex;
  align-items: center;
  border-radius: var(--gc-radius-pill);
  padding: 0 var(--gc-space-2);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
  white-space: nowrap;
}
.identity-sources__enabled-badge { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.identity-sources__enabled-badge--disabled { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.identity-sources__row-actions {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: max-content;
  white-space: nowrap;
}
.identity-sources__table td:last-child { white-space: nowrap; }
.identity-sources__row-actions :deep(.gc-button) { flex: 0 0 auto; white-space: nowrap; }

.identity-source-form__message { margin: 0; color: var(--gc-color-success); font-weight: 800; }
.identity-source-form__error { margin: 0; border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3) var(--gc-space-4); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }
.identity-sources__error { margin: 0; border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3) var(--gc-space-4); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }

.identity-source-form { display: grid; gap: var(--gc-space-4); }
.identity-source-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.identity-source-form__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.identity-source-form__field--full { grid-column: 1 / -1; }
.identity-source-form__field strong { color: var(--gc-color-danger); }
.identity-source-form__field input,
.identity-source-form__field select {
  width: 100%;
  min-height: var(--gc-control-height-md);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-2) var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
  outline: none;
}
.identity-source-form__field input:focus,
.identity-source-form__field select:focus {
  border-color: var(--gc-color-focus);
  box-shadow: var(--gc-shadow-focus);
  background: var(--gc-color-surface-solid);
}
.identity-source-form__field small { color: var(--gc-color-text-muted); font-weight: 650; }
.identity-source-form__protocols { display: flex; gap: var(--gc-space-3); flex-wrap: wrap; min-height: var(--gc-control-height-md); align-items: center; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-control); padding: 0 var(--gc-space-3); background: var(--gc-color-surface-muted); }
.identity-source-form__protocol-option { display: inline-flex; align-items: center; gap: var(--gc-space-2); color: var(--gc-color-text); font-weight: 700; }
.identity-source-form__advanced { display: grid; gap: var(--gc-space-3); border-top: var(--gc-border-width-default) solid var(--gc-color-border); padding-top: var(--gc-space-3); }
.identity-source-form__advanced-toggle { width: fit-content; border: 0; padding: 0; color: var(--gc-color-primary); background: transparent; font-weight: 800; cursor: pointer; }
.identity-source-form__checkbox { display: inline-flex; align-items: center; gap: var(--gc-space-3); color: var(--gc-color-text); font-size: var(--gc-font-size-sm); font-weight: 750; }

.identity-source-test { display: grid; gap: var(--gc-space-4); }
.identity-source-test__loading,
.identity-source-test__error,
.identity-source-test__summary { margin: 0; }
.identity-source-test__loading { color: var(--gc-color-text-muted); font-weight: 750; }
.identity-source-test__error {
  border: var(--gc-border-width-default) solid var(--gc-color-danger-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3);
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-weight: 750;
}
.identity-source-test__summary { font-weight: 800; }
.identity-source-test__summary--passed { color: var(--gc-color-success); }
.identity-source-test__summary--failed { color: var(--gc-color-danger); }
.identity-source-test__checks { display: grid; }
.identity-source-test__check {
  display: grid;
  grid-template-columns: var(--gc-space-8) minmax(0, 1fr);
  gap: var(--gc-space-3);
  align-items: start;
  padding: var(--gc-space-4) 0;
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
}
.identity-source-test__check:first-child { padding-top: 0; }
.identity-source-test__check:last-child { padding-bottom: 0; border-bottom: 0; }
.identity-source-test__icon {
  display: inline-grid;
  place-items: center;
  width: var(--gc-space-6);
  height: var(--gc-space-6);
  border-radius: var(--gc-radius-circle);
  color: var(--gc-color-muted);
  background: var(--gc-color-muted-bg);
  font-size: var(--gc-font-size-lg);
  font-weight: 900;
  line-height: 1;
}
.identity-source-test__check--passed .identity-source-test__icon { color: var(--gc-color-success-soft); background: var(--gc-color-success); }
.identity-source-test__check--failed .identity-source-test__icon { color: var(--gc-color-danger-soft); background: var(--gc-color-danger); }
.identity-source-test__content { display: grid; gap: var(--gc-space-1); }
.identity-source-test__content strong { color: var(--gc-color-text); font-size: var(--gc-font-size-lg); }
.identity-source-test__status { color: var(--gc-color-muted); font-size: var(--gc-font-size-xs); font-weight: 800; }
.identity-source-test__check--passed .identity-source-test__status { color: var(--gc-color-success); }
.identity-source-test__check--failed .identity-source-test__status { color: var(--gc-color-danger); }
.identity-source-test__content p { margin: 0; color: var(--gc-color-text-muted); line-height: 1.55; }

@media (max-width: 53.75rem) {
  .identity-source-form__grid { grid-template-columns: 1fr; }
  .identity-source-form__field--full { grid-column: auto; }
}
</style>
