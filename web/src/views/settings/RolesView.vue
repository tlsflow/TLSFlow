<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ApiClientError } from '@/api/client'
import type { ApiRecord } from '@/api/modules/common'
import { listApplications } from '@/api/modules/assets.api'
import { listCertificates } from '@/api/modules/certificates.api'
import {
  createAccessGrant,
  createBusinessPermissionGrant,
  createObjectSet,
  createRole,
  createRoleBinding,
  deleteRole,
  addObjectSetMember,
  listAccessGrants,
  listBusinessPermissionGrants,
  listGroups,
  listObjectSetMembers,
  listObjectSets,
  listRoleBindings,
  listRoles,
  listUsers,
  revokeBusinessPermissionGrant
} from '@/api/modules/security.api'
import { GcDataTable, GcModal, GcPageToolbar } from '@/design-system/components'
import type { DataTableColumn } from '@/design-system/components/GcDataTable.vue'

type BusinessPermissionDomain = 'certificate' | 'application' | 'audit' | 'settings'
type BusinessPermissionLevel = 'user' | 'manager'

interface RoleDraft {
  name: string
  description: string
}

interface AccessGrantDraft {
  roleId: string
  presetId: string
  businessLevel: BusinessPermissionLevel
  effect: 'allow' | 'deny'
}

interface PermissionPresetOption {
  id: string
  labelKey: string
  domain: BusinessPermissionDomain
  level: BusinessPermissionLevel
}

interface MemberOption {
  key: string
  id: string
  label: string
  description: string
  principalType: 'user' | 'group' | 'external_group'
}

interface AssignableObjectCategory {
  key: BusinessPermissionDomain
  labelKey: string
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
  selectable: boolean
  description?: string
}

const { t } = useI18n()

const roleRows = ref<ApiRecord[]>([])
const objectSetRows = ref<ApiRecord[]>([])
const objectSetMemberRows = ref<ApiRecord[]>([])
const accessGrantRows = ref<ApiRecord[]>([])
const businessPermissionRows = ref<ApiRecord[]>([])
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
const revokingGrantId = ref('')
const selectedRole = ref<ApiRecord | null>(null)
const selectedObjectNodes = ref<ObjectTreeNode[]>([])
const memberPrincipalType = ref<'user' | 'group'>('user')
const selectedMemberKeys = ref<string[]>([])
const expandedTreeKeys = ref<string[]>(['root'])
const objectTreeRecords = ref<Record<string, readonly ApiRecord[]>>({})

const hiddenCompatibilityRoleIds = new Set(['role_external_user'])
const hiddenCompatibilityRoleCodes = new Set(['external_user'])

const roleDraft = reactive<RoleDraft>({ name: '', description: '' })
const grantDraft = reactive<AccessGrantDraft>({ roleId: '', presetId: '', businessLevel: 'user', effect: 'allow' })

const permissionPresets: readonly PermissionPresetOption[] = [
  { id: 'certificate.viewer', labelKey: 'settings.roles.presets.certificateViewer', domain: 'certificate', level: 'user' },
  { id: 'certificate.manager', labelKey: 'settings.roles.presets.certificateManager', domain: 'certificate', level: 'manager' },
  { id: 'application.viewer', labelKey: 'settings.roles.presets.applicationViewer', domain: 'application', level: 'user' },
  { id: 'application.manager', labelKey: 'settings.roles.presets.applicationManager', domain: 'application', level: 'manager' }
]

const assignableCategories: readonly AssignableObjectCategory[] = [
  { key: 'certificate', labelKey: 'settings.roles.categories.certificate', objectType: 'certificate', load: () => loadPageItems(listCertificates) },
  { key: 'application', labelKey: 'settings.roles.categories.application', objectType: 'service_asset', load: () => loadPageItems(listApplications) },
  { key: 'audit', labelKey: 'settings.roles.categories.auditLog', objectType: 'audit_log' },
  { key: 'settings', labelKey: 'settings.roles.categories.systemSetting', objectType: 'system_setting' }
]

function normalizeTreeObjectType(objectType: string): string {
  if (objectType === 'certificate_asset') return 'certificate'
  if (objectType === 'application_asset') return 'service_asset'
  return objectType
}

function categoryByObjectType(objectType: string): AssignableObjectCategory | undefined {
  const normalized = normalizeTreeObjectType(objectType)
  return assignableCategories.find((item) => item.objectType === normalized)
}

const roleColumns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'id', title: t('settings.roles.columns.roleId'), width: '22%' },
  { key: 'code', title: t('settings.roles.columns.code'), width: '14%' },
  { key: 'name', title: t('settings.roles.columns.name'), width: '16%' },
  { key: 'builtin', title: t('settings.roles.columns.builtin'), width: '10%' },
  { key: 'policyCount', title: t('settings.roles.columns.policyCount'), width: '10%' },
  { key: 'permissions', title: t('settings.roles.columns.permissions') },
  { key: 'actions', title: t('settings.roles.columns.actions'), width: 'calc(var(--gc-space-10) * 8)' }
])

const accessGrantColumns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'roleId', title: t('settings.roles.columns.roleId'), width: '24%' },
  { key: 'objectSetName', title: t('settings.roles.columns.objectScope'), width: '28%' },
  { key: 'businessLevel', title: t('settings.roles.columns.businessLevel'), width: '16%' },
  { key: 'effect', title: t('settings.roles.columns.effect'), width: '12%' },
  { key: 'actions', title: t('settings.roles.columns.actions'), width: '12%' }
])

const roleMemberColumns = computed<DataTableColumn<ApiRecord>[]>(() => [
  { key: 'principalTypeText', title: t('settings.roles.columns.memberType'), width: '18%' },
  { key: 'principalName', title: t('settings.roles.columns.member'), width: '32%' },
  { key: 'objectSetName', title: t('settings.roles.columns.objectScope') },
  { key: 'effect', title: t('settings.roles.columns.effect'), width: '12%' }
])

