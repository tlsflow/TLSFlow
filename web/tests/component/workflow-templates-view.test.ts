import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import WorkflowTemplatesView from '@/views/workflows/WorkflowTemplatesView.vue'
import { usePermissionStore } from '@/stores/permission.store'
import {
  compileWorkflowCanvas,
  createWorkflowDraftFromPlugin,
  createWorkflowFromPlugin,
  createWorkflowTemplateVersion,
  deleteWorkflowTemplate,
  listPluginWorkflowSources,
  listWorkflowTemplates,
  listWorkflowTemplateVersions,
  publishWorkflowTemplateVersion,
  renameWorkflowTemplate,
  updateCurrentWorkflowTemplateDraftVersion,
} from '@/api/modules/workflow-templates.api'
import { i18n } from '@/i18n'

vi.mock('@/api/modules/workflow-templates.api', () => ({
  listWorkflowTemplates: vi.fn(),
  listPluginWorkflowSources: vi.fn(),
  createWorkflowFromPlugin: vi.fn(),
  createWorkflowDraftFromPlugin: vi.fn(),
  compileWorkflowCanvas: vi.fn(),
  deleteWorkflowTemplate: vi.fn(),
  listWorkflowTemplateVersions: vi.fn(),
  createWorkflowTemplateVersion: vi.fn(),
  publishWorkflowTemplateVersion: vi.fn(),
  renameWorkflowTemplate: vi.fn(),
  updateCurrentWorkflowTemplateDraftVersion: vi.fn(),
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

function versionStatusTexts(item: Element | undefined): string[] {
  return [...item?.querySelectorAll('.workflow-version-manager__status') ?? []].map((status) => status.textContent?.trim() ?? '')
}

function workflowDslFixture(name = 'existing-workflow') {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: { name },
    inputContract: {
      apiVersion: 'gcac.deployment-input/v1',
      variables: {
        verifyUrl: {
          type: 'string',
          required: true,
          configurationMode: 'required',
          source: { kind: 'binding' },
          lifecycle: 'pre_execution',
          bindingPolicy: 'required_binding',
        },
      },
      connections: {
        management: {
          transport: 'http',
          host: { type: 'string', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
          port: { type: 'number', required: true, configurationMode: 'required', source: { kind: 'binding' }, lifecycle: 'pre_execution', bindingPolicy: 'required_binding' },
        },
      },
      credentials: {},
      artifacts: {},
    },
    steps: [{ name: 'manual_1', type: 'manual', instruction: '确认' }],
  }
}

describe('WorkflowTemplatesView', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['workflow.read', 'workflow.create', 'workflow.update', 'workflow.delete', 'workflow.publish'])
    config.global.plugins = [i18n]

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
    vi.mocked(listPluginWorkflowSources).mockResolvedValue({
      data: {
        items: [
          {
            pluginId: 'builtin.workflow.apache-8444-cert-switch',
            pluginVersionId: 'plugin-version-apache',
            pluginVersion: '1.0.0',
            displayName: 'Apache 8444 证书切换',
            workflowName: 'apache-8444-cert-switch',
            workflowDisplayName: 'Apache 8444 证书切换',
            workflowResourcePath: 'workflows/deploy.json',
            capabilityKey: 'certificate.deploy',
            workflowTemplateId: 'plugin-workflow-apache',
            workflowVersionId: 'plugin-workflow-version-apache',
            stepCount: 8,
            rollbackCount: 2,
          },
        ],
      },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    vi.mocked(createWorkflowFromPlugin).mockResolvedValue({ data: { id: 'tpl-plugin-1' }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
    vi.mocked(renameWorkflowTemplate).mockResolvedValue({
      data: {
        id: 'tpl-1',
        name: 'renamed-workflow',
        status: 'draft',
        currentVersionId: 'wftplv_05ec5c37-18b6-4687-bc90-26e143ebcf62',
        currentVersion: 1,
        currentVersionLabel: 'V1',
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:00.000Z',
      },
      requestId: 'req_ok',
      timestamp: '2026-07-22T00:00:00.000Z',
    })
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
    vi.mocked(createWorkflowDraftFromPlugin).mockResolvedValue({ data: { id: 'ver-plugin-2' }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
    vi.mocked(listWorkflowTemplateVersions).mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-1',
            version: '1',
            status: 'draft',
            changeSummary: '初始草稿',
            createdAt: '2026-07-03T00:00:00.000Z',
            content: workflowDslFixture(),
          },
        ],
      },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    vi.mocked(publishWorkflowTemplateVersion).mockResolvedValue({ data: { ok: true }, requestId: 'req_ok', timestamp: '2026-07-03T00:00:00.000Z' })
  })

  it('支持从工具栏插件来源新建工作流，并移除文件模板入口', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()
    const initialLoadCalls = vi.mocked(listWorkflowTemplates).mock.calls.length

    const toolbarButtons = [...document.body.querySelectorAll('.business-page__toolbar-actions button')].map((item) => item.textContent?.trim())
    expect(toolbarButtons).toEqual(['从插件新建工作流', '刷新'])
    expect(document.body.textContent).not.toContain('工作流总数')
    expect(document.body.textContent).not.toContain('待发布草稿')
    expect(document.body.textContent).not.toContain('按画布草稿管理 CURL/SSH/SFTP 工作流版本、发布状态与变更记录。')
    expect(document.body.textContent).not.toContain('文件模板库')
    expect(document.body.textContent).not.toContain('高危操作需确认')
    expect(document.body.textContent).not.toContain('wftplv_05ec5c37-18b6-4687-bc90-26e143ebcf62')
    expect(document.body.textContent).toContain('V1')

    clickBodyButton('从插件新建工作流')
    await flushPromises()
    ;(document.body.querySelector('.gc-plugin-workflow-source-selector__workflow-head') as HTMLButtonElement | null)?.click()
    await flushPromises()
    ;(document.body.querySelector('.gc-plugin-workflow-source-selector__version-copy') as HTMLButtonElement | null)?.click()
    await flushPromises()
    const nameInput = document.body.querySelector('.workflow-file-template-modal__field input') as HTMLInputElement
    expect(nameInput.value).toBe('apache-8444-cert-switch')
    clickBodyButton('创建工作流')
    await flushPromises()

    expect(listPluginWorkflowSources).toHaveBeenCalled()
    expect(createWorkflowFromPlugin).toHaveBeenCalledWith(expect.objectContaining({
      pluginVersionId: 'plugin-version-apache',
      capabilityKey: 'certificate.deploy',
      name: 'apache-8444-cert-switch',
    }))
    expect(vi.mocked(listWorkflowTemplates).mock.calls.length).toBe(initialLoadCalls)
  })

  it('支持从插件来源为现有工作流生成新草稿', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()
    const initialLoadCalls = vi.mocked(listWorkflowTemplates).mock.calls.length

    clickBodyButton('生成草稿')
    await flushPromises()
    ;(document.body.querySelector('.gc-plugin-workflow-source-selector__workflow-head') as HTMLButtonElement | null)?.click()
    await flushPromises()
    ;(document.body.querySelector('.gc-plugin-workflow-source-selector__version-copy') as HTMLButtonElement | null)?.click()
    await flushPromises()
    const submitButtons = [...document.body.querySelectorAll('button')].filter((item) => item.textContent?.trim() === '生成草稿') as HTMLButtonElement[]
    expect(submitButtons.length).toBeGreaterThan(1)
    submitButtons.at(-1)!.click()
    await flushPromises()

    expect(createWorkflowDraftFromPlugin).toHaveBeenCalledWith('tpl-1', expect.objectContaining({
      pluginVersionId: 'plugin-version-apache',
      capabilityKey: 'certificate.deploy',
    }))
    expect(vi.mocked(listWorkflowTemplates).mock.calls.length).toBe(initialLoadCalls)
  })

  it('插件内部工作流不显示从插件生成草稿入口', async () => {
    vi.mocked(listWorkflowTemplates).mockResolvedValueOnce(okPage([
      {
        id: 'plugin-internal-workflow',
        name: 'apache-8444-cert-switch',
        origin: 'PLUGIN_INTERNAL',
        status: 'published',
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

    expect(document.body.textContent).not.toContain('生成草稿')
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

  it('支持在详情页面修改工作流名称', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('详情')
    await flushPromises()
    clickBodyButton('修改名称')
    await flushPromises()

    const input = document.body.querySelector('input[placeholder="请输入工作流名称"]') as HTMLInputElement
    expect(input).toBeTruthy()
    input.value = '  renamed-workflow  '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    clickBodyButton('保存名称')
    await flushPromises()

    expect(renameWorkflowTemplate).toHaveBeenCalledWith('tpl-1', 'renamed-workflow')
    expect(document.body.textContent).toContain('工作流名称已更新。')
    expect(document.body.textContent).toContain('renamed-workflow')
    expect(listWorkflowTemplates).toHaveBeenCalledTimes(2)
  })

  it('详情版本列表不会因旧 DSL 无法转换画布而加载失败', async () => {
    vi.mocked(listWorkflowTemplateVersions).mockResolvedValueOnce({
      data: {
        items: [{
          id: 'ver-legacy',
          version: '1',
          status: 'draft',
          changeSummary: '旧版本草稿',
          createdAt: '2026-07-03T00:00:00.000Z',
          content: {
            apiVersion: 'gcac.workflow/v1',
            kind: 'CurlSshWorkflow',
            metadata: { name: 'legacy-workflow' },
            variables: {},
            steps: [{ name: 'legacy-ssh', type: 'ssh', ssh: { mode: 'command', command: 'reload' } }],
          },
        }],
      },
      requestId: 'req_ok',
      timestamp: '2026-07-22T00:00:00.000Z',
    })
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('详情')
    await flushPromises()
    clickBodyButton('版本')
    await flushPromises()

    expect(document.body.textContent).toContain('旧版本草稿')
    expect(document.body.textContent).not.toContain("Cannot read properties of undefined (reading 'host')")
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
      content: workflowDslFixture(),
      changeSummary: '版本管理创建新版本草稿',
      allowDuplicateContent: true,
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

    const versionItems = [...document.body.querySelectorAll('.workflow-version-manager__item')]
    const draftCurrentItem = versionItems.find((item) => item.textContent?.includes('V1'))
    expect(versionStatusTexts(draftCurrentItem)).toEqual(['草稿'])
    expect(document.body.textContent).toContain('当前版本V1')
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

    const versionItems = [...document.body.querySelectorAll('.workflow-version-manager__item')]
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

  it('插件内置工作流只显示 DSL SemVer 并禁止手动切换版本', async () => {
    vi.mocked(listWorkflowTemplates).mockResolvedValue(okPage([{
      id: 'tpl-plugin-apache',
      name: 'apache-8444-cert-switch',
      origin: 'plugin_internal',
      capabilities: ['certificate.deploy', 'certificate.rollback'],
      status: 'published',
      currentVersionId: 'ver-plugin-126',
      currentVersion: 2,
      currentVersionLabel: '1.2.6',
      createdAt: '2026-07-31T01:36:51.000Z',
      updatedAt: '2026-08-02T22:48:31.000Z',
    }]))
    vi.mocked(listWorkflowTemplateVersions).mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-plugin-126',
            templateId: 'tpl-plugin-apache',
            version: 2,
            status: 'published',
            content: { metadata: { version: '1.2.6' } },
            createdAt: '2026-08-02T22:48:31.000Z',
          },
          {
            id: 'ver-plugin-124',
            templateId: 'tpl-plugin-apache-legacy',
            version: 4,
            status: 'published',
            content: { metadata: { version: '1.2.4' } },
            createdAt: '2026-08-01T21:11:56.000Z',
          },
        ],
      },
      requestId: 'req_versions',
      timestamp: '2026-08-02T22:48:31.000Z',
    })

    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    expect(document.body.textContent).toContain('1.2.6')
    clickBodyButton('详情')
    await flushPromises()
    clickBodyButton('版本')
    await flushPromises()

    const labels = [...document.body.querySelectorAll('.workflow-template-detail__list-head strong')].map((item) => item.textContent?.trim())
    expect(labels).toEqual(['1.2.6', '1.2.4'])
    expect(document.body.textContent).not.toContain('已发布版本：V2')
    expect([...document.body.querySelectorAll('button')].map((item) => item.textContent?.trim())).not.toContain('新增版本')
    expect([...document.body.querySelectorAll('button')].map((item) => item.textContent?.trim())).not.toContain('切换版本')
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
    const beforeItems = [...document.body.querySelectorAll('.workflow-version-manager__item')]
    expect(versionStatusTexts(beforeItems.find((item) => item.textContent?.includes('V1')))).toEqual(['已发布', '当前版本'])

    const v2PublishButton = [...beforeItems.find((item) => item.textContent?.includes('V2'))?.querySelectorAll('button') ?? []]
      .find((item) => item.textContent?.trim() === '发布版本') as HTMLButtonElement | undefined
    expect(v2PublishButton).toBeTruthy()
    v2PublishButton!.click()
    await flushPromises()

    const afterItems = [...document.body.querySelectorAll('.workflow-version-manager__item')]
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
              content: workflowDslFixture(),
            },
            {
              id: 'ver-2',
              templateId: 'tpl-1',
              version: '2',
              status: 'published',
              changeSummary: '覆盖版本',
              createdAt: '2026-07-06T09:01:49.000Z',
              content: workflowDslFixture(),
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
              content: workflowDslFixture(),
            },
            {
              id: 'ver-2',
              templateId: 'tpl-1',
              version: '2',
              status: 'published',
              changeSummary: '覆盖版本',
              createdAt: '2026-07-06T09:01:49.000Z',
              content: workflowDslFixture(),
            },
            {
              id: 'ver-3',
              templateId: 'tpl-1',
              version: '3',
              status: 'draft',
              changeSummary: '版本管理创建新版本草稿',
              createdAt: '2026-07-06T11:30:22.000Z',
              content: workflowDslFixture(),
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

    expect(document.body.textContent).toContain('当前版本V3')
    expect(document.body.textContent).not.toContain('V4')
    const versionItems = [...document.body.querySelectorAll('.workflow-version-manager__item')]
    const draftCurrentItem = versionItems.find((item) => item.textContent?.includes('V3'))
    expect(versionStatusTexts(draftCurrentItem)).toEqual(['草稿'])
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

})
