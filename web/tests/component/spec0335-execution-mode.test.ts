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

  it('插件来源选择先按工作流合并，再按版本选择具体来源', async () => {
    const wrapper = mount(GcPluginWorkflowSourceSelector, {
      props: {
        modelValue: '',
        items: [
          { pluginId: 'builtin.workflow.apache', workflowResourcePath: 'workflows/deploy.json', workflowName: 'apache-https', workflowDisplayName: 'Apache HTTPS 证书部署', pluginVersionId: 'plugin-version-2', pluginVersion: '1.2.8', displayName: 'Apache HTTPS 证书部署', capabilityKey: 'certificate.deploy' },
          { pluginId: 'builtin.workflow.apache', workflowResourcePath: 'workflows/deploy.json', workflowName: 'apache-https', workflowDisplayName: 'Apache HTTPS 证书部署', pluginVersionId: 'plugin-version-2', pluginVersion: '1.2.8', displayName: 'Apache HTTPS 证书部署', capabilityKey: 'certificate.rollback' },
          { pluginId: 'builtin.workflow.apache', workflowResourcePath: 'workflows/deploy.json', workflowName: 'apache-https', workflowDisplayName: 'Apache HTTPS 证书部署', pluginVersionId: 'plugin-version-1', pluginVersion: '1.2.7', displayName: 'Apache HTTPS 证书部署', capabilityKey: 'certificate.deploy' },
        ],
        labels: { loading: 'loading', empty: 'empty', deploy: 'deploy', rollback: 'rollback', version: 'version' },
      },
    })
    expect(wrapper.findAll('.gc-plugin-workflow-source-selector__workflow')).toHaveLength(1)
    expect(wrapper.findAll('.gc-plugin-workflow-source-selector__version')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('workflow version')

    await wrapper.findAll('.gc-plugin-workflow-source-selector__workflow-head')[0]!.trigger('click')
    expect(wrapper.findAll('.gc-plugin-workflow-source-selector__version')).toHaveLength(2)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await wrapper.findAll('.gc-plugin-workflow-source-selector__workflow-head')[0]!.trigger('click')
    expect(wrapper.findAll('.gc-plugin-workflow-source-selector__version')).toHaveLength(0)

    await wrapper.findAll('.gc-plugin-workflow-source-selector__workflow-head')[0]!.trigger('click')
    expect(wrapper.findAll('.gc-plugin-workflow-source-selector__version')).toHaveLength(2)

    await wrapper.findAll('.gc-plugin-workflow-source-selector__version-copy')[0]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([
      ['plugin-version-2:certificate.deploy'],
    ])
  })
})
