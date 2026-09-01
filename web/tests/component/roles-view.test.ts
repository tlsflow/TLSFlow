import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'

const securityMocks = vi.hoisted(() => ({
  addObjectSetMember: vi.fn(),
  createAccessGrant: vi.fn(),
  createBusinessPermissionGrant: vi.fn(),
  createObjectSet: vi.fn(),
  createRole: vi.fn(),
  createRoleBinding: vi.fn(),
  deleteRole: vi.fn(),
  listAccessGrants: vi.fn(),
  listBusinessPermissionGrants: vi.fn(),
  listGroups: vi.fn(),
  listObjectSetMembers: vi.fn(),
  listObjectSets: vi.fn(),
  listRoleBindings: vi.fn(),
  listRoles: vi.fn(),
  listUsers: vi.fn(),
  revokeBusinessPermissionGrant: vi.fn(),
}))

const assetMocks = vi.hoisted(() => ({ listApplications: vi.fn() }))
const certificateMocks = vi.hoisted(() => ({ listCertificates: vi.fn() }))

vi.mock('@/api/modules/security.api', () => securityMocks)
vi.mock('@/api/modules/assets.api', () => assetMocks)
vi.mock('@/api/modules/certificates.api', () => certificateMocks)

import RolesView from '@/views/settings/RolesView.vue'

function page(items: readonly Record<string, unknown>[] = []) {
  return { data: { items } }
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string, index = 0) {
  const button = wrapper.findAll('button').filter((item) => item.text().trim() === text)[index]
  if (!button) throw new Error(`未找到按钮：${text}`)
  return button
}

