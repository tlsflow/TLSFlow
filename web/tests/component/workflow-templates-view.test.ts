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

describe('WorkflowTemplatesView', () => {
  beforeEach(() => {
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

  it('支持从 data/workflows 文件模板新建工作流', async () => {
    mount(WorkflowTemplatesView, {
      attachTo: document.body,
      global: { stubs: { teleport: true, Teleport: true } },
    })
    await flushPromises()

    clickBodyButton('从模板新建')
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
})