const currentRoleGrants = computed<ApiRecord[]>(() => {
  const roleId = readValue(selectedRole.value, 'id')
  if (!roleId) return []
  return businessPermissionRows.value
    .filter((item) => readValue(item, 'roleId') === roleId)
    .map((item, index) => ({
      ...item,
      objectSetName: businessPermissionScopeLabel(item),
      businessLevel: businessPermissionLevelText(readValue(item, 'level')),
      rowKey: [readValue(item, 'roleId'), readValue(item, 'domain'), readValue(item, 'rootObjectType'), readValue(item, 'rootObjectId'), readValue(item, 'level'), readValue(item, 'effect'), index].join(':')
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
  selectedMemberKeys.value.length > 0
    ? t('settings.roles.summary.selectedMembers', { count: selectedMemberKeys.value.length })
    : t('settings.roles.summary.chooseMembers')
)

const objectTreeNodes = computed<ObjectTreeNode[]>(() => {
  const root: ObjectTreeNode = {
    key: 'root',
    label: t('settings.roles.tree.rootLabel'),
    kind: 'root',
    objectTypes: assignableCategories.map((item) => item.objectType),
    level: 0,
    selectable: false,
    description: t('settings.roles.tree.rootDescription')
  }
  const nodes: ObjectTreeNode[] = [root]
  if (!expandedTreeKeys.value.includes('root')) return nodes
  for (const category of assignableCategories) {
    const categoryLabel = objectCategoryLabel(category)
    const typeNode: ObjectTreeNode = {
      key: category.key,
      label: categoryLabel,
      kind: 'type',
      objectType: category.objectType,
      objectTypes: [category.objectType],
      level: 1,
      selectable: category.key === 'audit' || category.key === 'settings',
      description: t('settings.roles.tree.typeDescription', { category: categoryLabel })
    }
    nodes.push(typeNode)
    if (!expandedTreeKeys.value.includes(category.key)) continue
    for (const record of objectTreeRecords.value[category.key] ?? []) {
      const objectId = recordId(record)
      if (!objectId) continue
      nodes.push({
        key: `${category.key}:${objectId}`,
        label: recordLabel(record, categoryLabel),
        kind: 'record',
        objectType: category.objectType,
        objectId,
        objectTypes: [category.objectType],
        level: 2,
        selectable: true,
        description: objectId
      })
    }
  }
  return nodes
})

const roleEditorDisabled = computed(() => saving.value || !roleDraft.name.trim())
const grantEditorDisabled = computed(() => saving.value || !grantDraft.roleId.trim() || selectedObjectNodes.value.length === 0)
const selectedPermissionPreset = computed(() => permissionPresets.find((item) => item.id === grantDraft.presetId))
const selectedObjectSummary = computed(() =>
  selectedObjectNodes.value.length > 0
    ? t('settings.roles.summary.selectedScopes', { count: selectedObjectNodes.value.length })
    : t('settings.roles.summary.chooseObjectNode')
)

function objectCategoryLabel(category: AssignableObjectCategory): string {
  return t(category.labelKey)
}

async function loadPageItems(loader: (query: { page: number; pageSize: number }) => Promise<{ data?: { items?: readonly ApiRecord[] } }>): Promise<readonly ApiRecord[]> {
  const result = await loader({ page: 1, pageSize: 100 })
  return result.data?.items ?? []
}

function readField(row: ApiRecord | null | undefined, key: string): unknown {
  return key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, row)
}

function readValue(row: ApiRecord | null | undefined, key: string): string {
  const value = readField(row, key)
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value === undefined || value === null || value === '' ? '' : String(value)
}

function displayValue(row: ApiRecord, key: string): string {
  return readValue(row, key) || '—'
}

function labelWithId(label: string, id: string): string {
  return id ? t('settings.roles.format.labelWithId', { label, id }) : label
}

function objectSetLabel(objectSetId: string): string {
  const objectSet = objectSetRows.value.find((item) => readValue(item, 'id') === objectSetId)
  return objectSet ? labelWithId(readValue(objectSet, 'name') || objectSetId, objectSetId) : objectSetId || '—'
}

function businessPermissionScopeLabel(grant: ApiRecord): string {
  const category = assignableCategories.find((item) => item.key === readValue(grant, 'domain'))
  const categoryLabel = category ? objectCategoryLabel(category) : readValue(grant, 'domain')
  const rootObjectId = readValue(grant, 'rootObjectId')
  return rootObjectId ? labelWithId(categoryLabel, rootObjectId) : categoryLabel
}

function businessPermissionLevelText(level: string): string {
  if (level === 'manager') return t('settings.roles.levels.manager')
  return t('settings.roles.levels.user')
}

function roleAccessGrants(roleId: string): ApiRecord[] {
  return accessGrantRows.value.filter((item) => readValue(item, 'roleId') === roleId)
}

function roleObjectSetIds(roleId: string): string[] {
  return [...new Set(roleAccessGrants(roleId).map((item) => readValue(item, 'objectSetId')).filter(Boolean))]
}

function objectSetMembersForObjectSet(objectSetId: string): ApiRecord[] {
  return objectSetMemberRows.value.filter((item) => readValue(item, 'objectSetId') === objectSetId)
}

function principalTypeText(type: string): string {
  if (type === 'user') return t('settings.roles.principal.user')
  if (type === 'group') return t('settings.roles.principal.group')
  if (type === 'external_group') return t('settings.roles.principal.externalGroup')
  return type || '—'
}

function principalLabel(type: string, id: string): string {
  if (type === 'user') {
    const user = userRows.value.find((item) => readValue(item, 'id') === id)
    if (user) return labelWithId(readValue(user, 'displayName') || readValue(user, 'username') || id, id)
  }
  if (type === 'group' || type === 'external_group') {
    const group = groupRows.value.find((item) => readValue(item, 'id') === id)
    if (group) return labelWithId(readValue(group, 'name') || readValue(group, 'code') || id, id)
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
  return name
    ? labelWithId(name, id)
    : t('settings.roles.format.recordFallback', { category: fallbackPrefix, value: id || t('settings.roles.format.unnamedRecord') })
}

function uniqueObjectNodes(nodes: readonly ObjectTreeNode[]): ObjectTreeNode[] {
  const seen = new Set<string>()
  return nodes.filter((node) => {
    if (seen.has(node.key)) return false
    seen.add(node.key)
    return true
  })
}

function buildRoleScopeNodeFromMember(member: ApiRecord): ObjectTreeNode | null {
  const objectId = readValue(member, 'objectId')
  const category = categoryByObjectType(readValue(member, 'objectType'))
  if (!category || !objectId) return null
  const record = (objectTreeRecords.value[category.key] ?? []).find((item) => recordId(item) === objectId)
  const categoryLabel = objectCategoryLabel(category)
  return {
    key: `${category.key}:${objectId}`,
    label: record ? recordLabel(record, categoryLabel) : recordLabel({ id: objectId }, categoryLabel),
    kind: 'record',
    objectType: category.objectType,
    objectId,
    objectTypes: [category.objectType],
    level: 2,
    selectable: true,
    description: objectId
  }
}

function buildScopeNodesForObjectSet(objectSet: ApiRecord): ObjectTreeNode[] {
  const objectSetId = readValue(objectSet, 'id')
  if (!objectSetId) return []
  if (readValue(objectSet, 'kind') === 'static') {
    return objectSetMembersForObjectSet(objectSetId)
      .map((member) => buildRoleScopeNodeFromMember(member))
      .filter((node): node is ObjectTreeNode => Boolean(node))
  }
  const rawObjectTypes = Array.isArray(readField(objectSet, 'objectTypes'))
    ? (readField(objectSet, 'objectTypes') as unknown[]).map((item) => normalizeTreeObjectType(String(item))).filter(Boolean)
    : []
  const categories = [...new Set(rawObjectTypes
    .map((objectType) => categoryByObjectType(objectType))
    .filter((category): category is AssignableObjectCategory => Boolean(category)))]
  if (categories.length === 1) {
    const category = categories[0]
    const categoryLabel = objectCategoryLabel(category)
    return [{
      key: category.key,
      label: categoryLabel,
      kind: 'type',
      objectType: category.objectType,
      objectTypes: [category.objectType],
      level: 1,
      selectable: category.key === 'audit' || category.key === 'settings',
      description: t('settings.roles.tree.typeDescription', { category: categoryLabel })
    }]
  }
  return []
}

function buildRoleScopeNodes(roleId: string): ObjectTreeNode[] {
  const nodes: ObjectTreeNode[] = []
  for (const grant of roleAccessGrants(roleId)) {
    const objectSetId = readValue(grant, 'objectSetId')
    const objectSet = objectSetRows.value.find((item) => readValue(item, 'id') === objectSetId)
    if (!objectSet) continue
    nodes.push(...buildScopeNodesForObjectSet(objectSet))
  }
  return uniqueObjectNodes(nodes)
}

function syncGrantDraftWithExistingRoleScopes(roleId: string): void {
  const grants = roleAccessGrants(roleId)
  const effects = [...new Set(grants.map((item) => readValue(item, 'effect')).filter(Boolean))]
  if (effects.length === 1 && ['allow', 'deny'].includes(effects[0])) {
    grantDraft.effect = effects[0] as AccessGrantDraft['effect']
  }
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

function isObjectNodePartiallySelected(node: ObjectTreeNode): boolean {
  if (isObjectNodeSelected(node)) return false
  if (node.kind === 'root') {
    return selectedObjectNodes.value.some((item) => item.key !== node.key)
  }
  if (node.kind === 'type') {
    return selectedObjectNodes.value.some((item) => item.key.startsWith(`${node.key}:`))
  }
  return false
}

function objectNodeSelectionIndicator(node: ObjectTreeNode): string {
  if (isObjectNodeSelected(node)) return '✓'
  if (isObjectNodePartiallySelected(node)) return '−'
  return ''
}

function objectNodeSelectionState(node: ObjectTreeNode): 'checked' | 'partial' | 'none' {
  if (isObjectNodeSelected(node)) return 'checked'
  if (isObjectNodePartiallySelected(node)) return 'partial'
  return 'none'
}

function isSameOrDescendantScope(candidate: ObjectTreeNode, target: ObjectTreeNode): boolean {
  if (target.kind === 'root') return true
  if (candidate.key === target.key) return true
  if (target.kind === 'type') return candidate.key.startsWith(`${target.key}:`)
  return false
}

function toggleObjectNodeSelection(node: ObjectTreeNode): void {
  if (!node.selectable) {
    toggleTreeNode(node)
    return
  }
  if (node.kind === 'root') {
    selectedObjectNodes.value = isObjectNodeSelected(node) ? [] : [node]
    if (!isExpanded(node.key)) toggleTreeNode(node)
    return
  }
  if (node.kind === 'type') {
    const remaining = selectedObjectNodes.value.filter((item) =>
      item.key !== 'root' && !isSameOrDescendantScope(item, node),
    )
    selectedObjectNodes.value = isObjectNodeSelected(node)
      ? remaining
      : [...remaining, node]
    if (!isExpanded(node.key)) toggleTreeNode(node)
    return
  }
  selectedObjectNodes.value = isObjectNodeSelected(node)
    ? selectedObjectNodes.value.filter((item) => item.key !== node.key)
    : [...selectedObjectNodes.value, node]
  if (node.kind !== 'record' && !isExpanded(node.key)) toggleTreeNode(node)
}

function onPermissionPresetChange(): void {
  const preset = selectedPermissionPreset.value
  if (!preset) return
  grantDraft.businessLevel = preset.level
  selectedObjectNodes.value = selectedObjectNodes.value.filter((node) => categoryByObjectType(node.objectType ?? '')?.key === preset.domain)
}

function clearSelectedObjectNodes(): void {
  selectedObjectNodes.value = []
}

function objectNodeKindText(node: ObjectTreeNode): string {
  if (node.kind === 'root') return t('settings.roles.tree.kind.all')
  if (node.kind === 'type') return t('settings.roles.tree.kind.category')
  return t('settings.roles.tree.kind.record')
}

function objectSetNameForNode(node: ObjectTreeNode): string {
  if (node.kind === 'root') return t('settings.roles.tree.allBusinessObjects')
  if (node.kind === 'type') return t('settings.roles.tree.typeDescription', { category: node.label })
  return node.label
}

function accessLevelForBusinessLevel(level: BusinessPermissionLevel): 'read' | 'edit' {
  return level === 'manager' ? 'edit' : 'read'
}

function isHiddenCompatibilityRole(row: ApiRecord): boolean {
  return hiddenCompatibilityRoleIds.has(readValue(row, 'id')) || hiddenCompatibilityRoleCodes.has(readValue(row, 'code'))
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
    objectTreeError.value = toErrorMessage(cause, t('settings.roles.errors.loadObjectTreeFailed'))
  } finally {
    objectTreeLoading.value = false
  }
}

async function reloadAll(): Promise<void> {
  loading.value = true
  pageError.value = ''
  try {
    const [roles, objectSets, objectSetMembers, grants, businessPermissions, roleBindings, users, groups] = await Promise.all([
      listRoles({ page: 1, pageSize: 100 }),
      listObjectSets({ page: 1, pageSize: 100 }),
      listObjectSetMembers({ page: 1, pageSize: 500 }),
      listAccessGrants({ page: 1, pageSize: 100 }),
      listBusinessPermissionGrants({ page: 1, pageSize: 200 }),
      listRoleBindings({ page: 1, pageSize: 200 }),
      listUsers({ page: 1, pageSize: 200 }),
      listGroups({ page: 1, pageSize: 200 })
    ])
    roleRows.value = [...(roles.data?.items ?? [])].filter((role) => !isHiddenCompatibilityRole(role))
    objectSetRows.value = [...(objectSets.data?.items ?? [])]
    objectSetMemberRows.value = [...(objectSetMembers.data?.items ?? [])]
    accessGrantRows.value = [...(grants.data?.items ?? [])]
    businessPermissionRows.value = [...(businessPermissions.data?.items ?? [])]
    roleBindingRows.value = [...(roleBindings.data?.items ?? [])]
    userRows.value = [...(users.data?.items ?? [])]
    groupRows.value = [...(groups.data?.items ?? [])]
    if (selectedRole.value) {
      const selectedId = readValue(selectedRole.value, 'id')
      selectedRole.value = roleRows.value.find((item) => readValue(item, 'id') === selectedId) ?? selectedRole.value
    }
  } catch (cause) {
    pageError.value = toErrorMessage(cause, t('settings.roles.errors.loadDataFailed'))
  } finally {
    loading.value = false
  }
}

function openCreateRole(): void {
  Object.assign(roleDraft, { name: '', description: '' })
  Object.assign(grantDraft, {
    roleId: '',
    presetId: '',
    businessLevel: 'user',
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
  const roleId = selectedRole.value ? readValue(selectedRole.value, 'id') : ''
  Object.assign(grantDraft, {
    roleId,
    presetId: '',
    businessLevel: 'user',
    effect: 'allow'
  })
  selectedObjectNodes.value = []
  modalError.value = ''
  grantEditorOpen.value = true
  void (async () => {
    await loadObjectTree()
    if (!roleId) return
    syncGrantDraftWithExistingRoleScopes(roleId)
    selectedObjectNodes.value = buildRoleScopeNodes(roleId)
  })()
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
      if (!roleId) throw new Error(t('settings.roles.errors.missingRoleId'))
      await createGrantsForRole(roleId, nodes, grantDraft.businessLevel, grantDraft.effect, grantDraft.presetId)
    }
    roleEditorOpen.value = false
    await reloadAll()
  } catch (cause) {
    modalError.value = toErrorMessage(cause, t('settings.roles.errors.createRoleFailed'))
  } finally {
    saving.value = false
  }
}

async function revokeGrant(row: ApiRecord): Promise<void> {
  const grantId = readValue(row, 'id')
  if (!grantId || saving.value || revokingGrantId.value) return
  if (!window.confirm(t('settings.roles.confirm.revokePermission'))) return
  saving.value = true
  revokingGrantId.value = grantId
  modalError.value = ''
  try {
    await revokeBusinessPermissionGrant(grantId, Number(readValue(row, 'version')) || undefined)
    await reloadAll()
  } catch (cause) {
    modalError.value = toErrorMessage(cause, t('settings.roles.errors.revokePermissionFailed'))
  } finally {
    revokingGrantId.value = ''
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
    await createGrantsForRole(grantDraft.roleId.trim(), nodes, grantDraft.businessLevel, grantDraft.effect, grantDraft.presetId)
    grantEditorOpen.value = false
    await reloadAll()
  } catch (cause) {
    modalError.value = toErrorMessage(cause, t('settings.roles.errors.grantRoleFailed'))
  } finally {
    saving.value = false
  }
}

async function submitMemberAssignment(): Promise<void> {
  if (memberEditorDisabled.value || !selectedRole.value) return
  const roleId = readValue(selectedRole.value, 'id')
  const objectSetIds = roleObjectSetIds(roleId)
  if (objectSetIds.length === 0) {
    modalError.value = t('settings.roles.errors.roleNoObjectScopes')
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
    modalError.value = toErrorMessage(cause, t('settings.roles.errors.assignMembersFailed'))
  } finally {
    saving.value = false
  }
}

async function removeRole(row: ApiRecord): Promise<void> {
  const roleId = readValue(row, 'id')
  if (!roleId || isBuiltinRole(row) || saving.value) return
  const roleName = readValue(row, 'name') || roleId
  if (!window.confirm(t('settings.roles.confirm.deleteRole', { name: roleName }))) return
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
    pageError.value = toErrorMessage(cause, t('settings.roles.errors.deleteRoleFailed'))
  } finally {
    deletingRoleId.value = ''
    saving.value = false
  }
}

async function ensureRoleSelfBinding(
  roleId: string,
  objectSetId: string,
  existingBindingKeys: Set<string>
): Promise<void> {
  const key = ['group', roleId, roleId, objectSetId].join(':')
  if (existingBindingKeys.has(key)) return
  await createRoleBinding({
    principalType: 'group',
    principalId: roleId,
    roleId,
    objectSetId,
    effect: 'allow',
    enabled: true
  })
  existingBindingKeys.add(key)
}

async function createGrantsForRole(
  roleId: string,
  nodes: readonly ObjectTreeNode[],
  businessLevel: BusinessPermissionLevel,
  effect: AccessGrantDraft['effect'],
  presetId = ''
): Promise<void> {
  const preset = permissionPresets.find((item) => item.id === presetId)
  if (preset && nodes.some((node) => categoryByObjectType(node.objectType ?? '')?.key !== preset.domain)) {
    throw new Error(t('settings.roles.errors.presetScopeMismatch'))
  }
  const existingRoleBindingKeys = new Set(roleBindingRows.value
    .filter((item) =>
      readValue(item, 'principalType') === 'group'
      && readValue(item, 'principalId') === roleId
      && readValue(item, 'roleId') === roleId,
    )
    .map((item) => ['group', roleId, roleId, readValue(item, 'objectSetId')].join(':')))
  const existingScopeObjectSetIds = new Map<string, string[]>()
  for (const grant of roleAccessGrants(roleId)) {
    const objectSetId = readValue(grant, 'objectSetId')
    const objectSet = objectSetRows.value.find((item) => readValue(item, 'id') === objectSetId)
    if (!objectSet) continue
    for (const node of buildScopeNodesForObjectSet(objectSet)) {
      existingScopeObjectSetIds.set(node.key, [...(existingScopeObjectSetIds.get(node.key) ?? []), objectSetId])
    }
  }
  for (const objectSetIds of existingScopeObjectSetIds.values()) {
    for (const objectSetId of objectSetIds) {
      await ensureRoleSelfBinding(roleId, objectSetId, existingRoleBindingKeys)
    }
  }
  const existingBusinessGrantKeys = new Set(businessPermissionRows.value
    .filter((item) => readValue(item, 'roleId') === roleId)
    .map((item) => [
      readValue(item, 'domain'),
      readValue(item, 'level'),
      readValue(item, 'rootObjectType'),
      readValue(item, 'rootObjectId'),
      readValue(item, 'effect')
    ].join(':')))
  const existingBusinessGrantIds = new Map(businessPermissionRows.value
    .filter((item) => readValue(item, 'roleId') === roleId)
    .map((item) => [[
      readValue(item, 'domain'), readValue(item, 'level'), readValue(item, 'rootObjectType'), readValue(item, 'rootObjectId'), readValue(item, 'effect')
    ].join(':'), readValue(item, 'id')] as const))
  for (const node of uniqueObjectNodes(nodes.filter((item) => item.selectable))) {
    const category = categoryByObjectType(node.objectType ?? '')
    if (!category) throw new Error(t('settings.roles.errors.invalidBusinessScope'))
    const businessGrantKey = [category.key, businessLevel, node.objectType, node.objectId ?? '', effect].join(':')
    let businessPermissionGrantId = existingBusinessGrantIds.get(businessGrantKey)
    if (!existingBusinessGrantKeys.has(businessGrantKey)) {
      const businessGrantResult = await createBusinessPermissionGrant({
        principalType: 'group',
        principalId: roleId,
        roleId,
        domain: category.key,
        level: businessLevel,
        rootObjectType: node.objectType,
        rootObjectId: node.objectId,
        effect
      })
      businessPermissionGrantId = readValue(businessGrantResult.data ?? {}, 'id')
      existingBusinessGrantKeys.add(businessGrantKey)
      if (businessPermissionGrantId) existingBusinessGrantIds.set(businessGrantKey, businessPermissionGrantId)
    }
    const existingObjectSetIds = existingScopeObjectSetIds.get(node.key) ?? []
    if (existingObjectSetIds.length > 0) {
      for (const objectSetId of existingObjectSetIds) {
        await ensureRoleSelfBinding(roleId, objectSetId, existingRoleBindingKeys)
      }
      continue
    }
    const objectSetResult = await createObjectSet({
      name: objectSetNameForNode(node),
      kind: node.kind === 'record' ? 'static' : 'dynamic',
      objectTypes: node.objectTypes,
      conditions: {},
      status: 'active'
    })
    const objectSetId = readValue(objectSetResult.data ?? {}, 'id')
    if (!objectSetId) throw new Error(t('settings.roles.errors.missingObjectSetId'))
    if (node.kind === 'record' && node.objectType && node.objectId) {
      await addObjectSetMember({
        objectSetId,
        objectType: node.objectType,
        objectId: node.objectId
      })
    }
    await ensureRoleSelfBinding(roleId, objectSetId, existingRoleBindingKeys)
    await createAccessGrant({
      roleId,
      objectSetId,
      accessLevel: accessLevelForBusinessLevel(businessLevel),
      effect,
      ...(businessPermissionGrantId ? { constraints: { businessPermissionGrantId } } : {})
    })
    existingScopeObjectSetIds.set(node.key, [...(existingScopeObjectSetIds.get(node.key) ?? []), objectSetId])
  }
}

onMounted(() => void reloadAll())
</script>

<template>
  <section class="gc-page roles-view">
    <GcPageToolbar>
      <template #actions>
        <button class="gc-button" type="button" :disabled="loading" @click="reloadAll">{{ t('common.refresh') }}</button>
      </template>
      <template #primary>
        <button class="gc-button gc-button--primary" type="button" @click="openCreateRole">{{ t('settings.roles.actions.createRole') }}</button>
      </template>
    </GcPageToolbar>

    <p v-if="pageError" class="roles-view__error">{{ pageError }}</p>

    <GcDataTable :columns="roleColumns" :rows="roleRows" :loading="loading" row-key="id" :empty-text="t('settings.roles.table.emptyRoles')" dense pagination>
      <template #toolbar>
        <div class="roles-view__table-toolbar">
          <strong>{{ t('settings.roles.table.roleRecords') }}</strong>
          <span>{{ t('businessPage.total', { count: roleRows.length }) }}</span>
        </div>
      </template>
      <template #cell-builtin="{ row }">{{ displayValue(row, 'builtin') }}</template>
      <template #cell-permissions="{ row }">
        <span class="roles-view__cell-wrap">{{ displayValue(row, 'permissions') }}</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="roles-view__row-actions">
          <button class="gc-button" type="button" @click="openRoleDetail(row)">{{ t('settings.roles.actions.detail') }}</button>
          <button class="gc-button" type="button" @click="openGrantRoleFromRole(row)">{{ t('settings.roles.actions.authorize') }}</button>
          <button class="gc-button" type="button" @click="openAssignMembersFromRole(row)">{{ t('settings.roles.actions.assignMembers') }}</button>
          <button
            v-if="!isBuiltinRole(row)"
            class="gc-button gc-button--danger"
            type="button"
            :disabled="saving"
            @click="removeRole(row)"
          >
            {{ deletingRoleId === readValue(row, 'id') ? t('settings.roles.actions.deleting') : t('settings.roles.actions.delete') }}
          </button>
        </div>
      </template>
    </GcDataTable>

    <GcModal
      v-model:open="roleDetailOpen"
      :title="selectedRole ? t('settings.roles.detail.titleWithName', { name: readValue(selectedRole, 'name') || readValue(selectedRole, 'code') }) : t('settings.roles.detail.title')"
      :description="t('settings.roles.detail.description')"
      size="xxl"
    >
      <section v-if="selectedRole" class="roles-view__detail">
        <dl class="roles-view__facts">
          <div><dt>{{ t('settings.roles.columns.roleId') }}</dt><dd>{{ displayValue(selectedRole, 'id') }}</dd></div>
          <div><dt>{{ t('settings.roles.columns.code') }}</dt><dd>{{ displayValue(selectedRole, 'code') }}</dd></div>
          <div><dt>{{ t('settings.roles.columns.name') }}</dt><dd>{{ displayValue(selectedRole, 'name') }}</dd></div>
          <div><dt>{{ t('settings.roles.columns.builtin') }}</dt><dd>{{ displayValue(selectedRole, 'builtin') }}</dd></div>
          <div><dt>{{ t('settings.roles.columns.policyCount') }}</dt><dd>{{ displayValue(selectedRole, 'policyCount') }}</dd></div>
          <div><dt>{{ t('settings.roles.columns.permissions') }}</dt><dd>{{ displayValue(selectedRole, 'permissions') }}</dd></div>
        </dl>

        <GcDataTable :columns="accessGrantColumns" :rows="currentRoleGrants" row-key="rowKey" :empty-text="t('settings.roles.table.emptyGrants')" dense pagination>
          <template #toolbar>
            <div class="roles-view__table-toolbar">
              <strong>{{ t('settings.roles.table.currentPermissions') }}</strong>
              <button class="gc-button" type="button" @click="openGrantRole()">{{ t('settings.roles.actions.grantPermission') }}</button>
            </div>
          </template>
          <template #cell-actions="{ row }">
            <button class="gc-button gc-button--danger" type="button" :disabled="saving" @click="revokeGrant(row)">
              {{ revokingGrantId === readValue(row, 'id') ? t('settings.roles.actions.revoking') : t('settings.roles.actions.revokePermission') }}
            </button>
          </template>
        </GcDataTable>

        <GcDataTable :columns="roleMemberColumns" :rows="currentRoleMembers" row-key="rowKey" :empty-text="t('settings.roles.table.emptyMembers')" dense pagination>
          <template #toolbar>
            <div class="roles-view__table-toolbar">
              <strong>{{ t('settings.roles.table.assignedMembers') }}</strong>
              <button class="gc-button" type="button" @click="openAssignMembersFromRole(selectedRole)">{{ t('settings.roles.actions.assignMembers') }}</button>
            </div>
          </template>
        </GcDataTable>
      </section>

      <template #actions>
        <button v-if="selectedRole && !isBuiltinRole(selectedRole)" class="gc-button gc-button--danger" type="button" :disabled="saving" @click="removeRole(selectedRole)">
          {{ deletingRoleId === readValue(selectedRole, 'id') ? t('settings.roles.actions.deleting') : t('settings.roles.actions.deleteRole') }}
        </button>
        <button class="gc-button" type="button" @click="roleDetailOpen = false">{{ t('designSystem.dryRunResult.close') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="roleEditorOpen" :title="t('settings.roles.create.title')" :description="t('settings.roles.create.description')" size="xl">
      <section class="roles-view__form">
        <label><span>{{ t('settings.roles.create.nameLabel') }} <strong>*</strong></span><input v-model="roleDraft.name" :placeholder="t('settings.roles.create.namePlaceholder')" /></label>
        <label class="roles-view__field--wide"><span>{{ t('settings.roles.create.descriptionLabel') }}</span><textarea v-model="roleDraft.description" :placeholder="t('settings.roles.create.descriptionPlaceholder')" /></label>
      </section>

      <section class="roles-view__grant-editor roles-view__create-grant">
        <section class="roles-view__grant-summary">
          <div>
            <span>{{ t('settings.roles.create.authorizedRole') }}</span>
            <strong>{{ roleDraft.name.trim() || t('settings.roles.create.newRole') }}</strong>
          </div>
          <div>
            <span>{{ t('settings.roles.summary.selectedScopeLabel') }}</span>
            <strong>{{ selectedObjectSummary }}</strong>
          </div>
        </section>

        <section v-if="selectedObjectNodes.length > 0" class="roles-view__selected-scopes" :aria-label="t('settings.roles.tree.selectedScopeAria')">
          <span v-for="node in selectedObjectNodes" :key="node.key">{{ objectSetNameForNode(node) }}</span>
          <button class="gc-button" type="button" @click="clearSelectedObjectNodes">{{ t('settings.roles.actions.clearSelection') }}</button>
        </section>

        <section class="roles-view__object-tree" :aria-label="t('settings.roles.tree.objectTreeAria')">
          <header>
            <strong>{{ t('settings.roles.tree.authorizableObjects') }}</strong>
            <button class="gc-button" type="button" :disabled="objectTreeLoading" @click="loadObjectTree">
              {{ objectTreeLoading ? t('settings.roles.actions.loading') : t('settings.roles.actions.refreshObjects') }}
            </button>
          </header>
          <p v-if="objectTreeError" class="roles-view__error">{{ objectTreeError }}</p>
          <div v-if="objectTreeLoading" class="roles-view__tree-state">{{ t('settings.roles.tree.loading') }}</div>
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
                <span class="roles-view__tree-check" :data-state="objectNodeSelectionState(node)">{{ objectNodeSelectionIndicator(node) }}</span>
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
            <span>{{ t('settings.roles.columns.businessLevel') }}</span>
            <select v-model="grantDraft.businessLevel">
              <option value="user">{{ t('settings.roles.levels.user') }}</option>
              <option value="manager">{{ t('settings.roles.levels.manager') }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('settings.roles.columns.effect') }}</span>
            <select v-model="grantDraft.effect">
              <option value="allow">{{ t('settings.roles.effect.allow') }}</option>
              <option value="deny">{{ t('settings.roles.effect.deny') }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('settings.roles.presets.label') }}</span>
            <select v-model="grantDraft.presetId" @change="onPermissionPresetChange">
              <option value="">{{ t('settings.roles.presets.custom') }}</option>
              <option v-for="preset in permissionPresets" :key="preset.id" :value="preset.id">{{ t(preset.labelKey) }}</option>
            </select>
          </label>
        </section>
      </section>
      <p v-if="modalError" class="roles-view__error">{{ modalError }}</p>
      <template #actions>
        <button class="gc-button" type="button" :disabled="saving" @click="roleEditorOpen = false">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="roleEditorDisabled" @click="submitRole">{{ saving ? t('settings.roles.actions.creating') : t('settings.roles.actions.createRole') }}</button>
      </template>
    </GcModal>

    <GcModal v-model:open="grantEditorOpen" :title="t('settings.roles.grant.title')" :description="t('settings.roles.grant.description')" size="xl">
      <section class="roles-view__grant-editor">
        <section class="roles-view__grant-summary">
          <div>
            <span>{{ t('settings.roles.grant.roleLabel') }}</span>
            <strong>{{ grantDraft.roleId || '—' }}</strong>
          </div>
          <div>
            <span>{{ t('settings.roles.summary.selectedScopeLabel') }}</span>
            <strong>{{ selectedObjectSummary }}</strong>
          </div>
        </section>

        <section v-if="selectedObjectNodes.length > 0" class="roles-view__selected-scopes" :aria-label="t('settings.roles.tree.selectedScopeAria')">
          <span v-for="node in selectedObjectNodes" :key="node.key">{{ objectSetNameForNode(node) }}</span>
          <button class="gc-button" type="button" @click="clearSelectedObjectNodes">{{ t('settings.roles.actions.clearSelection') }}</button>
        </section>

        <section class="roles-view__object-tree" :aria-label="t('settings.roles.tree.objectTreeAria')">
          <header>
            <strong>{{ t('settings.roles.tree.authorizableObjects') }}</strong>
            <button class="gc-button" type="button" :disabled="objectTreeLoading" @click="loadObjectTree">
              {{ objectTreeLoading ? t('settings.roles.actions.loading') : t('settings.roles.actions.refreshObjects') }}
            </button>
          </header>
          <p v-if="objectTreeError" class="roles-view__error">{{ objectTreeError }}</p>
          <div v-if="objectTreeLoading" class="roles-view__tree-state">{{ t('settings.roles.tree.loading') }}</div>
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
                <span class="roles-view__tree-check" :data-state="objectNodeSelectionState(node)">{{ objectNodeSelectionIndicator(node) }}</span>
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
            <span>{{ t('settings.roles.columns.businessLevel') }}</span>
            <select v-model="grantDraft.businessLevel">
              <option value="user">{{ t('settings.roles.levels.user') }}</option>
              <option value="manager">{{ t('settings.roles.levels.manager') }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('settings.roles.columns.effect') }}</span>
            <select v-model="grantDraft.effect">
              <option value="allow">{{ t('settings.roles.effect.allow') }}</option>
              <option value="deny">{{ t('settings.roles.effect.deny') }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('settings.roles.presets.label') }}</span>
            <select v-model="grantDraft.presetId" @change="onPermissionPresetChange">
              <option value="">{{ t('settings.roles.presets.custom') }}</option>
              <option v-for="preset in permissionPresets" :key="preset.id" :value="preset.id">{{ t(preset.labelKey) }}</option>
            </select>
          </label>
        </section>

        <p v-if="modalError" class="roles-view__error">{{ modalError }}</p>
      </section>
      <template #actions>
        <button class="gc-button" type="button" :disabled="saving" @click="grantEditorOpen = false">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="grantEditorDisabled" @click="submitGrant">{{ saving ? t('settings.roles.actions.saving') : t('settings.roles.actions.grantPermission') }}</button>
      </template>
    </GcModal>

    <GcModal
      v-model:open="memberEditorOpen"
      :title="selectedRole ? t('settings.roles.member.titleWithName', { name: readValue(selectedRole, 'name') || readValue(selectedRole, 'code') }) : t('settings.roles.member.title')"
      :description="t('settings.roles.member.description')"
      size="lg"
    >
      <section class="roles-view__member-editor">
        <section class="roles-view__grant-summary">
          <div>
            <span>{{ t('settings.roles.member.targetRole') }}</span>
            <strong>{{ selectedRole ? readValue(selectedRole, 'name') || readValue(selectedRole, 'code') : '—' }}</strong>
          </div>
          <div>
            <span>{{ t('settings.roles.member.authorizedScope') }}</span>
            <strong>{{ selectedRole ? t('settings.roles.member.objectScopeCount', { count: roleObjectSetIds(readValue(selectedRole, 'id')).length }) : '—' }}</strong>
          </div>
        </section>

        <section class="roles-view__form roles-view__form--two">
          <label>
            <span>{{ t('settings.roles.columns.memberType') }}</span>
            <select v-model="memberPrincipalType" @change="onMemberPrincipalTypeChange">
              <option value="user">{{ t('settings.roles.principal.user') }}</option>
              <option value="group">{{ t('settings.roles.principal.group') }}</option>
            </select>
          </label>
          <label>
            <span>{{ t('settings.roles.summary.selectedMemberLabel') }}</span>
            <input :value="selectedMemberSummary" readonly />
          </label>
        </section>

        <section v-if="selectedMemberKeys.length > 0" class="roles-view__selected-scopes" :aria-label="t('settings.roles.member.selectedMembersAria')">
          <span v-for="key in selectedMemberKeys" :key="key">
            {{ memberOptions.find((option) => option.key === key)?.label || key }}
          </span>
          <button class="gc-button" type="button" @click="clearSelectedMembers">{{ t('settings.roles.actions.clearSelection') }}</button>
        </section>

        <section class="roles-view__member-list" :aria-label="t('settings.roles.member.assignableMembersAria')">
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
            {{ t('settings.roles.member.emptyAssignable', { type: memberPrincipalType === 'user' ? t('settings.roles.principal.user') : t('settings.roles.principal.group') }) }}
          </div>
        </section>

        <p v-if="modalError" class="roles-view__error">{{ modalError }}</p>
      </section>
      <template #actions>
        <button class="gc-button" type="button" :disabled="saving" @click="memberEditorOpen = false">{{ t('designSystem.confirm.cancel') }}</button>
        <button class="gc-button gc-button--primary" type="button" :disabled="memberEditorDisabled" @click="submitMemberAssignment">
          {{ saving ? t('settings.roles.actions.saving') : t('settings.roles.actions.assignMembers') }}
        </button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.roles-view { display: grid; gap: var(--gc-space-5); }
.roles-view__table-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.roles-view__table-toolbar strong { font-size: var(--gc-font-size-sm); }
.roles-view__table-toolbar span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 750; }
.roles-view__row-actions { display: flex; flex-wrap: nowrap; gap: var(--gc-space-1); white-space: nowrap; }
.roles-view__row-actions button { white-space: nowrap; }
.roles-view__cell-wrap { display: inline-block; max-width: calc(var(--gc-space-10) * 13); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
/* 紧凑表格布局：与 settings/users 表格样式对齐 */
.roles-view :deep(.gc-data-table .gc-data-table__toolbar) { padding: var(--gc-space-3) var(--gc-space-4); }
.roles-view :deep(.gc-data-table th),
.roles-view :deep(.gc-data-table td) { padding: var(--gc-space-2) var(--gc-space-3); line-height: 1.25; }
.roles-view :deep(.gc-data-table th) { font-size: var(--gc-font-size-xs); font-weight: 700; letter-spacing: 0; text-transform: uppercase; white-space: nowrap; }
.roles-view :deep(.gc-data-table td) { font-size: var(--gc-font-size-xs); font-weight: 650; white-space: nowrap; }
.roles-view__detail { display: grid; gap: var(--gc-space-4); }
.roles-view__facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--gc-space-3); margin: 0; }
.roles-view__facts div { min-width: 0; border: var(--gc-border-width-default) solid var(--gc-color-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3); background: var(--gc-color-surface-muted); }
.roles-view__facts dt { margin-bottom: var(--gc-space-1); color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.roles-view__facts dd { margin: 0; overflow-wrap: anywhere; font-size: var(--gc-font-size-sm); font-weight: 750; }
.roles-view__grant-editor { display: grid; gap: var(--gc-space-4); }
.roles-view__create-grant { margin-top: var(--gc-space-4); }
.roles-view__member-editor { display: grid; gap: var(--gc-space-4); }
.roles-view__grant-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--gc-space-3); }
.roles-view__grant-summary div {
  display: grid;
  gap: var(--gc-space-1);
  min-width: 0;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-md);
  padding: var(--gc-space-3);
  background: var(--gc-color-surface-muted);
}
.roles-view__grant-summary span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 850; }
.roles-view__grant-summary strong { overflow-wrap: anywhere; font-size: var(--gc-font-size-sm); }
.roles-view__selected-scopes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-space-2);
  padding: var(--gc-space-2) var(--gc-space-3);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-md);
  background: var(--gc-color-surface-selected);
}
.roles-view__selected-scopes span {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-height: var(--gc-control-height-xs);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-pill);
  padding: 0 var(--gc-space-2);
  overflow: hidden;
  color: var(--gc-color-primary-strong);
  background: var(--gc-color-surface-solid);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.roles-view__selected-scopes .gc-button { margin-left: auto; }
