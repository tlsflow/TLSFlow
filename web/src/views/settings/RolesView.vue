<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import type { ApiRecord } from '@/api/modules/common'
import { listAgents, listAssets } from '@/api/modules/assets.api'
import { listCertificates } from '@/api/modules/certificates.api'
import { listDeploymentPlans } from '@/api/modules/deployments.api'
import { listGateways } from '@/api/modules/gateways.api'
import {
  createAccessGrant,
  createObjectSet,
  createRole,
  createRoleBinding,
  deleteRole,
  addObjectSetMember,
  listAccessGrants,
  listGroups,
  listObjectSets,
  listRoleBindings,
  listRoles,
  listUsers
} from '@/api/modules/security.api'
import { listWorkflowTemplates } from '@/api/modules/workflow-templates.api'
import { GcDataTable, GcModal, GcPageHeader } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'

interface RoleDraft {
  name: string
  description: string
}

interface AccessGrantDraft {
  roleId: string
  accessLevel: 'read' | 'edit' | 'control'
  effect: 'allow' | 'deny'
}

interface MemberOption {
  key: string
  id: string
  label: string
  description: string
  principalType: 'user' | 'group' | 'external_group'
}

interface AssignableObjectCategory {
  key: string
  label: string
  objectType: string
  load?: () => Promise<readonly ApiRecord[]>
}

interface ObjectTreeNode {
  key: string
  label: string
  kind: 'root' | 'type' | 'record'
  objectType?: string
  objectId?: string
  objectTypes: string[]
  level: number
  description?: string
}

const roleRows = ref<ApiRecord[]>([])
const objectSetRows = ref<ApiRecord[]>([])
const accessGrantRows = ref<ApiRecord[]>([])
const roleBindingRows = ref<ApiRecord[]>([])
const userRows = ref<ApiRecord[]>([])
const groupRows = ref<ApiRecord[]>([])
const loading = ref(false)
const objectTreeLoading = ref(false)
const saving = ref(false)
const pageError = ref('')
const modalError = ref('')
const objectTreeError = ref('')

const roleEditorOpen = ref(false)
const roleDetailOpen = ref(false)
const grantEditorOpen = ref(false)
const memberEditorOpen = ref(false)
const deletingRoleId = ref('')
const selectedRole = ref<ApiRecord | null>(null)
const selectedObjectNodes = ref<ObjectTreeNode[]>([])
const memberPrincipalType = ref<'user' | 'group'>('user')
const selectedMemberKeys = ref<string[]>([])
const expandedTreeKeys = ref<string[]>(['root'])
const objectTreeRecords = ref<Record<string, readonly ApiRecord[]>>({})

const roleDraft = reactive<RoleDraft>({ name: '', description: '' })
const grantDraft = reactive<AccessGrantDraft>({ roleId: '', accessLevel: 'read', effect: 'allow' })

const assignableCategories: readonly AssignableObjectCategory[] = [
  { key: 'certificate', label: '证书', objectType: 'certificate', load: () => loadPageItems(listCertificates) },
  { key: 'gateway', label: '网关', objectType: 'gateway', load: () => loadPageItems(listGateways) },
  { key: 'agent', label: 'Agent', objectType: 'agent', load: () => loadPageItems(listAgents) },
  { key: 'service_asset', label: '应用资产', objectType: 'service_asset', load: () => loadPageItems(listAssets) },
  { key: 'deployment_plan', label: '更新计划', objectType: 'deployment_plan', load: () => loadPageItems(listDeploymentPlans) },
  { key: 'workflow', label: '工作流', objectType: 'workflow', load: () => loadPageItems(listWorkflowTemplates) },
  { key: 'audit_log', label: '日志', objectType: 'audit_log', load: () => Promise.resolve(auditLogCategories) },
  { key: 'system_setting', label: '系统设置', objectType: 'system_setting' }
]

const auditLogCategories: readonly ApiRecord[] = [
  { id: 'auth', name: '认证登录日志', description: '登录、登出、外部身份源登录' },
  { id: 'security', name: '安全管理日志', description: '用户、角色、权限、身份源变更' },
  { id: 'certificate', name: '证书日志', description: '证书导入、版本、格式和绑定操作' },
  { id: 'asset', name: '资产日志', description: '应用资产、主机、服务实例和站点资产操作' },
  { id: 'gateway', name: '网关日志', description: '网关路由、探测和状态变更' },
  { id: 'agent', name: 'Agent 日志', description: 'Agent 注册、心跳、任务和升级操作' },
  { id: 'deployment', name: '更新计划日志', description: '部署计划、执行、回滚和审批' },
  { id: 'workflow', name: '工作流日志', description: '工作流模板和执行操作' },
  { id: 'secret', name: '密钥日志', description: 'Secret 创建、使用和轮换' },
  { id: 'system', name: '系统日志', description: '系统设置和平台级事件' }
]

const roleColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'id', title: '角色 ID', width: '22%' },
  { key: 'code', title: '编码', width: '14%' },
  { key: 'name', title: '名称', width: '16%' },
  { key: 'builtin', title: '内置', width: '10%' },
  { key: 'policyCount', title: '策略数', width: '10%' },
  { key: 'permissions', title: '权限点' },
  { key: 'actions', title: '操作', width: '310px' }
]

const accessGrantColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'roleId', title: '角色 ID', width: '24%' },
  { key: 'objectSetName', title: '对象范围', width: '28%' },
  { key: 'accessLevel', title: '权限级别', width: '16%' },
  { key: 'effect', title: '效果', width: '12%' }
]

const roleMemberColumns: DataTableColumn<ApiRecord>[] = [
  { key: 'principalTypeText', title: '成员类型', width: '18%' },
  { key: 'principalName', title: '成员', width: '32%' },
  { key: 'objectSetName', title: '对象范围' },
  { key: 'effect', title: '效果', width: '12%' }
]

const currentRoleGrants = computed<ApiRecord[]>(() => {
  const roleId = readValue(selectedRole.value, 'id')
  if (!roleId) return []
  return roleAccessGrants(roleId)
    .map((item, index) => ({
      ...item,
      objectSetName: objectSetLabel(readValue(item, 'objectSetId')),
      rowKey: [readValue(item, 'roleId'), readValue(item, 'objectSetId'), readValue(item, 'accessLevel'), readValue(item, 'effect'), index].join(':')
    }))
})

const currentRoleMembers = computed<ApiRecord[]>(() => {
  const roleId = readValue(selectedRole.value, 'id')
  if (!roleId) return []
  return roleBindingRows.value
    .filter((item) => readValue(item, 'roleId') === roleId && ['user', 'group', 'external_group'].includes(readValue(item, 'principalType')))
    .map((item, index) => ({
      ...item,
      principalTypeText: principalTypeText(readValue(item, 'principalType')),
      principalName: principalLabel(readValue(item, 'principalType'), readValue(item, 'principalId')),
      objectSetName: objectSetLabel(readValue(item, 'objectSetId')),
      rowKey: [readValue(item, 'principalType'), readValue(item, 'principalId'), readValue(item, 'roleId'), readValue(item, 'objectSetId'), index].join(':')
    }))
})

const memberOptions = computed<MemberOption[]>(() => {
  if (memberPrincipalType.value === 'group') {
    return groupRows.value
      .filter((item) => readValue(item, 'enabled') !== 'false')
      .map((item) => {
        const id = readValue(item, 'id')
        const source = readValue(item, 'source')
        const principalType = source === 'local' ? 'group' as const : 'external_group' as const
        return {
          key: `${principalType}:${id}`,
          id,
          principalType,
          label: readValue(item, 'name') || readValue(item, 'code') || id,
          description: [readValue(item, 'code'), readValue(item, 'externalSourceName') || source].filter(Boolean).join(' · ') || id
        }
      })
      .filter((item) => item.id)
  }
  return userRows.value
    .filter((item) => readValue(item, 'status') !== 'disabled')
    .map((item) => {
      const id = readValue(item, 'id')
      return {
        key: `user:${id}`,
        id,
        principalType: 'user' as const,
        label: readValue(item, 'displayName') || readValue(item, 'username') || id,
        description: [readValue(item, 'username'), readValue(item, 'email')].filter(Boolean).join(' · ') || id
      }
    })
    .filter((item) => item.id)
})

const memberEditorDisabled = computed(() => saving.value || !selectedRole.value || selectedMemberKeys.value.length === 0)
const selectedMemberSummary = computed(() =>
  selectedMemberKeys.value.length > 0 ? `已选 ${selectedMemberKeys.value.length} 个成员` : '请选择用户或组'
)

const objectTreeNodes = computed<ObjectTreeNode[]>(() => {
  const root: ObjectTreeNode = {
    key: 'root',
    label: '全部对象',
    kind: 'root',
    objectTypes: assignableCategories.map((item) => item.objectType),
    level: 0,
    description: '所有可授权业务对象'
  }
  const nodes: ObjectTreeNode[] = [root]
  if (!expandedTreeKeys.value.includes('root')) return nodes
  for (const category of assignableCategories) {
    const typeNode: ObjectTreeNode = {
      key: category.key,
      label: category.label,
      kind: 'type',
      objectType: category.objectType,
      objectTypes: [category.objectType],
      level: 1,
      description: `${category.label}全部记录`
    }
    nodes.push(typeNode)
    if (!expandedTreeKeys.value.includes(category.key)) continue
    for (const record of objectTreeRecords.value[category.key] ?? []) {
      const objectId = recordId(record)
      if (!objectId) continue
      nodes.push({
        key: `${category.key}:${objectId}`,
        label: recordLabel(record, category.label),
        kind: 'record',
        objectType: category.objectType,
        objectId,
        objectTypes: [category.objectType],
        level: 2,
        description: objectId
      })
    }
  }
  return nodes
})

const roleEditorDisabled = computed(() => saving.value || !roleDraft.name.trim())
const grantEditorDisabled = computed(() => saving.value || !grantDraft.roleId.trim() || selectedObjectNodes.value.length === 0)
const selectedObjectSummary = computed(() =>
  selectedObjectNodes.value.length > 0 ? `已选 ${selectedObjectNodes.value.length} 个范围` : '请选择对象树节点'
)

async function loadPageItems(loader: (query: { page: number; pageSize: number }) => Promise<{ data?: { items?: readonly ApiRecord[] } }>): Promise<readonly ApiRecord[]> {
  const result = await loader({ page: 1, pageSize: 100 })
  return result.data?.items ?? []
}

