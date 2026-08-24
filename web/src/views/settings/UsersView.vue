<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import type { ApiRecord } from '@/api/modules/common'
import { createUser, deleteUser, listRoles, listUsers, updateUser } from '@/api/modules/security.api'
import { GcConfirmAction, GcModal } from '@/design-system/components'

interface UserDraft {
  userId: string
  username: string
  displayName: string
  email: string
  password: string
  roleId: string
  status: 'active' | 'disabled'
}

const userItems = ref<ApiRecord[]>([])
const roleItems = ref<ApiRecord[]>([])
const selectedUserIds = ref<string[]>([])
const pageLoading = ref(false)
const pageError = ref('')

const editorOpen = ref(false)
const editorMode = ref<'create' | 'edit'>('create')
const editorLoading = ref(false)
const editorError = ref('')

const draft = reactive<UserDraft>(buildDefaultDraft())

function buildDefaultDraft(): UserDraft {
  return {
    userId: '',
    username: '',
    displayName: '',
    email: '',
    password: '',
    roleId: '',
    status: 'active',
  }
}

function resetDraft(): void {
  Object.assign(draft, buildDefaultDraft())
  editorError.value = ''
}

const roleOptions = computed(() =>
  roleItems.value
    .map((item) => ({
      label: String(item.name ?? item.code ?? item.id ?? ''),
      value: String(item.id ?? ''),
    }))
    .filter((item) => item.value),
)

const selectedCount = computed(() => selectedUserIds.value.length)
const allSelectableIds = computed(() =>
  userItems.value
    .map((item) => String(item.id ?? ''))
    .filter((id) => id && id !== 'user_admin'),
)
const allSelected = computed(() =>
  allSelectableIds.value.length > 0 && allSelectableIds.value.every((id) => selectedUserIds.value.includes(id)),
)

const editorDisabled = computed(() => {
  return editorLoading.value
    || !draft.displayName.trim()
    || (editorMode.value === 'create' && (!draft.username.trim() || !draft.password.trim()))
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
  draft.userId = String(item.id ?? '')
  draft.username = String(item.username ?? '')
  draft.displayName = String(item.displayName ?? '')
  draft.email = String(item.email ?? '')
  draft.status = String(item.status ?? 'active') === 'disabled' ? 'disabled' : 'active'
  editorOpen.value = true
}

function closeEditor() {
  if (!editorLoading.value) editorOpen.value = false
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
      await createUser({
        username: draft.username.trim(),
        displayName: draft.displayName.trim(),
        password: draft.password,
        roleId: draft.roleId || undefined,
      })
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
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}

onMounted(async () => {
  await Promise.all([reloadUsers(), loadRoles()])
})
</script>

<template>
  <section class="users-view">
    <header class="users-view__header">
      <div class="users-view__header-actions">
        <button class="gc-button gc-button--primary" type="button" @click="openCreateDialog">创建用户</button>
        <GcConfirmAction
          v-if="selectedCount > 0"
          action-name="批量删除"
          :impact-count="selectedCount"
          risk-text="批量删除会移除所选用户的本地凭据和角色关联。"
          confirm-text="DELETE"
          @confirm="removeUsers(selectedUserIds)"
        />
        <button class="gc-button" type="button" :disabled="pageLoading" @click="reloadUsers">刷新</button>
      </div>
    </header>

    <p v-if="pageError" class="users-view__error">{{ pageError }}</p>

    <section class="gc-card users-view__table-card">
      <div class="users-view__table-head">
        <strong>用户列表</strong>
        <span>共 {{ userItems.length }} 条，已选 {{ selectedCount }} 条</span>
      </div>
      <div class="users-view__table-scroll">
        <table class="users-view__table">
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
      </div>
    </section>

    <GcModal
      v-model:open="editorOpen"
      :title="editorMode === 'create' ? '创建用户' : '编辑用户'"
      :description="editorMode === 'create' ? '创建本地控制台用户。' : '编辑本地用户的显示名、邮箱、状态和角色。'"
      size="md"
    >
      <section class="users-view__form">
        <div class="users-view__form-grid">
          <label class="users-view__field">
            <span>用户名 <strong v-if="editorMode === 'create'">*</strong></span>
            <input v-model="draft.username" :disabled="editorMode === 'edit'" placeholder="operator" autocomplete="off" />
          </label>
          <label class="users-view__field">
            <span>显示名 <strong>*</strong></span>
            <input v-model="draft.displayName" placeholder="证书操作员" autocomplete="off" />
          </label>
          <label class="users-view__field">
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
          <label v-if="editorMode === 'create'" class="users-view__field">
            <span>初始密码 <strong>*</strong></span>
            <input v-model="draft.password" type="password" placeholder="输入初始密码" autocomplete="new-password" />
          </label>
          <label v-else class="users-view__field">
            <span>状态</span>
            <select v-model="draft.status">
              <option value="active">启用</option>
              <option value="disabled">禁用</option>
            </select>
          </label>
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
  </section>
</template>

<style scoped>
.users-view { display: grid; gap: var(--gc-space-5); }
.users-view__header { display: flex; justify-content: flex-end; gap: var(--gc-space-4); align-items: center; }
.users-view__header-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.users-view__checkbox-col { width: 48px; text-align: center; }

.users-view__table-card { overflow: hidden; padding: 0; }
.users-view__table-head { display: flex; justify-content: space-between; gap: var(--gc-space-3); padding: 12px 16px; border-bottom: 1px solid var(--gc-color-border); }
.users-view__table-head strong { font-size: 14px; }
.users-view__table-head span { color: var(--gc-color-text-muted); font-size: 12px; font-weight: 700; }
.users-view__table-scroll { overflow-x: auto; }
.users-view__table { width: 100%; border-collapse: collapse; min-width: 1260px; }
.users-view__table th,
.users-view__table td { padding: 9px 12px; border-bottom: 1px solid var(--gc-color-border); text-align: left; vertical-align: middle; line-height: 1.25; }
.users-view__table th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
.users-view__table td { font-size: 12px; font-weight: 650; white-space: nowrap; }
.users-view__row-actions { display: flex; flex-wrap: nowrap; gap: 6px; white-space: nowrap; }
.users-view__row-actions :deep(button) { white-space: nowrap; }

.users-view__form { display: grid; gap: var(--gc-space-4); }
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
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgb(96 165 250 / 14%);
  background: #fff;
}
.users-view__error { margin: 0; border: 1px solid #fecaca; border-radius: 14px; padding: 12px 14px; color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }

@media (max-width: 860px) {
  .users-view__header { justify-content: stretch; }
  .users-view__header-actions { width: 100%; }
  .users-view__form-grid { grid-template-columns: 1fr; }
}
</style>