describe('RolesView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    securityMocks.listRoles.mockResolvedValue(page())
    securityMocks.listObjectSets.mockResolvedValue(page())
    securityMocks.listObjectSetMembers.mockResolvedValue(page())
    securityMocks.listAccessGrants.mockResolvedValue(page())
    securityMocks.listBusinessPermissionGrants.mockResolvedValue(page())
    securityMocks.listRoleBindings.mockResolvedValue(page())
    securityMocks.listUsers.mockResolvedValue(page())
    securityMocks.listGroups.mockResolvedValue(page())
    securityMocks.createRole.mockResolvedValue({ data: { id: 'role-app-manager' } })
    securityMocks.createObjectSet.mockResolvedValue({ data: { id: 'object-set-all' } })
    securityMocks.createAccessGrant.mockResolvedValue({ data: { id: 'grant-app-manager' } })
    securityMocks.createBusinessPermissionGrant.mockResolvedValue({ data: { id: 'business-grant-app-manager' } })
    securityMocks.createRoleBinding.mockResolvedValue({ data: { id: 'binding-app-manager' } })
    securityMocks.addObjectSetMember.mockResolvedValue({ data: { id: 'member-app-manager' } })
    assetMocks.listApplications.mockResolvedValue(page())
    certificateMocks.listCertificates.mockResolvedValue(page())
  })

  it('隐藏兼容外部用户角色，并只显示四个业务授权域', async () => {
    securityMocks.listRoles.mockResolvedValue(page([
      { id: 'role_external_user', code: 'external_user', name: '外部用户', builtin: true },
      { id: 'role_app_manager', code: 'app_manager', name: '应用管理员', builtin: false }
    ]))

    const wrapper = mount(RolesView, { global: { plugins: [i18n], stubs: { teleport: true } } })
    await flushPromises()

    expect(wrapper.text()).toContain('应用管理员')
    expect(wrapper.text()).not.toContain('外部用户')

    await buttonByText(wrapper, '创建角色').trigger('click')
    await flushPromises()

    const treeText = wrapper.find('.roles-view__object-tree').text()
    expect(treeText).toContain('证书')
    expect(treeText).toContain('应用')
    expect(treeText).toContain('日志')
    expect(treeText).toContain('系统设置')
    expect(treeText).not.toContain('Agent')
    expect(treeText).not.toContain('网关')
    expect(treeText).not.toContain('更新计划')
    expect(treeText).not.toContain('工作流')
  })

  it('创建角色时以业务域、根对象和角色绑定保存应用管理者授权', async () => {
    assetMocks.listApplications.mockResolvedValue(page([{ id: 'app_1', name: '订单应用' }]))

    const wrapper = mount(RolesView, { global: { plugins: [i18n], stubs: { teleport: true } } })
    await flushPromises()

    expect(securityMocks.listRoles).toHaveBeenCalledWith({ page: 1, pageSize: 100 })
    expect(securityMocks.listObjectSets).toHaveBeenCalledWith({ page: 1, pageSize: 100 })
    expect(securityMocks.listBusinessPermissionGrants).toHaveBeenCalledWith({ page: 1, pageSize: 200 })
    expect(securityMocks.listRoleBindings).toHaveBeenCalledWith({ page: 1, pageSize: 200 })

    await buttonByText(wrapper, '创建角色').trigger('click')
    await flushPromises()
    await wrapper.find('.gc-modal input').setValue('应用管理员')
    const applicationCategory = wrapper.findAll('.roles-view__tree-node').find((item) => item.text().includes('应用'))
    if (!applicationCategory) throw new Error('未找到应用业务域')
    await applicationCategory.trigger('click')
    await flushPromises()
    const applicationRecord = wrapper.findAll('.roles-view__tree-node').find((item) => item.text().includes('订单应用'))
    if (!applicationRecord) throw new Error('未找到应用根对象')
    await applicationRecord.trigger('click')
    await wrapper.find('select').setValue('manager')
    await buttonByText(wrapper, '创建角色', 1).trigger('click')
    await flushPromises()

    expect(securityMocks.createRole).toHaveBeenCalledWith(expect.objectContaining({ name: '应用管理员' }))
    expect(securityMocks.createObjectSet).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'static',
      objectTypes: ['service_asset'],
    }))
    expect(securityMocks.createAccessGrant).toHaveBeenCalledWith({
      roleId: 'role-app-manager',
      objectSetId: 'object-set-all',
      accessLevel: 'edit',
      effect: 'allow',
      constraints: { businessPermissionGrantId: 'business-grant-app-manager' },
    })
    expect(securityMocks.createRoleBinding).toHaveBeenCalledWith({
      principalType: 'group',
      principalId: 'role-app-manager',
      roleId: 'role-app-manager',
      objectSetId: 'object-set-all',
      effect: 'allow',
      enabled: true,
    })
    expect(securityMocks.createBusinessPermissionGrant).toHaveBeenCalledWith({
      principalType: 'group',
      principalId: 'role-app-manager',
      roleId: 'role-app-manager',
      domain: 'application',
      level: 'manager',
      rootObjectType: 'service_asset',
      rootObjectId: 'app_1',
      effect: 'allow',
    })
  })

  it('将用户关联到角色时按已有对象范围创建 RoleBinding', async () => {
    securityMocks.listRoles.mockResolvedValue(page([{ id: 'role-app-reader', code: 'app_reader', name: '应用查看者', builtin: false }]))
    securityMocks.listBusinessPermissionGrants.mockResolvedValue(page([{
      id: 'bpgr-app-reader', roleId: 'role-app-reader', status: 'active', domain: 'application', level: 'user',
      rootObjectType: 'service_asset', rootObjectId: 'app-reader', effect: 'allow',
    }]))
    securityMocks.listObjectSets.mockResolvedValue(page([{ id: 'object-set-app', name: '应用范围', kind: 'static' }]))
    securityMocks.listAccessGrants.mockResolvedValue(page([{
      roleId: 'role-app-reader', objectSetId: 'object-set-app', accessLevel: 'read', effect: 'allow',
      constraints: { businessPermissionGrantId: 'bpgr-app-reader' },
    }]))
    securityMocks.listUsers.mockResolvedValue(page([{ id: 'user-1', username: 'operator', displayName: '运维用户', status: 'active' }]))

    const wrapper = mount(RolesView, { global: { plugins: [i18n], stubs: { teleport: true } } })
    await flushPromises()

    await buttonByText(wrapper, '分配成员').trigger('click')
    await wrapper.find('.roles-view__member-option').trigger('click')
    await buttonByText(wrapper, '分配成员', 1).trigger('click')
    await flushPromises()

    expect(securityMocks.createRoleBinding).toHaveBeenCalledWith({
      principalType: 'user',
      principalId: 'user-1',
      roleId: 'role-app-reader',
      objectSetId: 'object-set-app',
      effect: 'allow',
      enabled: true,
    })
  })

  it('编辑角色范围只回显 active 业务授权，不读取历史兼容对象集', async () => {
    securityMocks.listRoles.mockResolvedValue(page([{ id: 'role-reader', code: 'reader', name: '查看者', builtin: false }]))
    securityMocks.listBusinessPermissionGrants.mockResolvedValue(page([{
      id: 'bpgr-cert-active', roleId: 'role-reader', status: 'active', domain: 'certificate', level: 'user',
      rootObjectType: 'certificate', rootObjectId: 'cert-1', effect: 'allow',
    }]))
    securityMocks.listAccessGrants.mockResolvedValue(page([{
      id: 'legacy-access', roleId: 'role-reader', objectSetId: 'legacy-app-set', accessLevel: 'read', effect: 'allow',
    }]))
    securityMocks.listObjectSets.mockResolvedValue(page([{ id: 'legacy-app-set', kind: 'static', objectTypes: ['service_asset'] }]))
    securityMocks.listObjectSetMembers.mockResolvedValue(page([{ objectSetId: 'legacy-app-set', objectType: 'service_asset', objectId: 'app-old' }]))
    certificateMocks.listCertificates.mockResolvedValue(page([{ id: 'cert-1', name: '*.example.com' }]))
    assetMocks.listApplications.mockResolvedValue(page([{ id: 'app-old', name: '旧应用' }]))

    const wrapper = mount(RolesView, { global: { plugins: [i18n], stubs: { teleport: true } } })
    await flushPromises()
    await buttonByText(wrapper, '授权').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('已选 1 个范围')
    expect(wrapper.text()).toContain('*.example.com')
    expect(wrapper.text()).not.toContain('旧应用')
  })

  it('替换角色范围时不重复撤销历史 revoked 业务授权', async () => {
    securityMocks.listRoles.mockResolvedValue(page([{ id: 'role-reader', code: 'reader', name: '查看者', builtin: false }]))
    securityMocks.listBusinessPermissionGrants.mockResolvedValue(page([
      {
        id: 'bpgr-cert-active', roleId: 'role-reader', status: 'active', domain: 'certificate', level: 'user',
        rootObjectType: 'certificate', rootObjectId: 'cert-1', effect: 'allow', version: 2,
      },
      {
        id: 'bpgr-old-revoked', roleId: 'role-reader', status: 'revoked', domain: 'application', level: 'user',
        rootObjectType: 'service_asset', rootObjectId: 'app-old', effect: 'allow', version: 3,
      },
    ]))
    certificateMocks.listCertificates.mockResolvedValue(page([{ id: 'cert-1', name: '*.example.com' }]))
    assetMocks.listApplications.mockResolvedValue(page([{ id: 'app-old', name: '旧应用' }]))

    const wrapper = mount(RolesView, { global: { plugins: [i18n], stubs: { teleport: true } } })
    await flushPromises()
    await buttonByText(wrapper, '授权').trigger('click')
    await flushPromises()
    await buttonByText(wrapper, '授予权限').trigger('click')
    await flushPromises()

    expect(securityMocks.revokeBusinessPermissionGrant).not.toHaveBeenCalledWith('bpgr-old-revoked', 3)
  })

  it('重新打开角色授权时回显已有业务级别，并为级别变更补写兼容授权', async () => {
    securityMocks.listRoles.mockResolvedValue(page([{ id: 'role-reader', code: 'reader', name: '查看者', builtin: false }]))
    securityMocks.listBusinessPermissionGrants.mockResolvedValue(page([{
      id: 'bpgr-app-user', roleId: 'role-reader', status: 'active', domain: 'application', level: 'user',
      rootObjectType: 'service_asset', rootObjectId: 'app-1', effect: 'allow', version: 1,
    }]))
    securityMocks.listObjectSets.mockResolvedValue(page([{ id: 'object-set-app', name: '应用范围', kind: 'static', objectTypes: ['service_asset'] }]))
    securityMocks.listObjectSetMembers.mockResolvedValue(page([{ objectSetId: 'object-set-app', objectType: 'service_asset', objectId: 'app-1' }]))
    securityMocks.listAccessGrants.mockResolvedValue(page([{
      roleId: 'role-reader', objectSetId: 'object-set-app', accessLevel: 'read', effect: 'allow',
      constraints: { businessPermissionGrantId: 'bpgr-app-user' },
    }]))
    assetMocks.listApplications.mockResolvedValue(page([{ id: 'app-1', name: '应用一' }]))

    const wrapper = mount(RolesView, { global: { plugins: [i18n], stubs: { teleport: true } } })
    await flushPromises()
    await buttonByText(wrapper, '授权').trigger('click')
    await flushPromises()

    const levelSelect = wrapper.findAll('select').find((item) => item.find('option[value="manager"]').exists())
    if (!levelSelect) throw new Error('未找到业务权限级别选择器')
    expect((levelSelect.element as HTMLSelectElement).value).toBe('user')
    await levelSelect.setValue('manager')
    await buttonByText(wrapper, '授予权限').trigger('click')
    await flushPromises()

    expect(securityMocks.revokeBusinessPermissionGrant).toHaveBeenCalledWith('bpgr-app-user', 1)
    expect(securityMocks.createBusinessPermissionGrant).toHaveBeenCalledWith(expect.objectContaining({
      roleId: 'role-reader', level: 'manager', rootObjectId: 'app-1',
    }))
    expect(securityMocks.createAccessGrant).toHaveBeenCalledWith(expect.objectContaining({
      roleId: 'role-reader', objectSetId: 'object-set-all', accessLevel: 'edit', effect: 'allow',
    }))
  })

  it('已有管理者授权再次打开时不应退回使用者', async () => {
    securityMocks.listRoles.mockResolvedValue(page([{ id: 'role-manager', code: 'manager', name: '管理员', builtin: false }]))
    securityMocks.listBusinessPermissionGrants.mockResolvedValue(page([{
      id: 'bpgr-app-manager', roleId: 'role-manager', status: 'active', domain: 'application', level: 'manager',
      rootObjectType: 'service_asset', rootObjectId: 'app-1', effect: 'allow', version: 1,
    }]))
    assetMocks.listApplications.mockResolvedValue(page([{ id: 'app-1', name: '应用一' }]))

    const wrapper = mount(RolesView, { global: { plugins: [i18n], stubs: { teleport: true } } })
    await flushPromises()
    await buttonByText(wrapper, '授权').trigger('click')
    await flushPromises()

    const levelSelect = wrapper.findAll('select').find((item) => item.find('option[value="manager"]').exists())
    if (!levelSelect) throw new Error('未找到业务权限级别选择器')
    expect((levelSelect.element as HTMLSelectElement).value).toBe('manager')
  })
})