function readValue(row: ApiRecord | null | undefined, key: string): string {
  const value = key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, row)
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value === undefined || value === null || value === '' ? '' : String(value)
}

function displayValue(row: ApiRecord, key: string): string {
  return readValue(row, key) || '—'
}

function objectSetLabel(objectSetId: string): string {
  const objectSet = objectSetRows.value.find((item) => readValue(item, 'id') === objectSetId)
  return objectSet ? `${readValue(objectSet, 'name') || objectSetId}（${objectSetId}）` : objectSetId || '—'
}

function roleAccessGrants(roleId: string): ApiRecord[] {
  return accessGrantRows.value.filter((item) => readValue(item, 'roleId') === roleId)
}

function roleObjectSetIds(roleId: string): string[] {
  return [...new Set(roleAccessGrants(roleId).map((item) => readValue(item, 'objectSetId')).filter(Boolean))]
}

function principalTypeText(type: string): string {
  if (type === 'user') return '用户'
  if (type === 'group') return '组'
  if (type === 'external_group') return '身份源组'
  return type || '—'
}

function principalLabel(type: string, id: string): string {
  if (type === 'user') {
    const user = userRows.value.find((item) => readValue(item, 'id') === id)
    if (user) return `${readValue(user, 'displayName') || readValue(user, 'username') || id}（${id}）`
  }
  if (type === 'group' || type === 'external_group') {
    const group = groupRows.value.find((item) => readValue(item, 'id') === id)
    if (group) return `${readValue(group, 'name') || readValue(group, 'code') || id}（${id}）`
  }
  return id || '—'
}

function firstString(record: ApiRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = readValue(record, key)
    if (value) return value
  }
  return ''
}

function recordId(record: ApiRecord): string {
  return firstString(record, ['id', 'assetId', 'certificateId', 'gatewayId', 'agentId', 'planId', 'templateId', 'resourceId'])
}

function recordLabel(record: ApiRecord, fallbackPrefix: string): string {
  const name = firstString(record, [
    'name',
    'displayName',
    'descriptor.displayName',
    'descriptor.hostname',
    'title',
    'commonName',
    'subjectCn',
    'domain',
    'hostname',
    'agentKey',
    'eventType',
    'action'
  ])
  const id = recordId(record)
  return name ? `${name}${id ? `（${id}）` : ''}` : `${fallbackPrefix} ${id || '未命名记录'}`
}

function isBuiltinRole(row: ApiRecord | null | undefined): boolean {
  return readValue(row, 'builtin') === 'true'
}

function toErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiClientError) return `${cause.message}（${cause.errorCode}）`
  return cause instanceof Error ? cause.message : fallback
}

function isExpanded(key: string): boolean {
  return expandedTreeKeys.value.includes(key)
}

function toggleTreeNode(node: ObjectTreeNode): void {
  if (node.kind === 'record') return
  expandedTreeKeys.value = isExpanded(node.key)
    ? expandedTreeKeys.value.filter((key) => key !== node.key)
    : [...expandedTreeKeys.value, node.key]
}

function isObjectNodeSelected(node: ObjectTreeNode): boolean {
  return selectedObjectNodes.value.some((item) => item.key === node.key)
}

function toggleObjectNodeSelection(node: ObjectTreeNode): void {
  selectedObjectNodes.value = isObjectNodeSelected(node)
    ? selectedObjectNodes.value.filter((item) => item.key !== node.key)
    : [...selectedObjectNodes.value, node]
  if (node.kind !== 'record' && !isExpanded(node.key)) toggleTreeNode(node)
}

function clearSelectedObjectNodes(): void {
  selectedObjectNodes.value = []
}

function objectNodeKindText(node: ObjectTreeNode): string {
  if (node.kind === 'root') return '全部'
  if (node.kind === 'type') return '分类'
  return '记录'
}

function objectSetNameForNode(node: ObjectTreeNode): string {
  if (node.kind === 'root') return '全部业务对象'
  if (node.kind === 'type') return `${node.label}全部记录`
  return node.label
}

function generateRoleCode(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  const prefix = normalized || 'custom_role'
  const suffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
  return `${prefix}_${suffix}`
}

async function loadObjectTree(): Promise<void> {
  objectTreeLoading.value = true
  objectTreeError.value = ''
  try {
    const entries = await Promise.all(assignableCategories.map(async (category) => {
      if (!category.load) return [category.key, []] as const
      try {
        return [category.key, await category.load()] as const
      } catch {
        return [category.key, []] as const
      }
    }))
    objectTreeRecords.value = Object.fromEntries(entries)
  } catch (cause) {
    objectTreeError.value = toErrorMessage(cause, '加载对象树失败')
  } finally {
    objectTreeLoading.value = false
  }
}

