<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import type { ApiRecord } from '@/api/modules/common'
import {
  createExternalGroup,
  createExternalUser,
  createGroup,
  createUser,
  deleteUser,
  listGroups,
  listIdentitySources,
  listRoles,
  listUsers,
  lookupExternalGroup,
  lookupExternalUser,
  type ExternalGroupLookupResponse,
  updateUser,
  type ExternalUserLookupResponse,
} from '@/api/modules/security.api'
import { GcConfirmAction, GcModal } from '@/design-system/components'
import { formatMaybeLocalTime } from '@/utils/browser-local-time'

interface UserDraft {
  createMode: 'local' | 'external'
  userId: string
  username: string
  displayName: string
  email: string
  password: string
  roleId: string
  sourceId: string
  externalUsername: string
  status: 'active' | 'disabled'
}

interface GroupDraft {
  createMode: 'local' | 'external'
  name: string
  code: string
  sourceId: string
  externalGroupName: string
}

const userItems = ref<ApiRecord[]>([])
const groupItems = ref<ApiRecord[]>([])
const roleItems = ref<ApiRecord[]>([])
const identitySourceItems = ref<ApiRecord[]>([])
const activeDirectoryTab = ref<'users' | 'groups'>('users')
const selectedUserIds = ref<string[]>([])
const pageLoading = ref(false)
const pageError = ref('')

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editorLoading = ref(false)
const editorError = ref('')
const lookupLoading = ref(false)
const lookupProfile = ref<ExternalUserLookupResponse | null>(null)
const groupEditorOpen = ref(false)
const groupEditorLoading = ref(false)
const groupEditorError = ref('')
const groupLookupLoading = ref(false)
const groupLookupProfile = ref<ExternalGroupLookupResponse | null>(null)

const draft = reactive<UserDraft>(buildDefaultDraft())
const groupDraft = reactive<GroupDraft>(buildDefaultGroupDraft())

function buildDefaultDraft(): UserDraft {
  return {
    createMode: 'local',
    userId: '',
    username: '',
    displayName: '',
    email: '',
    password: '',
    roleId: '',
    sourceId: '',
    externalUsername: '',
    status: 'active',
  }
}

function buildDefaultGroupDraft(): GroupDraft {
  return {
    createMode: 'local',
    name: '',
    code: '',
    sourceId: '',
    externalGroupName: '',
  }
}

function resetDraft(): void {
  Object.assign(draft, buildDefaultDraft())
  editorError.value = ''
  lookupProfile.value = null
}

function resetGroupDraft(): void {
  Object.assign(groupDraft, buildDefaultGroupDraft())
  groupEditorError.value = ''
  groupLookupProfile.value = null
}

const roleOptions = computed(() =>
  roleItems.value
    .map((item) => ({
      label: String(item.name ?? item.code ?? item.id ?? ''),
      value: String(item.id ?? ''),
    }))
    .filter((item) => item.value),
)

const identitySourceOptions = computed(() =>
  identitySourceItems.value
    .filter((item) => item.enabled !== false)
    .map((item) => ({
      label: String(item.name ?? item.id ?? ''),
      value: String(item.id ?? ''),
      type: String(item.type ?? 'ldap'),
    }))
    .filter((item) => item.value),
)

const selectedCount = computed(() => selectedUserIds.value.length)
const activeListSummary = computed(() => {
  if (activeDirectoryTab.value === 'groups') return `共 ${groupItems.value.length} 条`
  return `共 ${userItems.value.length} 条，已选 ${selectedCount.value} 条`
})
const allSelectableIds = computed(() =>
  userItems.value
    .map((item) => String(item.id ?? ''))
    .filter((id) => id && id !== 'user_admin'),
)
const allSelected = computed(() =>
  allSelectableIds.value.length > 0 && allSelectableIds.value.every((id) => selectedUserIds.value.includes(id)),
)

const editorDisabled = computed(() => {
  if (editorLoading.value) return true
  if (editorMode.value === 'edit') return !draft.displayName.trim()
  if (draft.createMode === 'external') {
    return !draft.sourceId || !draft.externalUsername.trim() || !lookupProfile.value
  }
  return !draft.displayName.trim() || !draft.username.trim() || !draft.password.trim()
})

