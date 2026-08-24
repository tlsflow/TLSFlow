<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import {
  createIdentitySource,
  createSecret,
  listIdentitySources,
  listRoles,
  syncIdentitySourceUsers,
  testIdentitySource,
} from '@/api/modules/security.api'
import type { ApiRecord } from '@/api/modules/common'
import { GcModal } from '@/design-system/components'
import SecurityAdminPage, { type SecurityAdminConfig } from './SecurityAdminPage.vue'

type IdentitySourceKind = 'active_directory' | 'ldap'
type IdentityProtocol = 'ldap' | 'ldaps'

interface IdentitySourceDraft {
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
}

const syncSourceId = ref('')
const syncUsernamePrefix = ref('')
const syncPageSize = ref('100')
const syncLoading = ref(false)
const syncMessage = ref('')
const syncError = ref('')
const sourceItems = ref<ApiRecord[]>([])
const roleItems = ref<ApiRecord[]>([])

const createModalOpen = ref(false)
const createLoading = ref(false)
const createError = ref('')
const createMessage = ref('')
const advancedOpen = ref(false)

const draft = reactive<IdentitySourceDraft>(buildDefaultDraft())

function buildDefaultDraft(): IdentitySourceDraft {
  return {
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
  }
}

function resetDraft(): void {
  Object.assign(draft, buildDefaultDraft())
  advancedOpen.value = false
  createError.value = ''
  createMessage.value = ''
}

const config: SecurityAdminConfig = {
  eyebrow: 'IDENTITY SOURCES',
  title: '身份源',
  description: '配置 Microsoft Active Directory 或标准 LDAP。外部目录负责认证与组信息，本地角色与权限仍由平台 RBAC 控制。',
  resourceName: '身份源',
  columns: [
    { key: 'name', title: '名称' },
    { key: 'type', title: '类型' },
    { key: 'enabled', title: '启用' },
    { key: 'url', title: '服务器地址' },
    { key: 'baseDn', title: 'Base DN' },
    { key: 'bindDn', title: '服务账号 DN' },
    { key: 'defaultRoleId', title: '默认角色' },
    { key: 'tlsMode', title: 'TLS' },
    { key: 'lastSyncStatus', title: '最近同步状态' },
    { key: 'lastSyncAt', title: '最近同步时间' },
  ],
  load: async () => {
    const result = await listIdentitySources({ page: 1, pageSize: 50 })
    sourceItems.value = [...(result.data?.items ?? [])]
    return result
  },
}

const sourceOptions = computed(() =>
  sourceItems.value
    .map((item) => ({
      label: `${String(item.name ?? item.id)} / ${String(item.type ?? 'ldap')}`,
      value: String(item.id ?? ''),
    }))
    .filter((item) => item.value),
)

const roleOptions = computed(() =>
  roleItems.value
    .map((item) => ({
      label: String(item.name ?? item.code ?? item.id ?? ''),
      value: String(item.id ?? ''),
    }))
    .filter((item) => item.value),
)

const createDisabled = computed(() => {
  return createLoading.value
    || !draft.name.trim()
    || !draft.host.trim()
    || !draft.baseDn.trim()
    || !draft.bindDn.trim()
    || !draft.bindPassword.trim()
  })

const derivedUrl = computed(() => `${draft.protocol}://${draft.host.trim()}`)

async function reloadSources() {
  const result = await listIdentitySources({ page: 1, pageSize: 50 })
  sourceItems.value = [...(result.data?.items ?? [])]
}

async function loadRoles() {
  const result = await listRoles({ page: 1, pageSize: 200 })
  roleItems.value = [...(result.data?.items ?? [])]
}

async function submitSync() {
  if (!syncSourceId.value || syncLoading.value) return
  syncLoading.value = true
  syncError.value = ''
  syncMessage.value = ''
  try {
    const result = await syncIdentitySourceUsers({
      sourceId: syncSourceId.value,
      usernamePrefix: syncUsernamePrefix.value || undefined,
      pageSize: Number(syncPageSize.value || '100'),
    })
    const data = result.data as Record<string, unknown> | undefined
    syncMessage.value = `同步完成：创建 ${data?.created ?? 0}，更新 ${data?.updated ?? 0}，失败 ${data?.failed ?? 0}`
    await reloadSources()
  } catch (cause) {
    if (cause instanceof ApiClientError) syncError.value = `${cause.message}（${cause.errorCode}）`
    else syncError.value = cause instanceof Error ? cause.message : '同步失败'
  } finally {
    syncLoading.value = false
  }
}

async function quickTest(sourceId: string) {
  syncError.value = ''
  syncMessage.value = ''
  try {
    const result = await testIdentitySource(sourceId)
    syncMessage.value = result.data?.ok ? `连接测试成功：${sourceId}` : `连接测试失败：${sourceId}`
  } catch (cause) {
    if (cause instanceof ApiClientError) syncError.value = `${cause.message}（${cause.errorCode}）`
    else syncError.value = cause instanceof Error ? cause.message : '连接测试失败'
  }
}

function openCreateDialog() {
  resetDraft()
  createModalOpen.value = true
}

function closeCreateDialog() {
  if (createLoading.value) return
  createModalOpen.value = false
}

