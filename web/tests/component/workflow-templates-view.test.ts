import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import WorkflowTemplatesView from '@/views/workflows/WorkflowTemplatesView.vue'
import { usePermissionStore } from '@/stores/permission.store'
import {
  applyWorkflowTemplateFromFile,
  createWorkflowTemplate,
  createWorkflowTemplateFromFile,
  listWorkflowFileTemplates,
  listWorkflowTemplates,
  listWorkflowTemplateVersions,
  publishWorkflowTemplateVersion,
} from '@/api/modules/workflow-templates.api'
import { createSecret } from '@/api/modules/security.api'

vi.mock('@/api/modules/workflow-templates.api', () => ({
  listWorkflowTemplates: vi.fn(),
  listWorkflowFileTemplates: vi.fn(),
  createWorkflowTemplate: vi.fn(),
  createWorkflowTemplateFromFile: vi.fn(),
  applyWorkflowTemplateFromFile: vi.fn(),
  listWorkflowTemplateVersions: vi.fn(),
  createWorkflowTemplateVersion: vi.fn(),
  publishWorkflowTemplateVersion: vi.fn(),
}))

vi.mock('@/api/modules/security.api', () => ({
  createSecret: vi.fn(),
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
        currentVersionId: 'ver-1',
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
    vi.mocked(createSecret).mockResolvedValue({
      data: { id: 'sec-ssh-1', secretRef: 'secret://password/sec-ssh-1#current' },
      requestId: 'req_ok',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
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

  it('支持创建通用用户名密码凭据并生成 SSH/CURL 片段', async () => {
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
    const secretInput = document.body.querySelector('textarea[placeholder="输入登录密码"]') as HTMLTextAreaElement
    nameInput.value = 'edge-01 root'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    usernameInput.value = 'deploy'
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }))
    secretInput.value = 'secret-password'
    secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    clickBodyButton('创建凭据')
    await flushPromises()

    expect(createSecret).toHaveBeenCalledWith(expect.objectContaining({
      name: 'edge-01 root',
      type: 'password',
      scopeType: 'global',
      plainText: 'secret-password',
    }))
    expect(document.body.textContent).toContain('secret://password/sec-ssh-1#current')
    expect(document.body.textContent).toContain('用户名 + 密码')
    expect(document.body.textContent).toContain('SSH connection / CURL request.auth')
    expect(document.body.textContent).toContain('"credentialSecretRef": "secret://password/sec-ssh-1#current"')
    expect(document.body.textContent).toContain('"type": "basic"')
    expect(document.body.textContent).toContain('"username": "deploy"')
    expect(document.body.textContent).not.toContain('"name": "deploy"')
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
    const secretInput = document.body.querySelector('textarea[placeholder="输入 Bearer Token"]') as HTMLTextAreaElement
    secretInput.value = 'bearer-token'
    secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    clickBodyButton('创建凭据')
    await flushPromises()

    expect(createSecret).toHaveBeenCalledWith(expect.objectContaining({
      name: 'curl prod api',
      type: 'api_token',
      scopeType: 'global',
      plainText: 'bearer-token',
    }))
    expect(document.body.textContent).toContain('"type": "bearer"')
    expect(document.body.textContent).toContain('secret://api_token/sec-curl-1#current')
  })

  it('支持创建 CURL API Key 凭据并生成 request.auth 片段', async () => {
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
    const secretInput = document.body.querySelector('textarea[placeholder="输入 API Key"]') as HTMLTextAreaElement
    keyNameInput.value = 'api_key'
    keyNameInput.dispatchEvent(new Event('input', { bubbles: true }))
    clickBodyButton('Query')
    secretInput.value = 'api-key-secret'
    secretInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    clickBodyButton('创建凭据')
    await flushPromises()

    expect(createSecret).toHaveBeenCalledWith(expect.objectContaining({
      name: 'curl api key',
      type: 'api_token',
      scopeType: 'global',
      plainText: 'api-key-secret',
    }))
    expect(document.body.textContent).toContain('"type": "api_key"')
    expect(document.body.textContent).toContain('"name": "api_key"')
    expect(document.body.textContent).toContain('"in": "query"')
  })
})