const groupEditorDisabled = computed(() => {
  if (groupEditorLoading.value) return true
  if (groupDraft.createMode === 'external') {
    return !groupDraft.sourceId || !groupDraft.externalGroupName.trim() || !groupLookupProfile.value
  }
  return !groupDraft.name.trim()
})

async function reloadUsers() {
  pageLoading.value = true
  pageError.value = ''
  try {
    const result = await listUsers({ page: 1, pageSize: 50 })
    userItems.value = [...(result.data?.items ?? [])]
    selectedUserIds.value = selectedUserIds.value.filter((id) => userItems.value.some((item) => String(item.id ?? '') === id))
  } catch (cause) {
    if (cause instanceof ApiClientError) pageError.value = `${cause.message}（${cause.errorCode}）`
    else pageError.value = cause instanceof Error ? cause.message : '加载用户失败'
  } finally {
    pageLoading.value = false
  }
}

async function reloadGroups() {
  try {
    const result = await listGroups({ page: 1, pageSize: 100 })
    groupItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    if (cause instanceof ApiClientError) pageError.value = `${cause.message}（${cause.errorCode}）`
    else pageError.value = cause instanceof Error ? cause.message : '加载用户组失败'
  }
}

async function refreshDirectory() {
  pageLoading.value = true
  await Promise.all([reloadUsers(), reloadGroups()])
}

async function loadRoles() {
  const result = await listRoles({ page: 1, pageSize: 200 })
  roleItems.value = [...(result.data?.items ?? [])]
}

async function loadIdentitySources() {
  const result = await listIdentitySources({ page: 1, pageSize: 200 })
  identitySourceItems.value = [...(result.data?.items ?? [])]
}

function openCreateDialog() {
  resetDraft()
  editorMode.value = 'create'
  editorOpen.value = true
}

function openCreateGroupDialog() {
  resetGroupDraft()
  groupEditorOpen.value = true
}

function openEditDialog(item: ApiRecord) {
  resetDraft()
  editorMode.value = 'edit'
  draft.userId = String(item.id ?? '')
  draft.username = String(item.username ?? '')
  draft.displayName = String(item.displayName ?? '')
  draft.email = String(item.email ?? '')
  draft.sourceId = String(item.externalSourceId ?? '')
  draft.status = String(item.status ?? 'active') === 'disabled' ? 'disabled' : 'active'
  editorOpen.value = true
}

function closeEditor() {
  if (!editorLoading.value) editorOpen.value = false
}

function closeGroupEditor() {
  if (!groupEditorLoading.value) groupEditorOpen.value = false
}

function clearExternalLookup() {
  lookupProfile.value = null
}

function clearExternalGroupLookup() {
  groupLookupProfile.value = null
}

function toggleSelectAll(checked: boolean) {
  selectedUserIds.value = checked ? [...allSelectableIds.value] : []
}

function toggleSelection(userId: string, checked: boolean) {
  if (checked) {
    if (!selectedUserIds.value.includes(userId)) selectedUserIds.value = [...selectedUserIds.value, userId]
    return
  }
  selectedUserIds.value = selectedUserIds.value.filter((id) => id !== userId)
}

async function submitEditor() {
  if (editorDisabled.value) return
  editorLoading.value = true
  editorError.value = ''
  try {
    if (editorMode.value === 'create') {
      if (draft.createMode === 'external') {
        await createExternalUser({
          sourceId: draft.sourceId,
          username: draft.externalUsername.trim(),
          roleId: draft.roleId || undefined,
        })
      } else {
        await createUser({
          username: draft.username.trim(),
          displayName: draft.displayName.trim(),
          email: draft.email.trim() || undefined,
          password: draft.password,
          roleId: draft.roleId || undefined,
        })
      }
    } else {
      await updateUser({
        userId: draft.userId,
        displayName: draft.displayName.trim(),
        email: draft.email.trim() || undefined,
        roleId: draft.roleId || undefined,
        status: draft.status,
      })
    }
    editorOpen.value = false
    await reloadUsers()
  } catch (cause) {
    if (cause instanceof ApiClientError) editorError.value = `${cause.message}（${cause.errorCode}）`
    else editorError.value = cause instanceof Error ? cause.message : (editorMode.value === 'create' ? '创建用户失败' : '更新用户失败')
  } finally {
    editorLoading.value = false
  }
}

