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
})