function normalizeHost(value: string): string {
  return value.trim().replace(/^\s*ldaps?:\/\//i, '').replace(/\/+$/, '')
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

function buildIdentitySourcePayload(bindPasswordSecretRef: string): Record<string, unknown> {
  const type = draft.type
  const domain = draft.domain.trim()
  const userDnTemplate = draft.userDnTemplate.trim() || defaultUserDnTemplate(type, domain)
  const userFilter = draft.userFilter.trim() || defaultUserFilter(type)
  const groupFilter = draft.groupFilter.trim() || defaultGroupFilter()
  const syncUserFilter = draft.syncUserFilter.trim() || defaultSyncUserFilter(type)

  return {
    name: draft.name.trim(),
    type,
    enabled: true,
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

async function submitCreate() {
  if (createDisabled.value) return
  createLoading.value = true
  createError.value = ''
  createMessage.value = ''
  try {
    const secret = await createSecret({
      name: `${draft.name.trim()} LDAP 服务账号密码`,
      type: 'password',
      scopeType: 'global',
      plainText: draft.bindPassword,
    })
    const secretRef = String(secret.data?.secretRef ?? '')
    if (!secretRef) throw new Error('创建服务账号密码 Secret 失败')

    await createIdentitySource(buildIdentitySourcePayload(secretRef))
    createMessage.value = '身份源创建成功'
    createModalOpen.value = false
    await reloadSources()
  } catch (cause) {
    if (cause instanceof ApiClientError) createError.value = `${cause.message}（${cause.errorCode}）`
    else createError.value = cause instanceof Error ? cause.message : '创建身份源失败'
  } finally {
    createLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([reloadSources(), loadRoles()])
})
</script>

<template>
  <section class="identity-sources">
    <section class="gc-card identity-sources__tools">
      <div class="identity-sources__tools-copy">
        <strong>LDAP 用户同步</strong>
        <span>把目录用户同步到本地账号列表，再继续配置本地角色和权限。</span>
      </div>
      <form class="identity-sources__tools-form" @submit.prevent="submitSync">
        <label>
          <span>身份源</span>
          <select v-model="syncSourceId" required>
            <option value="" disabled>请选择身份源</option>
            <option v-for="option in sourceOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label>
          <span>用户名此前缀</span>
          <input v-model="syncUsernamePrefix" type="text" placeholder="可选，例如 ops" />
        </label>
        <label>
          <span>分页大小</span>
          <input v-model="syncPageSize" type="number" min="1" max="200" />
        </label>
        <div class="identity-sources__tool-actions">
          <button class="gc-button" type="button" :disabled="!syncSourceId || syncLoading" @click="quickTest(syncSourceId)">测试连接</button>
          <button class="gc-button gc-button--primary" type="submit" :disabled="!syncSourceId || syncLoading">
            {{ syncLoading ? '同步中...' : '同步 LDAP 用户' }}
          </button>
        </div>
      </form>
      <p v-if="syncMessage" class="identity-sources__message">{{ syncMessage }}</p>
      <p v-if="syncError" class="identity-sources__error">{{ syncError }}</p>
    </section>

    <section class="identity-sources__list">
      <div class="identity-sources__list-actions">
        <button class="gc-button gc-button--primary" type="button" @click="openCreateDialog">创建身份源</button>
      </div>
      <SecurityAdminPage :config="config" />
    </section>

    <GcModal
      v-model:open="createModalOpen"
      title="创建身份源"
      description="先填写基础连接信息；过滤器和目录类型放在高级设置里。"
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
            <span>服务账号密码 <strong>*</strong></span>
            <input v-model="draft.bindPassword" type="password" placeholder="输入服务账号密码" autocomplete="new-password" />
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

        <p v-if="createError" class="identity-source-form__error">{{ createError }}</p>
        <p v-else-if="createMessage" class="identity-source-form__message">{{ createMessage }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="createLoading" @click="closeCreateDialog">取消</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="createDisabled" @click="submitCreate">
          {{ createLoading ? '创建中...' : '创建身份源' }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.identity-sources { display: grid; gap: var(--gc-space-5); }
.identity-sources__tools,
.identity-sources__list { display: grid; gap: var(--gc-space-4); }
.identity-sources__tools { padding: 20px; }
.identity-sources__tools-copy { display: grid; gap: 6px; }
.identity-sources__tools-copy strong { font-size: 18px; }
.identity-sources__tools-copy span { color: var(--gc-color-text-muted); font-weight: 650; }
.identity-sources__tools-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--gc-space-4); align-items: end; }
.identity-sources__tools-form label { display: grid; gap: 7px; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 800; }
.identity-sources__tools-form input,
.identity-sources__tools-form select { width: 100%; min-height: 42px; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 10px 12px; background: var(--gc-color-surface-muted); }
.identity-sources__tool-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.identity-sources__list-actions { display: flex; justify-content: flex-end; }
.identity-sources__message,
.identity-source-form__message { margin: 0; color: #166534; font-weight: 800; }
.identity-sources__error,
.identity-source-form__error { margin: 0; color: var(--gc-color-danger); font-weight: 800; }

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
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgb(96 165 250 / 14%);
  background: #fff;
}
.identity-source-form__field small { color: var(--gc-color-text-muted); font-weight: 650; }
.identity-source-form__protocols { display: flex; gap: var(--gc-space-3); flex-wrap: wrap; min-height: 42px; align-items: center; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 0 12px; background: var(--gc-color-surface-muted); }
.identity-source-form__protocol-option { display: inline-flex; align-items: center; gap: 8px; color: var(--gc-color-text); font-weight: 700; }
.identity-source-form__advanced { display: grid; gap: var(--gc-space-3); border-top: 1px solid var(--gc-color-border); padding-top: var(--gc-space-3); }
.identity-source-form__advanced-toggle { width: fit-content; border: 0; padding: 0; color: var(--gc-color-primary); background: transparent; font-weight: 800; cursor: pointer; }
.identity-source-form__checkbox { display: inline-flex; align-items: center; gap: 10px; color: var(--gc-color-text); font-size: var(--gc-font-size-sm); font-weight: 750; }

@media (max-width: 860px) {
  .identity-source-form__grid { grid-template-columns: 1fr; }
  .identity-source-form__field--full { grid-column: auto; }
}
</style>