async function reloadAll(): Promise<void> {
  loading.value = true
  pageError.value = ''
  try {
    const [roles, objectSets, grants, roleBindings, users, groups] = await Promise.all([
      listRoles({ page: 1, pageSize: 100 }),
      listObjectSets({ page: 1, pageSize: 100 }),
      listAccessGrants({ page: 1, pageSize: 100 }),
      listRoleBindings({ page: 1, pageSize: 200 }),
      listUsers({ page: 1, pageSize: 200 }),
      listGroups({ page: 1, pageSize: 200 })
    ])
    roleRows.value = [...(roles.data?.items ?? [])]
    objectSetRows.value = [...(objectSets.data?.items ?? [])]
    accessGrantRows.value = [...(grants.data?.items ?? [])]
    roleBindingRows.value = [...(roleBindings.data?.items ?? [])]
    userRows.value = [...(users.data?.items ?? [])]
    groupRows.value = [...(groups.data?.items ?? [])]
    if (selectedRole.value) {
      const selectedId = readValue(selectedRole.value, 'id')
      selectedRole.value = roleRows.value.find((item) => readValue(item, 'id') === selectedId) ?? selectedRole.value
    }
  } catch (cause) {
    pageError.value = toErrorMessage(cause, '加载权限管理数据失败')
  } finally {
    loading.value = false
  }
}

function openCreateRole(): void {
  Object.assign(roleDraft, { name: '', description: '' })
  Object.assign(grantDraft, {
    roleId: '',
    accessLevel: 'read',
    effect: 'allow'
  })
  selectedObjectNodes.value = []
  modalError.value = ''
  roleEditorOpen.value = true
  void loadObjectTree()
}

function openRoleDetail(row: ApiRecord): void {
  selectedRole.value = row
  modalError.value = ''
  roleDetailOpen.value = true
}

function openGrantRole(): void {
  Object.assign(grantDraft, {
    roleId: selectedRole.value ? readValue(selectedRole.value, 'id') : '',
    accessLevel: 'read',
    effect: 'allow'
  })
  selectedObjectNodes.value = []
  modalError.value = ''
  grantEditorOpen.value = true
  void loadObjectTree()
}

function openGrantRoleFromRole(row: ApiRecord): void {
  selectedRole.value = row
  openGrantRole()
}

function openAssignMembersFromRole(row: ApiRecord): void {
  selectedRole.value = row
  memberPrincipalType.value = 'user'
  selectedMemberKeys.value = []
  modalError.value = ''
  memberEditorOpen.value = true
}

function isMemberSelected(option: MemberOption): boolean {
  return selectedMemberKeys.value.includes(option.key)
}

function toggleMemberSelection(option: MemberOption): void {
  selectedMemberKeys.value = isMemberSelected(option)
    ? selectedMemberKeys.value.filter((key) => key !== option.key)
    : [...selectedMemberKeys.value, option.key]
}

function clearSelectedMembers(): void {
  selectedMemberKeys.value = []
}

function onMemberPrincipalTypeChange(): void {
  selectedMemberKeys.value = []
}

async function submitRole(): Promise<void> {
  if (roleEditorDisabled.value) return
  const nodes = [...selectedObjectNodes.value]
  saving.value = true
  modalError.value = ''
  try {
    const roleResult = await createRole({
      code: generateRoleCode(roleDraft.name),
      name: roleDraft.name.trim(),
      description: roleDraft.description.trim() || undefined
    })
    const roleId = readValue(roleResult.data ?? {}, 'id')
    if (nodes.length > 0) {
      if (!roleId) throw new Error('后端没有返回角色 ID')
      await createGrantsForRole(roleId, nodes, grantDraft.accessLevel, grantDraft.effect)
    }
    roleEditorOpen.value = false
    await reloadAll()
  } catch (cause) {
    modalError.value = toErrorMessage(cause, '创建角色失败')
  } finally {
    saving.value = false
  }
}

async function submitGrant(): Promise<void> {
  if (grantEditorDisabled.value) return
  const nodes = [...selectedObjectNodes.value]
  if (nodes.length === 0) return
  saving.value = true
  modalError.value = ''
  try {
    await createGrantsForRole(grantDraft.roleId.trim(), nodes, grantDraft.accessLevel, grantDraft.effect)
    grantEditorOpen.value = false
    await reloadAll()
  } catch (cause) {
    modalError.value = toErrorMessage(cause, '授予角色权限失败')
  } finally {
    saving.value = false
  }
}

async function submitMemberAssignment(): Promise<void> {
  if (memberEditorDisabled.value || !selectedRole.value) return
  const roleId = readValue(selectedRole.value, 'id')
  const objectSetIds = roleObjectSetIds(roleId)
  if (objectSetIds.length === 0) {
    modalError.value = '该角色还没有授权对象范围，请先为角色授予权限。'
    return
  }
  const selectedMembers = memberOptions.value.filter((option) => selectedMemberKeys.value.includes(option.key))
  if (selectedMembers.length === 0) return
  const existing = new Set(roleBindingRows.value.map((item) => [
    readValue(item, 'principalType'),
    readValue(item, 'principalId'),
    readValue(item, 'roleId'),
    readValue(item, 'objectSetId')
  ].join(':')))
  saving.value = true
  modalError.value = ''
  try {
    for (const member of selectedMembers) {
      for (const objectSetId of objectSetIds) {
        const key = [member.principalType, member.id, roleId, objectSetId].join(':')
        if (existing.has(key)) continue
        await createRoleBinding({
          principalType: member.principalType,
          principalId: member.id,
          roleId,
          objectSetId,
          effect: 'allow',
          enabled: true
        })
        existing.add(key)
      }
    }
    memberEditorOpen.value = false
    await reloadAll()
  } catch (cause) {
    modalError.value = toErrorMessage(cause, '分配成员失败')
  } finally {
    saving.value = false
  }
}

