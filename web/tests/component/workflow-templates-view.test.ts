import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import WorkflowTemplatesView from '@/views/workflows/WorkflowTemplatesView.vue'
import { usePermissionStore } from '@/stores/permission.store'
import {
  applyWorkflowTemplateFromFile,
  compileWorkflowCanvas,
  createWorkflowTemplate,
  createWorkflowTemplateFromFile,
  createWorkflowTemplateVersion,
  deleteWorkflowTemplate,
  listWorkflowFileTemplates,
  listWorkflowTemplates,
  listWorkflowTemplateVersions,
  publishWorkflowTemplateVersion,
  updateCurrentWorkflowTemplateDraftVersion,
} from '@/api/modules/workflow-templates.api'
import { createSecret, listSecrets } from '@/api/modules/security.api'

vi.mock('@/api/modules/workflow-templates.api', () => ({
  listWorkflowTemplates: vi.fn(),
  listWorkflowFileTemplates: vi.fn(),
  createWorkflowTemplate: vi.fn(),
  createWorkflowTemplateFromFile: vi.fn(),
  compileWorkflowCanvas: vi.fn(),
  deleteWorkflowTemplate: vi.fn(),
  applyWorkflowTemplateFromFile: vi.fn(),
  listWorkflowTemplateVersions: vi.fn(),
  createWorkflowTemplateVersion: vi.fn(),
  publishWorkflowTemplateVersion: vi.fn(),
  updateCurrentWorkflowTemplateDraftVersion: vi.fn(),
}))

vi.mock('@/api/modules/security.api', () => ({
  createSecret: vi.fn(),
  listSecrets: vi.fn(),
}))

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_ok',
    timestamp: '2026-07-03T00:00:00.000Z',
  }
}

function clickBodyButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((item) => item.textContent?.trim() === text) as HTMLButtonElement | undefined
  expect(button).toBeTruthy()
  button!.click()
}

function clickBodyButtonContaining(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((item) => item.textContent?.includes(text)) as HTMLButtonElement | undefined
  expect(button).toBeTruthy()
  button!.click()
}

function versionStatusTexts(item: Element | undefined): string[] {
  return [...item?.querySelectorAll('.workflow-version-manager__status') ?? []].map((status) => status.textContent?.trim() ?? '')
}