async function lookupExternalProfile() {
  if (!draft.sourceId || !draft.externalUsername.trim() || lookupLoading.value) return
  lookupLoading.value = true
  editorError.value = ''
  lookupProfile.value = null
  try {
    const result = await lookupExternalUser({
      sourceId: draft.sourceId,
      username: draft.externalUsername.trim(),
    })
    if (!result.data) throw new Error('身份源没有返回用户资料')
    lookupProfile.value = result.data
    draft.username = result.data.username
    draft.displayName = result.data.displayName
    draft.email = result.data.email ?? ''
  } catch (cause) {
    if (cause instanceof ApiClientError) editorError.value = `${cause.message}（${cause.errorCode}）`
    else editorError.value = cause instanceof Error ? cause.message : '检索身份源用户失败'
  } finally {
    lookupLoading.value = false
  }
}

async function lookupExternalGroupProfile() {
  if (!groupDraft.sourceId || !groupDraft.externalGroupName.trim() || groupLookupLoading.value) return
  groupLookupLoading.value = true
  groupEditorError.value = ''
  groupLookupProfile.value = null
  try {
    const result = await lookupExternalGroup({
      sourceId: groupDraft.sourceId,
      groupName: groupDraft.externalGroupName.trim(),
    })
    if (!result.data) throw new Error('身份源没有返回用户组资料')
    groupLookupProfile.value = result.data
    groupDraft.name = result.data.name
    groupDraft.code = result.data.code
  } catch (cause) {
    if (cause instanceof ApiClientError) groupEditorError.value = `${cause.message}（${cause.errorCode}）`
    else groupEditorError.value = cause instanceof Error ? cause.message : '检索身份源用户组失败'
  } finally {
    groupLookupLoading.value = false
  }
}

async function submitGroupEditor() {
  if (groupEditorDisabled.value) return
  groupEditorLoading.value = true
  groupEditorError.value = ''
  try {
    if (groupDraft.createMode === 'external') {
      await createExternalGroup({
        sourceId: groupDraft.sourceId,
        groupName: groupDraft.externalGroupName.trim(),
      })
    } else {
      await createGroup({
        name: groupDraft.name.trim(),
        code: groupDraft.code.trim() || undefined,
      })
    }
    groupEditorOpen.value = false
    activeDirectoryTab.value = 'groups'
    await reloadGroups()
  } catch (cause) {
    if (cause instanceof ApiClientError) groupEditorError.value = `${cause.message}（${cause.errorCode}）`
    else groupEditorError.value = cause instanceof Error ? cause.message : '创建用户组失败'
  } finally {
    groupEditorLoading.value = false
  }
}

async function removeUsers(userIds: string[]) {
  if (userIds.length === 0) return
  pageError.value = ''
  try {
    await Promise.all(userIds.map((userId) => deleteUser(userId)))
    selectedUserIds.value = selectedUserIds.value.filter((id) => !userIds.includes(id))
    await reloadUsers()
  } catch (cause) {
    if (cause instanceof ApiClientError) pageError.value = `${cause.message}（${cause.errorCode}）`
    else pageError.value = cause instanceof Error ? cause.message : '删除用户失败'
  }
}

function isBuiltinAdmin(item: ApiRecord): boolean {
  return String(item.id ?? '') === 'user_admin'
}

function displayValue(value: unknown): string {
  return formatMaybeLocalTime(value)
}

onMounted(async () => {
  await Promise.all([refreshDirectory(), loadRoles(), loadIdentitySources()])
})
</script>

