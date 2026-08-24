import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { GcExecutionModeSelector, GcPluginWorkflowSourceSelector, GcWorkflowExecutionForm } from '@/design-system/components'

describe('Spec 033.5 执行来源组件', () => {
  it('执行模式选择只发出单一模式', async () => {
    const wrapper = mount(GcExecutionModeSelector, {
      props: {
        modelValue: 'PLUGIN',
        label: 'mode',
        options: [
          { value: 'PLUGIN', label: 'plugin', description: 'plugin mode', tone: 'info' },
          { value: 'WORKFLOW_OVERRIDE', label: 'workflow', description: 'workflow mode', tone: 'warning' },
        ],
      },
    })
    await wrapper.find('input[value="WORKFLOW_OVERRIDE"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([['WORKFLOW_OVERRIDE']])
  })

  it('工作流执行表单按版本策略隐藏固定版本', async () => {
    const wrapper = mount(GcWorkflowExecutionForm, {
      props: {
        workflowId: 'workflow-1', versionSelection: 'LATEST_PUBLISHED', workflowVersionId: '', runner: 'CONTROL_PLANE', gatewayId: '',
        workflows: [{ id: 'workflow-1', name: 'workflow' }], versions: [{ id: 'version-1', version: 1 }], gateways: [],
        labels: { workflow: 'workflow', workflowPlaceholder: 'select', versionSelection: 'selection', pinned: 'pinned', latestPublished: 'latest', version: 'version', versionPlaceholder: 'select version', runner: 'runner', controlPlane: 'control', gateway: 'gateway', gatewayPlaceholder: 'select gateway' },
      },
    })
    expect(wrapper.find('option[value="version-1"]').exists()).toBe(false)
    await wrapper.findAll('select')[1]!.setValue('PINNED')
    expect(wrapper.emitted('update:versionSelection')).toEqual([['PINNED']])
  })

  it('插件来源选择合并同一版本，并返回插件版本与能力组合键', async () => {
    const wrapper = mount(GcPluginWorkflowSourceSelector, {
      props: {
        modelValue: '',
        items: [
          { pluginVersionId: 'plugin-version-1', pluginVersion: '1.0.0', displayName: 'plugin', capabilityKey: 'certificate.deploy' },
          { pluginVersionId: 'plugin-version-1', pluginVersion: '1.0.0', displayName: 'plugin', capabilityKey: 'certificate.rollback' },
        ],
        labels: { loading: 'loading', empty: 'empty', deploy: 'deploy', rollback: 'rollback', version: 'version', workflowVersion: 'workflow version' },
      },
    })
    expect(wrapper.findAll('.gc-plugin-workflow-source-selector__item')).toHaveLength(1)
    expect(wrapper.findAll('input')).toHaveLength(2)
    await wrapper.find('input[value="plugin-version-1:certificate.deploy"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([['plugin-version-1:certificate.deploy']])
    await wrapper.find('input[value="plugin-version-1:certificate.rollback"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['plugin-version-1:certificate.deploy'],
      ['plugin-version-1:certificate.rollback'],
    ])
  })
})