.roles-view__object-tree {
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-lg);
  background: var(--gc-color-surface-solid);
}
.roles-view__object-tree header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-3);
  padding: var(--gc-space-3) var(--gc-space-4);
  border-bottom: var(--gc-border-width-default) solid var(--gc-color-border);
  background: var(--gc-gradient-surface);
}
.roles-view__object-tree header strong { font-size: var(--gc-font-size-sm); }
.roles-view__tree-state { padding: var(--gc-space-8) var(--gc-space-4); text-align: center; color: var(--gc-color-text-muted); font-weight: 800; }
.roles-view__tree-list { display: grid; max-height: calc(var(--gc-space-12) * 7); overflow: auto; margin: 0; padding: var(--gc-space-2); list-style: none; }
.roles-view__tree-node {
  --tree-level: 0;
  display: grid;
  grid-template-columns: var(--gc-space-7) var(--gc-space-6) minmax(0, 1fr);
  gap: var(--gc-space-2);
  width: 100%;
  min-height: var(--gc-control-height-md);
  margin: 0;
  border: var(--gc-border-width-default) solid transparent;
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-2) var(--gc-space-3) var(--gc-space-2) calc(var(--gc-space-3) + (var(--tree-level) * var(--gc-space-6)));
  color: var(--gc-color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.roles-view__tree-node:hover { background: var(--gc-color-surface-hover); border-color: var(--gc-color-info-border); }
.roles-view__tree-node--selected { background: var(--gc-color-surface-selected); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-focus); }
.roles-view__tree-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--gc-space-6);
  height: var(--gc-space-6);
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-primary);
  background: var(--gc-color-surface-selected);
  font-weight: 900;
}
.roles-view__tree-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--gc-space-6);
  height: var(--gc-space-6);
  align-self: center;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  color: transparent;
  background: var(--gc-color-surface-solid);
  font-size: var(--gc-font-size-sm);
  font-weight: 950;
}
.roles-view__tree-check[data-state='checked'],
.roles-view__tree-check[data-state='partial'] {
  border-color: var(--gc-color-primary);
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-primary);
}
.roles-view__tree-copy { display: grid; gap: var(--gc-space-1); min-width: 0; }
.roles-view__tree-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--gc-font-size-sm); }
.roles-view__tree-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 750; }
.roles-view__member-list {
  display: grid;
  max-height: calc(var(--gc-space-12) * 7);
  overflow: auto;
  border: var(--gc-border-width-default) solid var(--gc-color-border-soft);
  border-radius: var(--gc-radius-lg);
  padding: var(--gc-space-2);
  background: var(--gc-color-surface-glass);
}
.roles-view__member-option {
  display: grid;
  grid-template-columns: var(--gc-space-6) minmax(0, 1fr);
  gap: var(--gc-space-3);
  align-items: center;
  min-height: var(--gc-control-height-lg);
  border: var(--gc-border-width-default) solid transparent;
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-2) var(--gc-space-3);
  color: var(--gc-color-text);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.roles-view__member-option:hover { background: var(--gc-color-surface-hover); border-color: var(--gc-color-info-border); }
