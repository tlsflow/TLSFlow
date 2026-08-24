<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import type { ApiRecord } from '@/api/modules/common'
import {
  createIdentitySource,
  createSecret,
  deleteIdentitySource,
  listIdentitySources,
  listRoles,
  updateIdentitySource,
} from '@/api/modules/security.api'
import { GcConfirmAction, GcModal } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

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

const deletingId = ref('')

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

async function reloadSources() {
  pageLoading.value = true
  pageError.value = ''
  try {
    const result = await listIdentitySources({ page: 1, pageSize: 50 })
    sourceItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    if (cause instanceof ApiClientError) pageError.value = `${cause.message}（${cause.errorCode}）`
    else pageError.value = cause instanceof Error ? cause.message : '加载身份源失败'
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
    name: `${draft.name.trim()} LDAP 服务账号密码`,
    type: 'password',
    scopeType: 'global',
    plainText: draft.bindPassword,
  })
  const secretRef = String(secret.data?.secretRef ?? '')
  if (!secretRef) throw new Error('创建服务账号密码 Secret 失败')
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
      editorMessage.value = '身份源创建成功'
    } else {
      if (!bindPasswordSecretRef) delete payload.bindPasswordSecretRef
      await updateIdentitySource(payload)
      editorMessage.value = '身份源更新成功'
    }
    editorOpen.value = false
    await reloadSources()
  } catch (cause) {
    if (cause instanceof ApiClientError) editorError.value = `${cause.message}（${cause.errorCode}）`
    else editorError.value = cause instanceof Error ? cause.message : (editorMode.value === 'create' ? '创建身份源失败' : '更新身份源失败')
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
    else pageError.value = cause instanceof Error ? cause.message : '删除身份源失败'
  } finally {
    deletingId.value = ''
  }
}

function displayValue(value: unknown): string {
  return formatMaybeLocalTime(value)
}

function displaySourceType(value: unknown): string {
  return String(value) === 'ldap' ? '标准 LDAP' : 'Active Directory'
}

function displayEnabled(value: unknown): string {
  return value === false ? '已停用' : '已启用'
}

function displayServer(value: unknown): string {
  return normalizeHost(String(value ?? '')) || '—'
}

onMounted(async () => {
  await Promise.all([reloadSources(), loadRoles()])
})
</script>