describe('WorkflowTemplatesView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['workflow.template.read', 'workflow.template.write'])

    vi.mocked(listWorkflowTemplates).mockResolvedValue(okPage([
      {
        id: 'tpl-1',
        name: 'existing-workflow',
        status: 'draft',
        currentVersionId: 'wftplv_05ec5c37-18b6-4687-bc90-26e143ebcf62',
        currentVersion: 1,
        currentVersionLabel: 'V1',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
    ]))
    vi.mocked(listWorkflowFileTemplates).mockResolvedValue({
      data: {
        items: [
          {
            id: 'apache/apache-8444-cert-switch.json',
            fileName: 'apache-8444-cert-switch.json',
            relativePath: 'apache/apache-8444-cert-switch.json',
            valid: true,
            updatedAt: '2026-07-03T00:00:00.000Z',
            metadata: {
              name: 'apache_8444_cert_switch',
              displayName: 'Apache 8444 证书切换',
            },
            stepCount: 8,
            rollbackCount: 2,
          },
        ],
      },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    vi.mocked(createWorkflowTemplate).mockResolvedValue({ data: { id: 'tpl-blank-1' }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
    vi.mocked(createWorkflowTemplateFromFile).mockResolvedValue({ data: { id: 'tpl-file-1' }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
    vi.mocked(compileWorkflowCanvas).mockResolvedValue({
      data: {
        content: {
          apiVersion: 'gcac.workflow/v1',
          kind: 'CurlSshWorkflow',
          metadata: { name: 'existing-workflow' },
          steps: [{ name: 'manual_1', type: 'manual', instruction: '确认' }],
        },
        issues: [],
        stepNames: {},
      },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    vi.mocked(createWorkflowTemplateVersion).mockResolvedValue({ data: { id: 'ver-2' }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
    vi.mocked(updateCurrentWorkflowTemplateDraftVersion).mockResolvedValue({ data: { id: 'ver-1', templateId: 'tpl-1', version: 1, status: 'draft' }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
    vi.mocked(deleteWorkflowTemplate).mockResolvedValue({ data: { id: 'tpl-1', status: 'disabled' }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
    vi.mocked(createSecret).mockResolvedValue({
      data: { id: 'sec-ssh-1', secretRef: 'secret://password/sec-ssh-1#current' },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    vi.mocked(listSecrets).mockImplementation(async () => okPage(
      vi.mocked(createSecret).mock.calls.map(([payload], index) => ({
        id: `sec-${index + 1}`,
        name: payload.name,
        type: payload.type,
        metadata: payload.metadata,
        createdAt: '2026-07-03T00:00:00.000Z',
      })),
    ))
    vi.mocked(applyWorkflowTemplateFromFile).mockResolvedValue({ data: { id: 'ver-file-2' }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
    vi.mocked(listWorkflowTemplateVersions).mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-1',
            version: '1',
            status: 'draft',
            changeSummary: '初始草稿',
            createdAt: '2026-07-03T00:00:00.000Z',
          },
        ],
      },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    vi.mocked(publishWorkflowTemplateVersion).mockResolvedValue({ data: { ok: true }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
  })

  it('支持从工具栏模板管理新建工作流，并移除旧页头与指标区', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    const toolbarButtons = [...document.body.querySelectorAll('.business-page__toolbar-actions button')].map((item) => item.textContent?.trim())
    expect(toolbarButtons).toEqual(['模板管理', '凭据管理', '空白新建', '刷新'])
    expect(document.body.textContent).not.toContain('工作流总数')
    expect(document.body.textContent).not.toContain('待发布草稿')
    expect(document.body.textContent).not.toContain('按画布草稿管理 CURL/SSH/SFTP 工作流版本、发布状态与变更记录。')
    expect(document.body.textContent).not.toContain('文件模板库')
    expect(document.body.textContent).not.toContain('高危操作需确认')
    expect(document.body.textContent).not.toContain('wftplv_05ec5c37-18b6-4687-bc90-26e143ebcf62')
    expect(document.body.textContent).toContain('V1')

    clickBodyButton('模板管理')
    await flushPromises()
    clickBodyButton('按模板创建工作流')
    await flushPromises()

    expect(listWorkflowFileTemplates).toHaveBeenCalled()
    expect(createWorkflowTemplateFromFile).toHaveBeenCalledWith(expect.objectContaining({
      fileTemplateId: 'apache/apache-8444-cert-switch.json',
    }))
  })

  it('支持用 data/workflows 文件模板覆盖现有工作流', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('套用模板')
    await flushPromises()
    clickBodyButton('按模板覆盖当前工作流')
    await flushPromises()

    expect(applyWorkflowTemplateFromFile).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'tpl-1',
      fileTemplateId: 'apache/apache-8444-cert-switch.json',
    }))
  })

  it('没有草稿版本的工作流记录不显示编辑按钮', async () => {
    vi.mocked(listWorkflowTemplates).mockResolvedValue(okPage([
      {
        id: 'tpl-1',
        name: 'existing-workflow',
        status: 'published',
        currentVersionId: 'ver-1',
        currentVersion: 1,
        currentVersionLabel: 'V1',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
    ]))
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    const buttons = [...document.body.querySelectorAll('button')].map((item) => item.textContent?.trim())
    expect(buttons).not.toContain('编辑')
    expect(buttons).toContain('版本管理')
  })

  it('编辑器保存草稿只更新当前草稿版本，不创建新版本', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('编辑')
    await flushPromises()
    clickBodyButton('保存草稿')
    await flushPromises()

    expect(updateCurrentWorkflowTemplateDraftVersion).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'tpl-1',
      changeSummary: '画布编辑器保存草稿版本',
    }))
    expect(createWorkflowTemplateVersion).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('当前草稿版本已更新。')
  })

  it('通过版本管理模态框新增版本和发布版本', async () => {
    vi.mocked(listWorkflowTemplates).mockResolvedValue(okPage([
      {
        id: 'tpl-1',
        name: 'existing-workflow',
        status: 'draft',
        currentVersionId: 'ver-2',
        currentVersion: 2,
        currentVersionLabel: 'V2',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
    ]))
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    const buttonsBeforeOpen = [...document.body.querySelectorAll('button')].map((item) => item.textContent?.trim())
    expect(buttonsBeforeOpen).toContain('版本管理')
    expect(buttonsBeforeOpen).not.toContain('新增版本')
    clickBodyButton('版本管理')
    await flushPromises()

    expect(document.body.textContent).toContain('版本管理：existing-workflow')
    expect(listWorkflowTemplateVersions).toHaveBeenCalledWith('tpl-1')

    clickBodyButton('新增版本')
    await flushPromises()

    expect(createWorkflowTemplateVersion).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'tpl-1',
      changeSummary: '版本管理创建新版本草稿',
    }))

    clickBodyButton('发布版本')
    await flushPromises()

    expect(publishWorkflowTemplateVersion).toHaveBeenCalledWith('ver-1')
    expect(listWorkflowTemplates).toHaveBeenCalledTimes(3)
  })

  it('版本管理中只有当前草稿版本时显示发布版本', async () => {
    vi.mocked(listWorkflowTemplates).mockResolvedValue(okPage([
      {
        id: 'tpl-1',
        name: 'existing-workflow',
        status: 'draft',
        currentVersionId: 'ver-1',
        currentVersion: 1,
        currentVersionLabel: 'V1',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-06T12:34:56.000Z',
      },
    ]))
    vi.mocked(listWorkflowTemplateVersions).mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-1',
            templateId: 'tpl-1',
            version: '1',
            status: 'draft',
            changeSummary: '画布编辑器保存草稿版本',
            createdAt: '2026-07-06T12:34:56.000Z',
          },
        ],
      },
      requestId: 'req_versions',
      timestamp: '2026-07-06T12:34:56.000Z',
    })
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('版本管理')
    await flushPromises()

    const versionItems = [...document.body.querySelectorAll('.workflow-template-detail__list-item')]
    const draftCurrentItem = versionItems.find((item) => item.textContent?.includes('V1'))
    expect(versionStatusTexts(draftCurrentItem)).toEqual(['草稿', '当前版本'])
    expect([...draftCurrentItem?.querySelectorAll('button') ?? []].map((item) => item.textContent?.trim())).toContain('发布版本')
  })

  it('版本管理中当前版本不显示动作，已发布非当前版本显示切换版本', async () => {
    vi.mocked(listWorkflowTemplates).mockResolvedValue(okPage([
      {
        id: 'tpl-1',
        name: 'existing-workflow',
        status: 'published',
        currentVersionId: 'ver-2',
        currentVersion: 2,
        currentVersionLabel: 'V2',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-06T09:01:49.000Z',
      },
    ]))
    vi.mocked(listWorkflowTemplateVersions).mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-1',
            version: '1',
            status: 'published',
            changeSummary: '初始版本',
            createdAt: '2026-07-03T00:00:00.000Z',
          },
          {
            id: 'ver-2',
            version: '2',
            status: 'published',
            changeSummary: '覆盖版本',
            createdAt: '2026-07-06T09:01:49.000Z',
          },
        ],
      },
      requestId: 'req_versions',
      timestamp: '2026-07-06T09:01:49.000Z',
    })
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('版本管理')
    await flushPromises()

    const versionItems = [...document.body.querySelectorAll('.workflow-template-detail__list-item')]
    const currentItem = versionItems.find((item) => item.textContent?.includes('V2'))
    expect(versionStatusTexts(currentItem)).toEqual(['已发布', '当前版本'])
    expect(versionStatusTexts(currentItem)).not.toContain('draft')
    expect(versionStatusTexts(currentItem)).not.toContain('草稿')
    expect([...currentItem?.querySelectorAll('button') ?? []].map((item) => item.textContent?.trim())).not.toContain('发布版本')
    expect([...currentItem?.querySelectorAll('button') ?? []].map((item) => item.textContent?.trim())).not.toContain('切换版本')
    const publishedItem = versionItems.find((item) => item.textContent?.includes('V1'))
    expect(versionStatusTexts(publishedItem)).toEqual(['已发布'])
    expect([...publishedItem?.querySelectorAll('button') ?? []].map((item) => item.textContent?.trim())).toContain('切换版本')
  })

  it('发布草稿版本后立即切换当前版本，并保留已发布状态', async () => {
    vi.mocked(listWorkflowTemplates).mockResolvedValue(okPage([
      {
        id: 'tpl-1',
        name: 'existing-workflow',
        status: 'draft',
        currentVersionId: 'ver-1',
        currentVersion: 1,
        currentVersionLabel: 'V1',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-06T09:01:49.000Z',
      },
    ]))
    vi.mocked(listWorkflowTemplateVersions).mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-1',
            templateId: 'tpl-1',
            version: '1',
            status: 'published',
            changeSummary: '初始版本',
            createdAt: '2026-07-03T00:00:00.000Z',
          },
          {
            id: 'ver-2',
            templateId: 'tpl-1',
            version: '2',
            status: 'draft',
            changeSummary: '覆盖版本',
            createdAt: '2026-07-06T09:01:49.000Z',
          },
        ],
      },
      requestId: 'req_versions',
      timestamp: '2026-07-06T09:01:49.000Z',
    })
    vi.mocked(publishWorkflowTemplateVersion).mockResolvedValueOnce({
      data: {
        id: 'ver-2',
        templateId: 'tpl-1',
        version: 2,
        status: 'published',
      },
      requestId: 'req_publish',
      timestamp: '2026-07-06T09:01:49.000Z',
    })
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('版本管理')
    await flushPromises()
    const beforeItems = [...document.body.querySelectorAll('.workflow-template-detail__list-item')]
    expect(versionStatusTexts(beforeItems.find((item) => item.textContent?.includes('V1')))).toEqual(['已发布', '当前版本'])

    const v2PublishButton = [...beforeItems.find((item) => item.textContent?.includes('V2'))?.querySelectorAll('button') ?? []]
      .find((item) => item.textContent?.trim() === '发布版本') as HTMLButtonElement | undefined
    expect(v2PublishButton).toBeTruthy()
    v2PublishButton!.click()
    await flushPromises()

    const afterItems = [...document.body.querySelectorAll('.workflow-template-detail__list-item')]
    const v1Item = afterItems.find((item) => item.textContent?.includes('V1'))
    const v2Item = afterItems.find((item) => item.textContent?.includes('V2'))
    expect(versionStatusTexts(v2Item)).toEqual(['已发布', '当前版本'])
    expect([...v2Item?.querySelectorAll('button') ?? []].map((item) => item.textContent?.trim())).not.toContain('发布版本')
    expect(versionStatusTexts(v1Item)).toEqual(['已发布'])
    expect([...v1Item?.querySelectorAll('button') ?? []].map((item) => item.textContent?.trim())).toContain('切换版本')
  })

  it('新增草稿版本后当前版本指向新草稿，并同时显示草稿和当前版本', async () => {
    vi.mocked(listWorkflowTemplates).mockResolvedValue(okPage([
      {
        id: 'tpl-1',
        name: 'existing-workflow',
        status: 'published',
        currentVersionId: 'ver-2',
        currentVersion: 2,
        currentVersionLabel: 'V2',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-06T09:01:49.000Z',
      },
    ]))
    vi.mocked(listWorkflowTemplateVersions)
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'ver-1',
              templateId: 'tpl-1',
              version: '1',
              status: 'published',
              changeSummary: '初始版本',
              createdAt: '2026-07-03T00:00:00.000Z',
            },
            {
              id: 'ver-2',
              templateId: 'tpl-1',
              version: '2',
              status: 'published',
              changeSummary: '覆盖版本',
              createdAt: '2026-07-06T09:01:49.000Z',
            },
          ],
        },
        requestId: 'req_versions_1',
        timestamp: '2026-07-06T09:01:49.000Z',
      })
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: 'ver-1',
              templateId: 'tpl-1',
              version: '1',
              status: 'published',
              changeSummary: '初始版本',
              createdAt: '2026-07-03T00:00:00.000Z',
            },
            {
              id: 'ver-2',
              templateId: 'tpl-1',
              version: '2',
              status: 'published',
              changeSummary: '覆盖版本',
              createdAt: '2026-07-06T09:01:49.000Z',
            },
            {
              id: 'ver-3',
              templateId: 'tpl-1',
              version: '3',
              status: 'draft',
              changeSummary: '版本管理创建新版本草稿',
              createdAt: '2026-07-06T11:30:22.000Z',
            },
          ],
        },
        requestId: 'req_versions_2',
        timestamp: '2026-07-06T11:30:22.000Z',
      })
    vi.mocked(createWorkflowTemplateVersion).mockResolvedValueOnce({
      data: {
        id: 'ver-3',
        templateId: 'tpl-1',
        version: 3,
        status: 'draft',
        changeSummary: '版本管理创建新版本草稿',
        createdAt: '2026-07-06T11:30:22.000Z',
      },
      requestId: 'req_create_version',
      timestamp: '2026-07-06T11:30:22.000Z',
    })
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('版本管理')
    await flushPromises()
    clickBodyButton('新增版本')
    await flushPromises()

    expect(document.body.textContent).toContain('当前工作流版本V3')
    expect(document.body.textContent).not.toContain('V4')
    const versionItems = [...document.body.querySelectorAll('.workflow-template-detail__list-item')]
    const draftCurrentItem = versionItems.find((item) => item.textContent?.includes('V3'))
    expect(versionStatusTexts(draftCurrentItem)).toEqual(['草稿', '当前版本'])
    expect([...draftCurrentItem?.querySelectorAll('button') ?? []].map((item) => item.textContent?.trim())).toContain('发布版本')
  })

  it('支持二次确认后删除工作流记录并刷新列表', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('删除')
    await flushPromises()
    const confirmInput = document.body.querySelector('.gc-confirm input') as HTMLInputElement | null
    expect(confirmInput).toBeTruthy()
    confirmInput!.value = 'DELETE'
    confirmInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const confirmButton = document.body.querySelector('.gc-confirm footer .gc-button--danger') as HTMLButtonElement | null
    expect(confirmButton).toBeTruthy()
    confirmButton!.click()
    await flushPromises()

    expect(deleteWorkflowTemplate).toHaveBeenCalledWith('tpl-1')
    expect(listWorkflowTemplates).toHaveBeenCalledTimes(2)
  })

  it('支持创建通用用户名密码凭据并以紧凑布局展示', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('凭据管理')
    await flushPromises()

    const nameInput = document.body.querySelector('input[placeholder="edge-01 root"]') as HTMLInputElement
    const usernameInput = document.body.querySelector('input[placeholder="root"]') as HTMLInputElement
    expect(document.body.textContent).not.toContain('作用域')
    const secretInput = document.body.querySelector('input[type="password"][placeholder="输入登录密码"]') as HTMLInputElement
    nameInput.value = 'edge-01 root'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    usernameInput.value = 'deploy'
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }))
    secretInput.value = 'secret-password'
    secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).not.toContain('secret-password')

    clickBodyButton('创建凭据')
    await flushPromises()

    expect(createSecret).toHaveBeenCalledWith(expect.objectContaining({
      name: 'edge-01 root',
      type: 'password',
      scopeType: 'global',
      plainText: 'secret-password',
      metadata: expect.objectContaining({
        workflowCredential: true,
        workflowCredentialKind: 'username_password',
        username: 'deploy',
      }),
    }))
    expect(document.body.textContent).toContain('edge-01 root')
    expect(document.body.textContent).toContain('用户名 + 密码 / deploy')
    expect(document.body.textContent).toContain('SSH / HTTP Basic')
    expect(document.body.textContent).not.toContain('复制连接片段')
    expect(document.body.textContent).not.toContain('复制 SecretRef')
  })

  it('SSH 私钥输入保留多行能力但默认密文显示', async () => {
    vi.mocked(createSecret).mockResolvedValueOnce({
      data: { id: 'sec-ssh-key-1', secretRef: 'secret://ssh_key/sec-ssh-key-1#current' },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('凭据管理')
    await flushPromises()

    const nameInput = document.body.querySelector('input[placeholder="edge-01 root"]') as HTMLInputElement
    nameInput.value = 'edge ssh key'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    clickBodyButtonContaining('SSH 私钥')
    await flushPromises()

    const secretInput = document.body.querySelector('textarea[placeholder="粘贴 PEM 格式私钥"]') as HTMLTextAreaElement
    expect(secretInput.classList.contains('credential-manager__secret-control--masked')).toBe(true)
    secretInput.value = '-----BEGIN PRIVATE KEY-----\nsecret-key-body\n-----END PRIVATE KEY-----'
    secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).not.toContain('secret-key-body')

    clickBodyButton('创建凭据')
    await flushPromises()

    expect(createSecret).toHaveBeenCalledWith(expect.objectContaining({
      name: 'edge ssh key',
      type: 'ssh_key',
      plainText: '-----BEGIN PRIVATE KEY-----\nsecret-key-body\n-----END PRIVATE KEY-----',
      metadata: expect.objectContaining({
        workflowCredential: true,
        workflowCredentialKind: 'ssh_key',
        username: 'root',
      }),
    }))
  })

  it('支持创建 CURL Bearer Token 凭据', async () => {
    vi.mocked(createSecret).mockResolvedValueOnce({
      data: { id: 'sec-curl-1', secretRef: 'secret://api_token/sec-curl-1#current' },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('凭据管理')
    await flushPromises()

    const nameInput = document.body.querySelector('input[placeholder="edge-01 root"]') as HTMLInputElement
    nameInput.value = 'curl prod api'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    clickBodyButtonContaining('CURL Bearer')
    await flushPromises()
    const secretInput = document.body.querySelector('input[type="password"][placeholder="输入 Bearer Token"]') as HTMLInputElement
    secretInput.value = 'bearer-token'
    secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).not.toContain('bearer-token')

    clickBodyButton('创建凭据')
    await flushPromises()

    expect(createSecret).toHaveBeenCalledWith(expect.objectContaining({
      name: 'curl prod api',
      type: 'api_token',
      scopeType: 'global',
      plainText: 'bearer-token',
      metadata: expect.objectContaining({
        workflowCredential: true,
        workflowCredentialKind: 'curl_bearer',
      }),
    }))
    expect(document.body.textContent).toContain('curl prod api')
    expect(document.body.textContent).toContain('Bearer Token')
  })

  it('支持创建 CURL API Key 凭据并展示基本信息', async () => {
    vi.mocked(createSecret).mockResolvedValueOnce({
      data: { id: 'sec-api-key-1', secretRef: 'secret://api_token/sec-api-key-1#current' },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('凭据管理')
    await flushPromises()

    const nameInput = document.body.querySelector('input[placeholder="edge-01 root"]') as HTMLInputElement
    nameInput.value = 'curl api key'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    clickBodyButtonContaining('CURL API Key')
    await flushPromises()

    const keyNameInput = document.body.querySelector('input[placeholder="X-API-Key"]') as HTMLInputElement
    const secretInput = document.body.querySelector('input[type="password"][placeholder="输入 API Key"]') as HTMLInputElement
    keyNameInput.value = 'api_key'
    keyNameInput.dispatchEvent(new Event('input', { bubbles: true }))
    clickBodyButton('Query')
    secretInput.value = 'api-key-secret'
    secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).not.toContain('api-key-secret')

    clickBodyButton('创建凭据')
    await flushPromises()

    expect(createSecret).toHaveBeenCalledWith(expect.objectContaining({
      name: 'curl api key',
      type: 'api_token',
      scopeType: 'global',
      plainText: 'api-key-secret',
      metadata: expect.objectContaining({
        workflowCredential: true,
        workflowCredentialKind: 'curl_api_key',
        apiKeyName: 'api_key',
        apiKeyIn: 'query',
      }),
    }))
    expect(document.body.textContent).toContain('curl api key')
    expect(document.body.textContent).toContain('API Key / api_key / Query')
  })
})