<template>
  <section class="users-view">
    <header class="users-view__header">
      <div class="users-view__header-actions">
        <button class="gc-button gc-button--primary" type="button" @click="openCreateDialog">创建用户</button>
        <button class="gc-button" type="button" @click="openCreateGroupDialog">添加组</button>
        <GcConfirmAction
          v-if="selectedCount > 0"
          action-name="批量删除"
          :impact-count="selectedCount"
          risk-text="批量删除会移除所选用户的本地凭据和角色关联。"
          confirm-text="DELETE"
          @confirm="removeUsers(selectedUserIds)"
        />
        <button class="gc-button" type="button" :disabled="pageLoading" @click="refreshDirectory">刷新</button>
      </div>
    </header>

    <p v-if="pageError" class="users-view__error">{{ pageError }}</p>

    <section class="gc-card users-view__table-card">
      <div class="users-view__table-head">
        <div class="users-view__table-title">
          <strong>账号主体列表</strong>
          <div class="users-view__tabs" aria-label="主体类型">
            <button
              type="button"
              :class="{ 'users-view__tab--active': activeDirectoryTab === 'users' }"
              @click="activeDirectoryTab = 'users'"
            >
              用户
            </button>
            <button
              type="button"
              :class="{ 'users-view__tab--active': activeDirectoryTab === 'groups' }"
              @click="activeDirectoryTab = 'groups'"
            >
              组
            </button>
          </div>
        </div>
        <span>{{ activeListSummary }}</span>
      </div>
      <div class="users-view__table-scroll">
        <table v-if="activeDirectoryTab === 'users'" class="users-view__table">
          <thead>
            <tr>
              <th class="users-view__checkbox-col">
                <input
                  type="checkbox"
                  :checked="allSelected"
                  :disabled="allSelectableIds.length === 0"
                  @change="toggleSelectAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th>用户名</th>
              <th>显示名</th>
              <th>邮箱</th>
              <th>来源</th>
              <th>身份源名称</th>
              <th>状态</th>
              <th>租户</th>
              <th>角色</th>
              <th>最近同步</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="pageLoading">
              <td colspan="12">加载中...</td>
            </tr>
            <tr v-else-if="userItems.length === 0">
              <td colspan="12">暂无用户</td>
            </tr>
            <tr v-for="item in userItems" v-else :key="String(item.id)">
              <td class="users-view__checkbox-col">
                <input
                  type="checkbox"
                  :checked="selectedUserIds.includes(String(item.id ?? ''))"
                  :disabled="isBuiltinAdmin(item)"
                  @change="toggleSelection(String(item.id ?? ''), ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td>{{ displayValue(item.username) }}</td>
              <td>{{ displayValue(item.displayName) }}</td>
              <td>{{ displayValue(item.email) }}</td>
              <td>{{ displayValue(item.identityProvider) }}</td>
              <td>{{ displayValue(item.externalSourceName ?? item.externalSourceId) }}</td>
              <td>{{ displayValue(item.status) }}</td>
              <td>{{ displayValue(item.tenantName) }}</td>
              <td>{{ displayValue(item.roleNames) }}</td>
              <td>{{ displayValue(item.lastSyncedAt) }}</td>
              <td>{{ displayValue(item.updatedAt) }}</td>
              <td>
                <div class="users-view__row-actions">
                  <button class="gc-button" type="button" @click="openEditDialog(item)">编辑</button>
                  <GcConfirmAction
                    v-if="!isBuiltinAdmin(item)"
                    action-name="删除"
                    :impact-count="1"
                    risk-text="删除用户会移除该账号的本地凭据和角色关联。"
                    confirm-text="DELETE"
                    @confirm="removeUsers([String(item.id ?? '')])"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <table v-else class="users-view__table users-view__table--groups">
          <thead>
            <tr>
              <th>组名称</th>
              <th>编码</th>
              <th>来源</th>
              <th>身份源名称</th>
              <th>外部标识</th>
              <th>状态</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="pageLoading">
              <td colspan="7">加载中...</td>
            </tr>
            <tr v-else-if="groupItems.length === 0">
              <td colspan="7">暂无用户组</td>
            </tr>
            <tr v-for="item in groupItems" v-else :key="String(item.id)">
              <td>{{ displayValue(item.name) }}</td>
              <td>{{ displayValue(item.code) }}</td>
              <td>{{ displayValue(item.source) }}</td>
              <td>{{ displayValue(item.externalSourceName ?? item.externalSourceId) }}</td>
              <td>{{ displayValue(item.externalRef) }}</td>
              <td>{{ displayValue(item.enabled === false ? 'disabled' : 'active') }}</td>
              <td>{{ displayValue(item.updatedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <GcModal
      v-model:open="editorOpen"
      :title="editorMode === 'create' ? '创建用户' : '编辑用户'"
      :description="editorMode === 'create' ? '创建本地用户，或从身份源按用户名检索后创建绑定用户。' : '编辑用户的显示名、邮箱、状态和角色。'"
      size="md"
    >
      <section class="users-view__form">
        <div v-if="editorMode === 'create'" class="users-view__mode-switch" aria-label="创建方式">
          <label :class="{ 'users-view__mode-option--active': draft.createMode === 'local' }">
            <input v-model="draft.createMode" type="radio" value="local" @change="clearExternalLookup" />
            <span>本地用户</span>
          </label>
          <label :class="{ 'users-view__mode-option--active': draft.createMode === 'external' }">
            <input v-model="draft.createMode" type="radio" value="external" @change="clearExternalLookup" />
            <span>身份源用户</span>
          </label>
        </div>

        <div class="users-view__form-grid">
          <label v-if="editorMode === 'create' && draft.createMode === 'external'" class="users-view__field">
            <span>身份源 <strong>*</strong></span>
            <select v-model="draft.sourceId" @change="clearExternalLookup">
              <option value="" disabled>请选择身份源</option>
              <option v-for="option in identitySourceOptions" :key="option.value" :value="option.value">
                {{ option.label }}（{{ option.type === 'active_directory' ? 'AD' : 'LDAP' }}）
              </option>
            </select>
          </label>
          <label v-if="editorMode === 'create' && draft.createMode === 'external'" class="users-view__field">
            <span>目录用户名 <strong>*</strong></span>
            <input v-model="draft.externalUsername" placeholder="例如 jackson" autocomplete="off" @input="clearExternalLookup" />
          </label>
          <label v-if="editorMode !== 'create' || draft.createMode === 'local'" class="users-view__field">
            <span>用户名 <strong v-if="editorMode === 'create'">*</strong></span>
            <input v-model="draft.username" :disabled="editorMode === 'edit'" placeholder="operator" autocomplete="off" />
          </label>
          <label v-if="editorMode !== 'create' || draft.createMode === 'local'" class="users-view__field">
            <span>显示名 <strong>*</strong></span>
            <input v-model="draft.displayName" placeholder="证书操作员" autocomplete="off" />
          </label>
          <label v-if="editorMode !== 'create' || draft.createMode === 'local'" class="users-view__field">
            <span>邮箱</span>
            <input v-model="draft.email" placeholder="ops@example.com" autocomplete="off" />
          </label>
          <label class="users-view__field">
            <span>角色</span>
            <select v-model="draft.roleId">
              <option value="">不设置</option>
              <option v-for="option in roleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <label v-if="editorMode === 'create' && draft.createMode === 'local'" class="users-view__field">
            <span>初始密码 <strong>*</strong></span>
            <input v-model="draft.password" type="password" placeholder="输入初始密码" autocomplete="new-password" />
          </label>
          <label v-if="editorMode === 'edit'" class="users-view__field">
            <span>状态</span>
            <select v-model="draft.status">
              <option value="active">启用</option>
              <option value="disabled">禁用</option>
            </select>
          </label>
        </div>

        <div v-if="editorMode === 'create' && draft.createMode === 'external'" class="users-view__lookup">
          <button class="gc-button" type="button" :disabled="lookupLoading || !draft.sourceId || !draft.externalUsername.trim()" @click="lookupExternalProfile">
            {{ lookupLoading ? '检索中...' : '检索用户' }}
          </button>
          <section v-if="lookupProfile" class="users-view__profile-preview" aria-label="身份源用户资料">
            <div>
              <span>用户名</span>
              <strong>{{ lookupProfile.username }}</strong>
            </div>
            <div>
              <span>显示名</span>
              <strong>{{ lookupProfile.displayName }}</strong>
            </div>
            <div>
              <span>邮箱</span>
              <strong>{{ lookupProfile.email || '—' }}</strong>
            </div>
            <div>
              <span>身份源</span>
              <strong>{{ lookupProfile.sourceName }}</strong>
            </div>
          </section>
        </div>

        <p v-if="editorError" class="users-view__error">{{ editorError }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="editorLoading" @click="closeEditor">取消</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="editorDisabled" @click="submitEditor">
          {{ editorLoading ? (editorMode === 'create' ? '创建中...' : '保存中...') : (editorMode === 'create' ? '创建用户' : '保存修改') }}
        </button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="groupEditorOpen"
      title="添加组"
      description="创建本地组，或从身份源按组名称检索后添加外部组。"
      size="md"
    >
      <section class="users-view__form">
        <div class="users-view__mode-switch" aria-label="创建组方式">
          <label :class="{ 'users-view__mode-option--active': groupDraft.createMode === 'local' }">
            <input v-model="groupDraft.createMode" type="radio" value="local" @change="clearExternalGroupLookup" />
            <span>本地组</span>
          </label>
          <label :class="{ 'users-view__mode-option--active': groupDraft.createMode === 'external' }">
            <input v-model="groupDraft.createMode" type="radio" value="external" @change="clearExternalGroupLookup" />
            <span>身份源组</span>
          </label>
        </div>

        <div class="users-view__form-grid">
          <label v-if="groupDraft.createMode === 'external'" class="users-view__field">
            <span>身份源 <strong>*</strong></span>
            <select v-model="groupDraft.sourceId" @change="clearExternalGroupLookup">
              <option value="" disabled>请选择身份源</option>
              <option v-for="option in identitySourceOptions" :key="option.value" :value="option.value">
                {{ option.label }}（{{ option.type === 'active_directory' ? 'AD' : 'LDAP' }}）
              </option>
            </select>
          </label>
          <label v-if="groupDraft.createMode === 'external'" class="users-view__field">
            <span>目录组名称 <strong>*</strong></span>
            <input v-model="groupDraft.externalGroupName" placeholder="例如 GCAC-Ops" autocomplete="off" @input="clearExternalGroupLookup" />
          </label>
          <label v-if="groupDraft.createMode === 'local'" class="users-view__field">
            <span>组名称 <strong>*</strong></span>
            <input v-model="groupDraft.name" placeholder="证书运维组" autocomplete="off" />
          </label>
          <label v-if="groupDraft.createMode === 'local'" class="users-view__field">
            <span>组编码</span>
            <input v-model="groupDraft.code" placeholder="cert_ops" autocomplete="off" />
          </label>
        </div>

        <div v-if="groupDraft.createMode === 'external'" class="users-view__lookup">
          <button class="gc-button" type="button" :disabled="groupLookupLoading || !groupDraft.sourceId || !groupDraft.externalGroupName.trim()" @click="lookupExternalGroupProfile">
            {{ groupLookupLoading ? '检索中...' : '检索组' }}
          </button>
          <section v-if="groupLookupProfile" class="users-view__profile-preview" aria-label="身份源用户组资料">
            <div>
              <span>组名称</span>
              <strong>{{ groupLookupProfile.name }}</strong>
            </div>
            <div>
              <span>组编码</span>
              <strong>{{ groupLookupProfile.code }}</strong>
            </div>
            <div>
              <span>身份源</span>
              <strong>{{ groupLookupProfile.sourceName }}</strong>
            </div>
            <div>
              <span>目录 DN</span>
              <strong>{{ groupLookupProfile.groupDn || '—' }}</strong>
            </div>
          </section>
        </div>

        <p v-if="groupEditorError" class="users-view__error">{{ groupEditorError }}</p>
      </section>

      <template #actions>
        <button class="gc-button" type="button" :disabled="groupEditorLoading" @click="closeGroupEditor">取消</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="groupEditorDisabled" @click="submitGroupEditor">
          {{ groupEditorLoading ? '添加中...' : '添加组' }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.users-view { display: grid; gap: var(--gc-space-5); }
.users-view__header { display: flex; justify-content: flex-end; gap: var(--gc-space-4); align-items: center; }
.users-view__header-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.users-view__checkbox-col { width: 48px; text-align: center; }

.users-view__table-card { overflow: hidden; padding: 0; }
.users-view__table-head { display: flex; justify-content: space-between; gap: var(--gc-space-3); padding: 12px 16px; border-bottom: 1px solid var(--gc-color-border); }
.users-view__table-title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gc-space-3); }
.users-view__table-head strong { font-size: 14px; }
.users-view__table-head span { color: var(--gc-color-text-muted); font-size: 12px; font-weight: 700; }
.users-view__tabs {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid var(--gc-color-border);
  border-radius: 10px;
  background: var(--gc-color-surface-muted);
}
.users-view__tabs button {
  min-width: 56px;
  min-height: 28px;
  border: 0;
  border-radius: 7px;
  padding: 0 10px;
  color: var(--gc-color-text-muted);
  background: transparent;
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;
}
.users-view__tab--active {
  color: var(--gc-color-text) !important;
  background: var(--gc-color-surface-solid) !important;
  box-shadow: var(--gc-shadow-sm);
}
.users-view__table-scroll { overflow-x: auto; }
.users-view__table { width: 100%; border-collapse: collapse; min-width: 1260px; }
.users-view__table--groups { min-width: 980px; }
.users-view__table th,
.users-view__table td { padding: 9px 12px; border-bottom: 1px solid var(--gc-color-border); text-align: left; vertical-align: middle; line-height: 1.25; }
.users-view__table th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.users-view__table td { font-size: 12px; font-weight: 650; white-space: nowrap; }
.users-view__row-actions { display: flex; flex-wrap: nowrap; gap: 6px; white-space: nowrap; }
.users-view__row-actions :deep(button) { white-space: nowrap; }

.users-view__form { display: grid; gap: var(--gc-space-4); }
.users-view__mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-2);
  padding: 4px;
  border: 1px solid var(--gc-color-border);
  border-radius: 14px;
  background: var(--gc-color-surface-muted);
}
.users-view__mode-switch label {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 38px;
  border-radius: 10px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
  cursor: pointer;
}
.users-view__mode-switch input { accent-color: var(--gc-color-primary); }
.users-view__mode-option--active {
  color: var(--gc-color-text) !important;
  background: var(--gc-color-surface-solid);
  box-shadow: var(--gc-shadow-sm);
}
.users-view__form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.users-view__field { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.users-view__field strong { color: var(--gc-color-danger); }
.users-view__field input,
.users-view__field select {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
  outline: none;
}
.users-view__field input:focus,
.users-view__field select:focus {
  border-color: var(--gc-color-focus);
  box-shadow: 0 0 0 4px var(--gc-color-focus-ring);
  background: var(--gc-color-surface-solid);
}
.users-view__lookup { display: grid; gap: var(--gc-space-3); }
.users-view__lookup > .gc-button { justify-self: start; }
.users-view__profile-preview {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gc-space-3);
  border: 1px solid var(--gc-color-primary-border);
  border-radius: 14px;
  padding: 14px;
  background: var(--gc-color-surface-selected);
}
.users-view__profile-preview div { display: grid; gap: 5px; min-width: 0; }
.users-view__profile-preview span { color: var(--gc-color-text-muted); font-size: 12px; font-weight: 800; }
.users-view__profile-preview strong { overflow-wrap: anywhere; font-size: var(--gc-font-size-sm); }
.users-view__error { margin: 0; border: 1px solid var(--gc-color-danger-border); border-radius: 14px; padding: 12px 14px; color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }

@media (max-width: 860px) {
  .users-view__header { justify-content: stretch; }
  .users-view__header-actions { width: 100%; }
  .users-view__table-head { align-items: flex-start; flex-direction: column; }
  .users-view__mode-switch,
  .users-view__profile-preview,
  .users-view__form-grid { grid-template-columns: 1fr; }
}
</style>