<template>
  <section class="identity-sources">
    <header class="identity-sources__header">
      <div class="identity-sources__header-actions">
        <button class="gc-button gc-button--primary" type="button" @click="openCreateDialog">创建身份源</button>
        <button class="gc-button" type="button" :disabled="pageLoading" @click="reloadSources">刷新</button>
      </div>
    </header>

    <p v-if="pageError" class="identity-sources__error">{{ pageError }}</p>

    <section class="gc-card identity-sources__table-card">
      <div class="identity-sources__table-head">
        <strong>身份源列表</strong>
        <span>共 {{ sourceItems.length }} 条</span>
      </div>
      <div class="identity-sources__table-scroll">
        <table class="identity-sources__table">
          <thead>
            <tr>
              <th>名称</th>
              <th>目录类型</th>
              <th>服务器</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="pageLoading">
              <td colspan="5">加载中...</td>
            </tr>
            <tr v-else-if="sourceItems.length === 0">
              <td colspan="5">暂无身份源</td>
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
                  <button class="gc-button" type="button" @click="openEditDialog(item)">编辑</button>
                  <GcConfirmAction
                    action-name="删除"
                    :impact-count="1"
                    risk-text="删除身份源后，该目录的登录、同步和组映射都会失效。"
                    confirm-text="DELETE"
                    @confirm="removeSource(String(item.id ?? ''))"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <GcModal
      v-model:open="editorOpen"
      :title="editorMode === 'create' ? '创建身份源' : '编辑身份源'"
      :description="editorMode === 'create' ? '先填写基础连接信息；过滤器和目录类型放在高级设置里。' : '修改身份源配置；若要更新服务账号密码，请重新填写密码。'"
      size="lg"
    >
      <section class="identity-source-form">
        <div class="identity-source-form__grid">
          <label class="identity-source-form__field">
            <span>名称 <strong>*</strong></span>
            <input v-model="draft.name" placeholder="例如：企业 AD" autocomplete="off" />
          </label>
          <label class="identity-source-form__field">
            <span>域名</span>
            <input v-model="draft.domain" placeholder="example.com" autocomplete="off" />
          </label>
          <label class="identity-source-form__field">
            <span>协议 <strong>*</strong></span>
            <div class="identity-source-form__protocols">
              <label class="identity-source-form__protocol-option">
                <input v-model="draft.protocol" type="radio" value="ldap" />
                <span>LDAP</span>
              </label>
              <label class="identity-source-form__protocol-option">
                <input v-model="draft.protocol" type="radio" value="ldaps" />
                <span>LDAPS</span>
              </label>
            </div>
          </label>
          <label class="identity-source-form__field">
            <span>服务器地址 <strong>*</strong></span>
            <input v-model="draft.host" placeholder="ad.example.com:636" autocomplete="off" />
            <small>最终地址：{{ derivedUrl }}</small>
          </label>
          <label class="identity-source-form__field">
            <span>Base DN <strong>*</strong></span>
            <input v-model="draft.baseDn" placeholder="DC=example,DC=com" autocomplete="off" />
          </label>
          <label class="identity-source-form__field">
            <span>服务账号 DN <strong>*</strong></span>
            <input v-model="draft.bindDn" placeholder="CN=svc-gcac,OU=Users,DC=example,DC=com" autocomplete="off" />
          </label>
          <label class="identity-source-form__field identity-source-form__field--full">
            <span>服务账号密码 <strong>{{ editorMode === 'create' ? '*' : '' }}</strong></span>
            <input
              v-model="draft.bindPassword"
              type="password"
              :placeholder="editorMode === 'create' ? '输入服务账号密码' : '留空表示沿用现有密码'"
              autocomplete="new-password"
            />
          </label>
        </div>

        <section class="identity-source-form__advanced">
          <button class="identity-source-form__advanced-toggle" type="button" @click="advancedOpen = !advancedOpen">
            {{ advancedOpen ? '收起高级设置' : '展开高级设置' }}
          </button>

          <div v-if="advancedOpen" class="identity-source-form__grid">
            <label class="identity-source-form__field">
              <span>目录类型</span>
              <select v-model="draft.type">
                <option value="active_directory">Microsoft Active Directory</option>
                <option value="ldap">标准 LDAP</option>
              </select>
            </label>
            <label class="identity-source-form__field">
              <span>默认角色</span>
              <select v-model="draft.defaultRoleId">
                <option value="">不设置</option>
                <option v-for="option in roleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label class="identity-source-form__field">
              <span>启用状态</span>
              <select v-model="draft.enabled">
                <option :value="true">启用</option>
                <option :value="false">禁用</option>
              </select>
            </label>
            <label class="identity-source-form__field identity-source-form__field--full">
              <span>用户 DN/UPN 模板</span>
              <input v-model="draft.userDnTemplate" placeholder="留空则按目录类型自动推导" autocomplete="off" />
            </label>
            <label class="identity-source-form__field">
              <span>用户过滤器</span>
              <input v-model="draft.userFilter" placeholder="例如：(uid={{username}})" autocomplete="off" />
            </label>
            <label class="identity-source-form__field">
              <span>组过滤器</span>
              <input v-model="draft.groupFilter" placeholder="例如：(member={{userDn}})" autocomplete="off" />
            </label>
            <label class="identity-source-form__field identity-source-form__field--full">
              <span>同步用户过滤器</span>
              <input v-model="draft.syncUserFilter" placeholder="留空则按目录类型自动推导" autocomplete="off" />
            </label>
            <label class="identity-source-form__checkbox">
              <input v-model="draft.requireGroupMapping" type="checkbox" />
              <span>要求登录用户必须命中组映射</span>
            </label>
          </div>
        </section>

        <p v-if="editorError" class="identity-source-form__error">{{ editorError }}</p>
        <p v-else-if="editorMessage" class="identity-source-form__message">{{ editorMessage }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="editorLoading" @click="closeEditor">取消</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="editorDisabled" @click="submitEditor">
          {{ editorLoading ? (editorMode === 'create' ? '创建中...' : '保存中...') : (editorMode === 'create' ? '创建身份源' : '保存修改') }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.identity-sources { display: grid; gap: var(--gc-space-5); }
.identity-sources__header { display: flex; justify-content: flex-end; gap: var(--gc-space-4); align-items: flex-start; }
.identity-sources__header-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }

.identity-sources__table-card { overflow: hidden; padding: 0; }
.identity-sources__table-head { display: flex; justify-content: space-between; gap: var(--gc-space-3); padding: 18px 20px; border-bottom: 1px solid var(--gc-color-border); }
.identity-sources__table-head strong { font-size: 17px; }
.identity-sources__table-head span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 700; }
.identity-sources__table-scroll { overflow-x: auto; }
.identity-sources__table { width: 100%; border-collapse: collapse; min-width: 840px; table-layout: fixed; }
.identity-sources__table th,
.identity-sources__table td { padding: 16px 24px; border-bottom: 1px solid var(--gc-color-border); text-align: left; vertical-align: middle; }
.identity-sources__table th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-subtle); font-size: var(--gc-font-size-xs); font-weight: 850; letter-spacing: 0; }
.identity-sources__table td { font-size: var(--gc-font-size-sm); font-weight: 700; overflow-wrap: anywhere; }
.identity-sources__table th:nth-child(1) { width: 26%; }
.identity-sources__table th:nth-child(2) { width: 18%; }
.identity-sources__table th:nth-child(3) { width: 28%; }
.identity-sources__table th:nth-child(4) { width: 14%; }
.identity-sources__table th:nth-child(5) { width: 170px; }
.identity-sources__name-cell,
.identity-sources__status-cell { display: grid; gap: 7px; }
.identity-sources__name-cell strong { color: var(--gc-color-text); font-size: 15px; font-weight: 900; }
.identity-sources__enabled-badge {
  width: fit-content;
  min-height: 26px;
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0 10px;
  font-size: 12px;
  font-weight: 850;
  white-space: nowrap;
}
.identity-sources__enabled-badge { color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.identity-sources__enabled-badge--disabled { color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.identity-sources__row-actions { display: flex; flex-wrap: nowrap; align-items: center; gap: var(--gc-space-2); min-width: 142px; white-space: nowrap; }
.identity-sources__row-actions :deep(.gc-button) { flex: 0 0 auto; white-space: nowrap; }

.identity-source-form__message { margin: 0; color: var(--gc-color-success); font-weight: 800; }
.identity-source-form__error { margin: 0; border: 1px solid var(--gc-color-danger-border); border-radius: 14px; padding: 12px 14px; color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }
.identity-sources__error { margin: 0; border: 1px solid var(--gc-color-danger-border); border-radius: 14px; padding: 12px 14px; color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }

.identity-source-form { display: grid; gap: var(--gc-space-4); }
.identity-source-form__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.identity-source-form__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.identity-source-form__field--full { grid-column: 1 / -1; }
.identity-source-form__field strong { color: var(--gc-color-danger); }
.identity-source-form__field input,
.identity-source-form__field select {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
  outline: none;
}
.identity-source-form__field input:focus,
.identity-source-form__field select:focus {
  border-color: var(--gc-color-focus);
  box-shadow: 0 0 0 4px var(--gc-color-focus-ring);
  background: var(--gc-color-surface-solid);
}
.identity-source-form__field small { color: var(--gc-color-text-muted); font-weight: 650; }
.identity-source-form__protocols { display: flex; gap: var(--gc-space-3); flex-wrap: wrap; min-height: 42px; align-items: center; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 0 12px; background: var(--gc-color-surface-muted); }
.identity-source-form__protocol-option { display: inline-flex; align-items: center; gap: 8px; color: var(--gc-color-text); font-weight: 700; }
.identity-source-form__advanced { display: grid; gap: var(--gc-space-3); border-top: 1px solid var(--gc-color-border); padding-top: var(--gc-space-3); }
.identity-source-form__advanced-toggle { width: fit-content; border: 0; padding: 0; color: var(--gc-color-primary); background: transparent; font-weight: 800; cursor: pointer; }
.identity-source-form__checkbox { display: inline-flex; align-items: center; gap: 10px; color: var(--gc-color-text); font-size: var(--gc-font-size-sm); font-weight: 750; }

@media (max-width: 860px) {
  .identity-sources__header { flex-direction: column; }
  .identity-source-form__grid { grid-template-columns: 1fr; }
  .identity-source-form__field--full { grid-column: auto; }
}
</style>
