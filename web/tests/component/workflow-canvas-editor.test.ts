import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { testWorkflowTemplateStep } from '@/api/modules/workflow-templates.api'
import WorkflowCanvasEditor from '@/views/workflows/WorkflowCanvasEditor.vue'
import { createDefaultWorkflowCanvas } from '@/views/workflows/workflow-canvas.model'

vi.mock('@/api/modules/workflow-templates.api', () => ({
  testWorkflowTemplateStep: vi.fn(),
}))

describe('WorkflowCanvasEditor', () => {
  beforeEach(() => {
    vi.mocked(testWorkflowTemplateStep).mockReset()
  })

  it('渲染节点库、画布、属性面板、变量面板和校验面板', () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    expect(wrapper.text()).toContain('节点库')
    expect(wrapper.text()).toContain('保存草稿')
    expect(wrapper.text()).toContain('属性面板')
    expect(wrapper.text()).toContain('校验')
    expect(wrapper.find('[aria-label="变量面板"]').exists()).toBe(false)
  })

  it('底部控制面板支持向下折叠并通过 tab 自动展开', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    expect(wrapper.find('.workflow-canvas-editor__bottom').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[aria-label="校验面板"]').exists()).toBe(true)

    await wrapper.findAll('button').find((button) => button.text() === '向下折叠')!.trigger('click')

    expect(wrapper.find('.workflow-canvas-editor__bottom').classes()).toContain('workflow-canvas-editor__bottom--collapsed')
    expect(wrapper.find('.workflow-canvas-editor__bottom').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[aria-label="校验面板"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('展开面板')

    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === '变量')!.trigger('click')

    expect(wrapper.find('.workflow-canvas-editor__bottom').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[aria-label="变量面板"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('向下折叠')
  })

  it('支持添加、复制、粘贴和删除节点', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    await wrapper.findAll('.workflow-canvas-editor__palette-item').find((button) => button.text().includes('等待'))!.trigger('click')
    const afterAdd = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(afterAdd.nodes.some((node) => node.type === 'wait')).toBe(true)

    await wrapper.setProps({ modelValue: afterAdd })
    await wrapper.findAll('button').find((button) => button.text() === '复制')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '粘贴')!.trigger('click')
    const afterPaste = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(afterPaste.nodes.length).toBe(afterAdd.nodes.length + 1)

    await wrapper.setProps({ modelValue: afterPaste })
    await wrapper.findAll('button').find((button) => button.text() === '删除')!.trigger('click')
    const afterDelete = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(afterDelete.nodes.length).toBe(afterPaste.nodes.length - 1)
  })

  it('按阶段新增节点并自动生成流程线，保存 DSL 草稿', async () => {
    const onSave = vi.fn()
    const canvas = createDefaultWorkflowCanvas()
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: canvas, onSave },
    })

    await wrapper.find('.workflow-canvas-editor__stage-picker select').setValue('verify')
    await wrapper.findAll('.workflow-canvas-editor__palette-item').find((button) => button.text().includes('等待'))!.trigger('click')

    const afterAdd = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(afterAdd.nodes.at(-1)?.ui?.stage).toBe('verify')
    expect(afterAdd.edges).toHaveLength(afterAdd.nodes.length - 1)

    await wrapper.setProps({ modelValue: afterAdd })
    await wrapper.findAll('button').find((button) => button.text() === '保存草稿')!.trigger('click')

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      canvas: expect.objectContaining({ schemaVersion: 'gcac.workflow.canvas/v1' }),
      dsl: expect.objectContaining({ apiVersion: 'gcac.workflow/v1' }),
    }))
  })

  it('支持对当前节点发起单节点模拟运行并展示结果', async () => {
    vi.mocked(testWorkflowTemplateStep).mockResolvedValue({
      data: {
        id: 'wfstep_1',
        mode: 'mock',
        plannedOnly: false,
        renderedStep: { name: 'http_1_HTTP_CURL', type: 'http', preview: { executor: '017.CURL_HTTP' } },
        stepResult: { name: 'http_1_HTTP_CURL', type: 'http', status: 'success', attempts: 1, plan: { executor: '017.CURL_HTTP' }, logs: ['step:http_1_HTTP_CURL:attempt:1:status:success'] },
        logs: ['step:http_1_HTTP_CURL:attempt:1:status:success'],
      },
      requestId: 'req_step_test',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    await wrapper.findAll('button').find((button) => button.text() === '模拟运行当前节点')!.trigger('click')
    await flushPromises()

    expect(testWorkflowTemplateStep).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'mock',
      stepName: expect.stringContaining('http_'),
      content: expect.objectContaining({ apiVersion: 'gcac.workflow/v1' }),
      userVariables: expect.objectContaining({ deviceHost: 'mock-device.local' }),
    }))
    expect(wrapper.text()).toContain('模拟完成：success')
    expect(wrapper.text()).toContain('017.CURL_HTTP')
  })

  it('单节点模拟运行会优先带入变量默认值和枚举值', async () => {
    vi.mocked(testWorkflowTemplateStep).mockResolvedValue({
      data: {
        id: 'wfstep_2',
        mode: 'mock',
        plannedOnly: false,
        renderedStep: { name: 'http_1_HTTP_CURL', type: 'http' },
        stepResult: { name: 'http_1_HTTP_CURL', type: 'http', status: 'success', attempts: 1, logs: [] },
        logs: [],
      },
      requestId: 'req_step_test_enum',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    const canvas = createDefaultWorkflowCanvas()
    const wrapper = mount(WorkflowCanvasEditor, {
      props: {
        modelValue: {
          ...canvas,
          variables: {
            ...canvas.variables,
            targetPlatform: {
              type: 'enum',
              required: true,
              default: 'linux',
              enum: ['linux'],
              description: '目标平台',
            },
          },
        },
      },
    })

    await wrapper.findAll('button').find((button) => button.text() === '模拟运行当前节点')!.trigger('click')
    await flushPromises()

    expect(testWorkflowTemplateStep).toHaveBeenCalledWith(expect.objectContaining({
      userVariables: expect.objectContaining({
        targetPlatform: 'linux',
      }),
    }))
  })

  it('支持对当前 SSH 节点发起真实试跑并带入运行时变量和 SecretRef 映射', async () => {
    vi.mocked(testWorkflowTemplateStep).mockResolvedValue({
      data: {
        id: 'wfstep_3',
        mode: 'real_test',
        plannedOnly: false,
        renderedStep: { name: 'ssh_3_SSH_COMMAND', type: 'ssh', preview: { executor: '015.SSH' } },
        stepResult: { name: 'ssh_3_SSH_COMMAND', type: 'ssh', status: 'success', attempts: 1, plan: { executor: '015.SSH' }, logs: ['ssh:mode:real_ssh'] },
        stepOutput: { stdout: 'real ssh ok', stderr: '', exitCode: 0 },
        logs: ['ssh:stdout:real ssh ok'],
      },
      requestId: 'req_step_test_real',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    await wrapper.findAll('.workflow-canvas-editor__node').find((node) => node.attributes('data-node-type') === 'ssh')!.trigger('click')
    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === '运行态')!.trigger('click')

    const runtimeLabels = wrapper.findAll('.workflow-canvas-editor__runtime-form label')
    await runtimeLabels.find((label) => label.text().includes('deviceHost'))!.find('input').setValue('edge-01.example.com')
    await runtimeLabels.find((label) => label.text().includes('sshUsername'))!.find('input').setValue('deploy')
    await runtimeLabels.find((label) => label.text().includes('secret://workflow/ssh'))!.find('input').setValue('secret://password/sec_real#current')

    await wrapper.findAll('button').find((button) => button.text() === '真实试跑当前节点')!.trigger('click')
    await flushPromises()

    const payload = vi.mocked(testWorkflowTemplateStep).mock.calls[0]?.[0] as Record<string, any>
    expect(payload.mode).toBe('real_test')
    expect(payload.userVariables).toEqual(expect.objectContaining({
      deviceHost: 'edge-01.example.com',
      sshUsername: 'deploy',
    }))
    expect(payload.secretRefs).toEqual({
      'secret://workflow/ssh': 'secret://password/sec_real#current',
    })
    const sshStep = payload.content.steps.find((step: Record<string, any>) => step.type === 'ssh')
    expect(sshStep?.ssh?.connection?.credentialSecretRef).toBe('secret://password/sec_real#current')
    expect(wrapper.text()).toContain('真实试跑完成：success')
    expect(wrapper.text()).toContain('real ssh ok')
  })

  it('变量面板支持新增运行变量配置', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === '变量')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '添加变量')!.trigger('click')

    const updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(updated.variables.variable6).toEqual(expect.objectContaining({
      type: 'string',
      required: false,
      description: '自定义运行变量',
    }))
  })

  it('DSL 面板支持导入 JSON 并覆盖当前画布', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === 'DSL')!.trigger('click')
    const importedDsl = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: {
        name: 'imported_workflow',
        displayName: '导入工作流',
        category: 'deployment',
        tags: ['import'],
      },
      variables: {
        verifyUrl: { type: 'string', required: true, description: '验证 URL' },
      },
      steps: [
        {
          name: 'prepare_auth',
          type: 'http',
          stage: 'prepare',
          request: {
            method: 'POST',
            url: 'https://{{verifyUrl}}/login',
            timeoutSeconds: 30,
          },
          assert: [{ type: 'statusCode', equals: 200 }],
        },
        {
          name: 'verify_result',
          type: 'http',
          stage: 'verify',
          request: {
            method: 'GET',
            url: '{{verifyUrl}}',
            timeoutSeconds: 20,
          },
          assert: [{ type: 'statusCode', equals: 200 }],
        },
      ],
      rollback: [
        {
          name: 'rollback_manual',
          type: 'manual',
          instruction: '恢复到导入前版本',
        },
      ],
    }

    await wrapper.find('.workflow-canvas-editor__dsl-editor').setValue(JSON.stringify(importedDsl, null, 2))
    await wrapper.findAll('button').find((button) => button.text() === '导入 DSL 覆盖画布')!.trigger('click')

    const updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(updated.metadata.name).toBe('imported_workflow')
    expect(updated.nodes).toHaveLength(2)
    expect(updated.nodes.map((node) => node.ui?.stage)).toEqual(['prepare', 'verify'])
    expect(updated.draftState?.importedRollback).toEqual(importedDsl.rollback)
    expect(wrapper.text()).toContain('DSL 已导入并覆盖当前画布')
  })
})