async function removeRole(row: ApiRecord): Promise<void> {
  const roleId = readValue(row, 'id')
  if (!roleId || isBuiltinRole(row) || saving.value) return
  const roleName = readValue(row, 'name') || roleId
  if (!window.confirm(`确认删除角色“${roleName}”？删除后会同步移除该角色的用户分配和对象授权。`)) return
  saving.value = true
  deletingRoleId.value = roleId
  pageError.value = ''
  try {
    await deleteRole(roleId)
    if (selectedRole.value && readValue(selectedRole.value, 'id') === roleId) {
      selectedRole.value = null
      roleDetailOpen.value = false
    }
    await reloadAll()
  } catch (cause) {
    pageError.value = toErrorMessage(cause, '删除角色失败')
  } finally {
    deletingRoleId.value = ''
    saving.value = false
  }
}

async function createGrantsForRole(
  roleId: string,
  nodes: readonly ObjectTreeNode[],
  accessLevel: AccessGrantDraft['accessLevel'],
  effect: AccessGrantDraft['effect']
): Promise<void> {
  for (const node of nodes) {
    const objectSetResult = await createObjectSet({
      name: objectSetNameForNode(node),
      kind: node.kind === 'record' ? 'static' : 'dynamic',
      objectTypes: node.objectTypes,
      conditions: {},
      status: 'active'
    })
    const objectSetId = readValue(objectSetResult.data ?? {}, 'id')
    if (!objectSetId) throw new Error('后端没有返回对象范围 ID')
    if (node.kind === 'record' && node.objectType && node.objectId) {
      await addObjectSetMember({
        objectSetId,
        objectType: node.objectType,
        objectId: node.objectId
      })
    }
    await createAccessGrant({
      roleId,
      objectSetId,
      accessLevel,
      effect
    })
  }
}

onMounted(() => void reloadAll())
</script>

