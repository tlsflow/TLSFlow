import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import DeploymentInputForm from '@/design-system/components/DeploymentInputForm.vue'
import type { DeploymentInputBindingsV1, DeploymentInputProjectionV1 } from '@/design-system/components/DeploymentInputForm.types'

function bindings(): DeploymentInputBindingsV1 {
  return { apiVersion: 'gcac.input-bindings/v1', variables: {}, connections: {}, credentials: {}, artifacts: {} }
}

function projection(): DeploymentInputProjectionV1 {
  return {
    contractVersion: 'gcac.deployment-input-contract/v1',
    requiredVariables: [{ slot: 'vendorDefinedSlot', type: 'string', required: true, configurationMode: 'required', bindingPolicy: 'required_binding', source: { kind: 'binding' } }],
    advancedVariables: [{ slot: 'retryCount', type: 'number', required: false, configurationMode: 'advanced', bindingPolicy: 'default_overridable', source: { kind: 'default' }, default: 3 }],
    connections: [{
      slot: 'management', transport: 'http', credentialSlot: 'managementCredential', fields: {
        host: { slot: 'host', type: 'string', required: true, configurationMode: 'required', bindingPolicy: 'required_binding', source: { kind: 'binding' } },
        'tls.verifyPeer': { slot: 'tls.verifyPeer', type: 'boolean', required: false, configurationMode: 'advanced', bindingPolicy: 'default_overridable', source: { kind: 'default' }, default: true },
      },
    }],
    credentials: [{ slot: 'managementCredential', allowedKinds: ['password'], required: true, configurationMode: 'required' }],
    artifacts: [{ slot: 'certificate', kind: 'certificate', required: true, configurationMode: 'required', outputs: { certificate: { role: 'certificate', required: true } } }],
    fixedValues: [{ slot: 'applicationHost', value: 'app.example.com', source: { kind: 'asset', path: 'application.address' } }],
    runtimeValues: [{ slot: 'stepResult', source: { kind: 'step_output', step: 'install', output: 'result' }, lifecycle: 'step_output' }],
    issues: [{ category: 'VARIABLE', code: 'DEPLOYMENT_INPUT_REQUIRED', severity: 'ERROR', slot: 'vendorDefinedSlot', path: 'variables.vendorDefinedSlot', messageKey: 'deploymentInputs.issues.DEPLOYMENT_INPUT_REQUIRED' }],
    saveable: false,
  }
}

describe('DeploymentInputForm', () => {
  it('完全按投影渲染任意 Slot，且 fixed 与 runtime 只读', () => {
    const wrapper = mount(DeploymentInputForm, { props: { modelValue: bindings(), projection: projection() }, global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('vendorDefinedSlot')
    expect(wrapper.text()).toContain('applicationHost')
    expect(wrapper.text()).toContain('stepResult')
    expect(wrapper.find('input[value="app.example.com"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('variables.vendorDefinedSlot')
    expect(wrapper.text()).toContain('缺少必填部署输入')
    expect(wrapper.text()).not.toContain('deploymentInputs.issues.DEPLOYMENT_INPUT_REQUIRED')
    expect(wrapper.text()).toContain('来源：绑定')
    expect(wrapper.text()).toContain('运行时由 步骤输出 提供')
    expect(wrapper.text()).not.toContain('deploymentInputs.source')
  })

  it('只写入用户修改的变量和嵌套连接字段', async () => {
    const wrapper = mount(DeploymentInputForm, { props: { modelValue: bindings(), projection: projection() }, global: { plugins: [i18n] } })
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('configured-value')
    await inputs[1].setValue('device.example.com')
    const updates = wrapper.emitted('update:modelValue') ?? []
    expect(updates[0]?.[0]).toMatchObject({ variables: { vendorDefinedSlot: 'configured-value' } })
    expect(updates[1]?.[0]).toMatchObject({ connections: { management: { host: 'device.example.com' } } })
  })

  it('高级配置默认折叠，展开后按投影写入覆盖值', async () => {
    const wrapper = mount(DeploymentInputForm, { props: { modelValue: bindings(), projection: projection() }, global: { plugins: [i18n] } })
    expect(wrapper.find('input[value="3"]').exists()).toBe(false)
    await wrapper.findAll('button').find((button) => button.text() === '展开高级配置')!.trigger('click')
    const advancedInput = wrapper.find('input[value="3"]')
    expect(advancedInput.exists()).toBe(true)
    await advancedInput.setValue('5')
    expect(wrapper.emitted('update:modelValue')!.at(-1)![0]).toMatchObject({ variables: { retryCount: 5 } })
  })

  it('凭据只保存 credentialId，Artifact 只保存格式和输出映射', async () => {
    const wrapper = mount(DeploymentInputForm, {
      props: {
        modelValue: bindings(), projection: projection(),
        credentialOptions: [{ id: 'cred_1', label: '运维凭据', kind: 'password' }],
        artifactOptions: { certificate: [{ id: 'fmt_1', label: 'PEM', outputs: [{ key: 'fullchain', label: 'Full chain' }] }] },
      },
      global: { plugins: [i18n] },
    })
    const selects = wrapper.findAll('select')
    await selects.find((item) => item.html().includes('cred_1'))!.setValue('cred_1')
    await selects.find((item) => item.html().includes('fmt_1'))!.setValue('fmt_1')
    await wrapper.setProps({ modelValue: (wrapper.emitted('update:modelValue')!.at(-1)![0] as DeploymentInputBindingsV1) })
    await wrapper.findAll('select').find((item) => item.html().includes('fullchain'))!.setValue('fullchain')
    const latest = wrapper.emitted('update:modelValue')!.at(-1)![0]
    expect(latest).toMatchObject({ artifacts: { certificate: { certificateFormatId: 'fmt_1', outputBindings: { certificate: 'fullchain' } } } })
    const credentialUpdate = wrapper.emitted('update:modelValue')!.find((event) => (event[0] as DeploymentInputBindingsV1).credentials.managementCredential)
    expect(credentialUpdate?.[0]).toMatchObject({ credentials: { managementCredential: { credentialId: 'cred_1' } } })
    expect(JSON.stringify(credentialUpdate?.[0])).not.toMatch(/password|secretRef|token/i)
  })
})