.roles-view__member-option--selected { background: var(--gc-color-surface-selected); border-color: var(--gc-color-primary-border-strong); box-shadow: var(--gc-shadow-focus); }
.roles-view__member-option span:last-child { display: grid; gap: var(--gc-space-1); min-width: 0; }
.roles-view__member-option strong,
.roles-view__member-option small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.roles-view__member-option strong { font-size: var(--gc-font-size-sm); }
.roles-view__member-option small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); font-weight: 750; }
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
  min-height: var(--gc-control-height-md);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-control);
  padding: var(--gc-space-2) var(--gc-space-3);
  color: var(--gc-color-text);
  background: var(--gc-color-surface-muted);
  outline: none;
}
.roles-view__form textarea { min-height: calc(var(--gc-space-12) * 2); resize: vertical; }
.roles-view__form input:focus,
.roles-view__form select:focus,
.roles-view__form textarea:focus { border-color: var(--gc-color-focus); box-shadow: var(--gc-shadow-focus); background: var(--gc-color-surface-solid); }
.roles-view__error { margin: 0; border: var(--gc-border-width-default) solid var(--gc-color-danger-border); border-radius: var(--gc-radius-md); padding: var(--gc-space-3) var(--gc-space-4); color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }
@media (max-width: 53.75rem) {
  .roles-view__facts,
  .roles-view__grant-summary,
  .roles-view__form--two { grid-template-columns: 1fr; }
  .roles-view__table-toolbar { align-items: flex-start; flex-direction: column; }
}
</style>