<template>
  <section class="gc-page roles-view">
    <GcPageHeader title="权限管理" description="以角色为中心维护授权对象范围，并把用户或组分配到角色。">
      <template #actions>
        <button class="gc-button" type="button" @click="openCreateRole">创建角色</button>
        <button class="gc-button" type="button" :disabled="loading" @click="reloadAll">刷新</button>
      </template>
    </GcPageHeader>

    <p v-if="pageError" class="roles-view__error">{{ pageError }}</p>

    <GcDataTable :columns="roleColumns" :rows="roleRows" :loading="loading" row-key="id" empty-text="暂无角色" dense>
      <template #toolbar>
        <div class="roles-view__table-toolbar">
          <strong>角色记录</strong>
          <span>共 {{ roleRows.length }} 条</span>
        </div>
      </template>
      <template #cell-builtin="{ row }">{{ displayValue(row, 'builtin') }}</template>
      <template #cell-permissions="{ row }">
        <span class="roles-view__cell-wrap">{{ displayValue(row, 'permissions') }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="roles-view__row-actions">
          <button class="gc-button" type="button" @click="openRoleDetail(row)">详情</button>
          <button class="gc-button" type="button" @click="openGrantRoleFromRole(row)">授权</button>
          <button class="gc-button" type="button" @click="openAssignMembersFromRole(row)">分配成员</button>
          <button
            v-if="!isBuiltinRole(row)"
            class="gc-button gc-button--danger"
            type="button"
            :disabled="saving"
            @click="removeRole(row)"
          >
            {{ deletingRoleId === readValue(row, 'id') ? '删除中...' : '删除' }}
          </button>
        </div>
      </template>
    </GcDataTable>

    <GcModal
      v-model:open="roleDetailOpen"
      :title="selectedRole ? `角色 ${readValue(selectedRole, 'name') || readValue(selectedRole, 'code')}` : '角色详情'"
      description="对象范围、具体对象、权限级别和成员分配在这里维护。"
      size="xxl"
    >
      <section v-if="selectedRole" class="roles-view__detail">
        <dl class="roles-view__facts">
          <div><dt>角色 ID</dt><dd>{{ displayValue(selectedRole, 'id') }}</dd></div>
          <div><dt>编码</dt><dd>{{ displayValue(selectedRole, 'code') }}</dd></div>
          <div><dt>名称</dt><dd>{{ displayValue(selectedRole, 'name') }}</dd></div>
          <div><dt>内置</dt><dd>{{ displayValue(selectedRole, 'builtin') }}</dd></div>
          <div><dt>策略数</dt><dd>{{ displayValue(selectedRole, 'policyCount') }}</dd></div>
          <div><dt>权限点</dt><dd>{{ displayValue(selectedRole, 'permissions') }}</dd></div>
        </dl>

        <GcDataTable :columns="accessGrantColumns" :rows="currentRoleGrants" row-key="rowKey" empty-text="当前角色暂无对象权限" dense>
          <template #toolbar>
            <div class="roles-view__table-toolbar">
              <strong>当前角色权限</strong>
              <button class="gc-button" type="button" @click="openGrantRole()">授予权限</button>
            </div>
          </template>
        </GcDataTable>

        <GcDataTable :columns="roleMemberColumns" :rows="currentRoleMembers" row-key="rowKey" empty-text="当前角色暂无成员分配" dense>
          <template #toolbar>
            <div class="roles-view__table-toolbar">
              <strong>已分配成员</strong>
              <button class="gc-button" type="button" @click="openAssignMembersFromRole(selectedRole)">分配成员</button>
            </div>
          </template>
        </GcDataTable>
      </section>

      <template #actions>
        <button v-if="selectedRole && !isBuiltinRole(selectedRole)" class="gc-button gc-button--danger" type="button" :disabled="saving" @click="removeRole(selectedRole)">
          {{ deletingRoleId === readValue(selectedRole, 'id') ? '删除中...' : '删除角色' }}
        </button>
        <button class="gc-button" type="button" @click="roleDetailOpen = false">关闭</button>
      </template>
    </GcModal>

    <GcModal v-model:open="roleEditorOpen" title="创建角色" description="填写角色职责，并可直接为该角色授权对象范围。" size="xl">
      <section class="roles-view__form">
        <label><span>角色名称 <strong>*</strong></span><input v-model="roleDraft.name" placeholder="证书操作员" /></label>
        <label class="roles-view__field--wide"><span>说明</span><textarea v-model="roleDraft.description" placeholder="负责证书日常操作" /></label>
      </section>

      <section class="roles-view__grant-editor roles-view__create-grant">
        <section class="roles-view__grant-summary">
          <div>
            <span>授权角色</span>
            <strong>{{ roleDraft.name.trim() || '新角色' }}</strong>
          </div>
          <div>
            <span>已选范围</span>
            <strong>{{ selectedObjectSummary }}</strong>
          </div>
        </section>

        <section v-if="selectedObjectNodes.length > 0" class="roles-view__selected-scopes" aria-label="已选授权范围">
          <span v-for="node in selectedObjectNodes" :key="node.key">{{ objectSetNameForNode(node) }}</span>
          <button class="gc-button" type="button" @click="clearSelectedObjectNodes">清空选择</button>
        </section>

        <section class="roles-view__object-tree" aria-label="可授权对象树">
          <header>
            <strong>可授权对象</strong>
            <button class="gc-button" type="button" :disabled="objectTreeLoading" @click="loadObjectTree">
              {{ objectTreeLoading ? '加载中...' : '刷新对象' }}
            </button>
          </header>
          <p v-if="objectTreeError" class="roles-view__error">{{ objectTreeError }}</p>
          <div v-if="objectTreeLoading" class="roles-view__tree-state">正在加载对象树...</div>
          <ul v-else class="roles-view__tree-list">
            <li v-for="node in objectTreeNodes" :key="node.key">
              <button
                class="roles-view__tree-node"
                :class="{ 'roles-view__tree-node--selected': isObjectNodeSelected(node) }"
                type="button"
                :style="{ '--tree-level': node.level }"
                @click="toggleObjectNodeSelection(node)"
              >
                <span class="roles-view__tree-toggle" @click.stop="toggleTreeNode(node)">
                  {{ node.kind === 'record' ? '•' : (isExpanded(node.key) ? '−' : '+') }}
                </span>
                <span class="roles-view__tree-check" :data-checked="isObjectNodeSelected(node)">✓</span>
                <span class="roles-view__tree-copy">
                  <strong>{{ node.label }}</strong>
                  <small>{{ objectNodeKindText(node) }}<template v-if="node.description"> · {{ node.description }}</template></small>
                </span>
              </button>
            </li>
          </ul>
        </section>

        <section class="roles-view__form roles-view__form--two">
          <label>
            <span>权限级别</span>
            <select v-model="grantDraft.accessLevel">
              <option value="read">只读</option>
              <option value="edit">编辑</option>
              <option value="control">完全控制</option>
            </select>
          </label>
          <label>
            <span>效果</span>
            <select v-model="grantDraft.effect">
              <option value="allow">允许</option>
              <option value="deny">拒绝</option>
            </select>
          </label>
        </section>
      </section>
      <p v-if="modalError" class="roles-view__error">{{ modalError }}</p>
      <template #actions>
        <button class="gc-button" type="button" :disabled="saving" @click="roleEditorOpen = false">取消</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="roleEditorDisabled" @click="submitRole">{{ saving ? '创建中...' : '创建角色' }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="grantEditorOpen" title="授予角色权限" description="从对象树选择范围，并直接设置该范围上的权限级别。" size="xl">
      <section class="roles-view__grant-editor">
        <section class="roles-view__grant-summary">
          <div>
            <span>角色</span>
            <strong>{{ grantDraft.roleId || '—' }}</strong>
          </div>
          <div>
            <span>已选范围</span>
            <strong>{{ selectedObjectSummary }}</strong>
          </div>
        </section>

        <section v-if="selectedObjectNodes.length > 0" class="roles-view__selected-scopes" aria-label="已选授权范围">
          <span v-for="node in selectedObjectNodes" :key="node.key">{{ objectSetNameForNode(node) }}</span>
          <button class="gc-button" type="button" @click="clearSelectedObjectNodes">清空选择</button>
        </section>

        <section class="roles-view__object-tree" aria-label="可授权对象树">
          <header>
            <strong>可授权对象</strong>
            <button class="gc-button" type="button" :disabled="objectTreeLoading" @click="loadObjectTree">
              {{ objectTreeLoading ? '加载中...' : '刷新对象' }}
            </button>
          </header>
          <p v-if="objectTreeError" class="roles-view__error">{{ objectTreeError }}</p>
          <div v-if="objectTreeLoading" class="roles-view__tree-state">正在加载对象树...</div>
          <ul v-else class="roles-view__tree-list">
            <li v-for="node in objectTreeNodes" :key="node.key">
              <button
                class="roles-view__tree-node"
                :class="{ 'roles-view__tree-node--selected': isObjectNodeSelected(node) }"
                type="button"
                :style="{ '--tree-level': node.level }"
                @click="toggleObjectNodeSelection(node)"
              >
                <span class="roles-view__tree-toggle" @click.stop="toggleTreeNode(node)">
                  {{ node.kind === 'record' ? '•' : (isExpanded(node.key) ? '−' : '+') }}
                </span>
                <span class="roles-view__tree-check" :data-checked="isObjectNodeSelected(node)">✓</span>
                <span class="roles-view__tree-copy">
                  <strong>{{ node.label }}</strong>
                  <small>{{ objectNodeKindText(node) }}<template v-if="node.description"> · {{ node.description }}</template></small>
                </span>
              </button>
            </li>
          </ul>
        </section>

        <section class="roles-view__form roles-view__form--two">
          <label>
            <span>权限级别</span>
            <select v-model="grantDraft.accessLevel">
              <option value="read">只读</option>
              <option value="edit">编辑</option>
              <option value="control">完全控制</option>
            </select>
          </label>
          <label>
            <span>效果</span>
            <select v-model="grantDraft.effect">
              <option value="allow">允许</option>
              <option value="deny">拒绝</option>
            </select>
          </label>
        </section>

        <p v-if="modalError" class="roles-view__error">{{ modalError }}</p>
      </section>
      <template #actions>
        <button class="gc-button" type="button" :disabled="saving" @click="grantEditorOpen = false">取消</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="grantEditorDisabled" @click="submitGrant">{{ saving ? '保存中...' : '授予权限' }}</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="memberEditorOpen"
      :title="selectedRole ? `分配成员：${readValue(selectedRole, 'name') || readValue(selectedRole, 'code')}` : '分配成员'"
      description="选择用户或组，系统会把成员分配到该角色已有的授权对象范围。"
      size="lg"
    >
      <section class="roles-view__member-editor">
        <section class="roles-view__grant-summary">
          <div>
            <span>目标角色</span>
            <strong>{{ selectedRole ? readValue(selectedRole, 'name') || readValue(selectedRole, 'code') : '—' }}</strong>
          </div>
          <div>
            <span>授权范围</span>
            <strong>{{ selectedRole ? `${roleObjectSetIds(readValue(selectedRole, 'id')).length} 个对象范围` : '—' }}</strong>
          </div>
        </section>

        <section class="roles-view__form roles-view__form--two">
          <label>
            <span>成员类型</span>
            <select v-model="memberPrincipalType" @change="onMemberPrincipalTypeChange">
              <option value="user">用户</option>
              <option value="group">组</option>
            </select>
          </label>
          <label>
            <span>已选成员</span>
            <input :value="selectedMemberSummary" readonly />
          </label>
        </section>

        <section v-if="selectedMemberKeys.length > 0" class="roles-view__selected-scopes" aria-label="已选成员">
          <span v-for="key in selectedMemberKeys" :key="key">
            {{ memberOptions.find((option) => option.key === key)?.label || key }}
          </span>
          <button class="gc-button" type="button" @click="clearSelectedMembers">清空选择</button>
        </section>

        <section class="roles-view__member-list" aria-label="可分配成员">
          <button
            v-for="option in memberOptions"
            :key="option.key"
            class="roles-view__member-option"
            :class="{ 'roles-view__member-option--selected': isMemberSelected(option) }"
            type="button"
            @click="toggleMemberSelection(option)"
          >
            <span class="roles-view__tree-check" :data-checked="isMemberSelected(option)">✓</span>
            <span>
              <strong>{{ option.label }}</strong>
              <small>{{ option.description }}</small>
            </span>
          </button>
          <div v-if="memberOptions.length === 0" class="roles-view__tree-state">
            暂无可分配{{ memberPrincipalType === 'user' ? '用户' : '组' }}
          </div>
        </section>

        <p v-if="modalError" class="roles-view__error">{{ modalError }}</p>
      </section>
      <template #actions>
        <button class="gc-button" type="button" :disabled="saving" @click="memberEditorOpen = false">取消</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="memberEditorDisabled" @click="submitMemberAssignment">
          {{ saving ? '保存中...' : '分配成员' }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.roles-view { display: grid; gap: var(--gc-space-5); }
.roles-view__table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.roles-view__table-toolbar strong { font-size: 14px; }
.roles-view__table-toolbar span { color: var(--gc-color-text-muted); font-size: 12px; font-weight: 750; }
.roles-view__toolbar-actions,
.roles-view__row-actions { display: flex; flex-wrap: wrap; gap: var(--gc-space-2); }
.roles-view__cell-wrap { display: inline-block; max-width: 520px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.roles-view__detail { display: grid; gap: var(--gc-space-4); }
.roles-view__facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.roles-view__facts div { min-width: 0; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 12px; background: var(--gc-color-surface-muted); }
.roles-view__facts dt { margin-bottom: 6px; color: var(--gc-color-text-muted); font-size: 12px; font-weight: 850; }
.roles-view__facts dd { margin: 0; overflow-wrap: anywhere; font-size: 13px; font-weight: 750; }
.roles-view__grant-editor { display: grid; gap: var(--gc-space-4); }
.roles-view__create-grant { margin-top: var(--gc-space-4); }
.roles-view__member-editor { display: grid; gap: var(--gc-space-4); }
.roles-view__grant-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.roles-view__grant-summary div {
  display: grid;
  gap: 6px;
  min-width: 0;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 12px;
  background: var(--gc-color-surface-muted);
}
.roles-view__grant-summary span { color: var(--gc-color-text-muted); font-size: 12px; font-weight: 850; }
.roles-view__grant-summary strong { overflow-wrap: anywhere; font-size: 13px; }
.roles-view__selected-scopes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #bfdbfe;
  border-radius: 12px;
  background: #eff6ff;
}
.roles-view__selected-scopes span {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: 28px;
  border: 1px solid #bfdbfe;
  border-radius: 999px;
  padding: 0 10px;
  overflow: hidden;
  color: #1e40af;
  background: #fff;
  font-size: 12px;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.roles-view__selected-scopes .gc-button { margin-left: auto; }
.roles-view__object-tree {
  overflow: hidden;
  border: 1px solid var(--gc-color-border);
  border-radius: var(--gc-radius-lg);
  background: #fff;
}
.roles-view__object-tree header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding: 12px 14px;
  border-bottom: 1px solid var(--gc-color-border);
  background: linear-gradient(180deg, #fff, #fbfdff);
}
.roles-view__object-tree header strong { font-size: 14px; }
.roles-view__tree-state { padding: 34px 16px; text-align: center; color: var(--gc-color-text-muted); font-weight: 800; }
.roles-view__tree-list { display: grid; max-height: 360px; overflow: auto; margin: 0; padding: 8px; list-style: none; }
.roles-view__tree-node {
  --tree-level: 0;
  display: grid;
  grid-template-columns: 26px 24px minmax(0, 1fr);
  gap: 8px;
  width: 100%;
  min-height: 42px;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 7px 10px 7px calc(10px + (var(--tree-level) * 22px));
  color: var(--gc-color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.roles-view__tree-node:hover { background: #f8fbff; border-color: #dbeafe; }
.roles-view__tree-node--selected { background: #eff6ff; border-color: #93c5fd; box-shadow: 0 0 0 3px rgb(147 197 253 / 18%); }
.roles-view__tree-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  color: var(--gc-color-primary);
  background: #eff6ff;
  font-weight: 900;
}
.roles-view__tree-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  align-self: center;
  border: 1px solid var(--gc-color-border);
  border-radius: 7px;
  color: transparent;
  background: #fff;
  font-size: 13px;
  font-weight: 950;
}
.roles-view__tree-check[data-checked='true'] {
  border-color: var(--gc-color-primary);
  color: #fff;
  background: var(--gc-color-primary);
}
.roles-view__tree-copy { display: grid; gap: 3px; min-width: 0; }
.roles-view__tree-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.roles-view__tree-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--gc-color-text-muted); font-size: 11px; font-weight: 750; }
.roles-view__member-list {
  display: grid;
  max-height: 360px;
  overflow: auto;
  border: 1px solid var(--gc-color-border);
  border-radius: var(--gc-radius-lg);
  padding: 8px;
  background: #fff;
}
.roles-view__member-option {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  min-height: 48px;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 8px 10px;
  color: var(--gc-color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.roles-view__member-option:hover { background: #f8fbff; border-color: #dbeafe; }
.roles-view__member-option--selected { background: #eff6ff; border-color: #93c5fd; box-shadow: 0 0 0 3px rgb(147 197 253 / 18%); }
.roles-view__member-option span:last-child { display: grid; gap: 3px; min-width: 0; }
.roles-view__member-option strong,
.roles-view__member-option small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.roles-view__member-option strong { font-size: 13px; }
.roles-view__member-option small { color: var(--gc-color-text-muted); font-size: 11px; font-weight: 750; }
.roles-view__form { display: grid; gap: var(--gc-space-3); }
.roles-view__form--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.roles-view__form label { display: grid; gap: var(--gc-space-2); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.roles-view__field--wide,
.roles-view__form .roles-view__error { grid-column: 1 / -1; }
.roles-view__form strong { color: var(--gc-color-danger); }
.roles-view__form input,
.roles-view__form select,
.roles-view__form textarea {
  width: 100%;
  min-height: 40px;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  padding: 10px 12px;
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
  outline: none;
}
.roles-view__form textarea { min-height: 96px; resize: vertical; }
.roles-view__form input:focus,
.roles-view__form select:focus,
.roles-view__form textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 4px rgb(96 165 250 / 14%); background: #fff; }
.roles-view__error { margin: 0; border: 1px solid #fecaca; border-radius: 14px; padding: 12px 14px; color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }
@media (max-width: 860px) {
  .roles-view__facts,
  .roles-view__grant-summary,
  .roles-view__form--two { grid-template-columns: 1fr; }
  .roles-view__table-toolbar { align-items: flex-start; flex-direction: column; }
}
</style>
