import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { ApiClientError } from '@/api/client'
import { i18n } from '@/i18n'

const onboardingMocks = vi.hoisted(() => ({
  cancelOnboardingSession: vi.fn(),
  completeOnboardingSession: vi.fn(),
  createOnboardingSession: vi.fn(),
  discoverOnboardingTargets: vi.fn(),
  getOnboardingSession: vi.fn(),
  listOnboardingCertificateOptions: vi.fn(),
  listOnboardingDevices: vi.fn(),
  listOnboardingPlatforms: vi.fn(),
  listOnboardingTargets: vi.fn(),
  selectOnboardingCertificate: vi.fn(),
  selectOnboardingResource: vi.fn(),
  selectOnboardingTarget: vi.fn(),
  testOnboardingConnection: vi.fn(),
}))
const deploymentInputMocks = vi.hoisted(() => ({
  projectApplicationAssetPluginInputs: vi.fn(),
}))
const credentialMocks = vi.hoisted(() => ({
  listCredentials: vi.fn(),
}))
const certificateFormatMocks = vi.hoisted(() => ({
  listCertificateFormats: vi.fn(),
}))
const routerMocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))
const routeMock = vi.hoisted(() => ({ query: {} as Record<string, string> }))

vi.mock('@/api/modules/application-onboarding.api', () => onboardingMocks)
vi.mock('@/api/modules/deployment-inputs.api', () => deploymentInputMocks)
vi.mock('@/api/modules/credentials.api', () => credentialMocks)
vi.mock('@/api/modules/certificates.api', () => certificateFormatMocks)
vi.mock('vue-router', () => ({ useRoute: () => routeMock, useRouter: () => routerMocks }))

import ApplicationOnboardingView from '@/views/application-onboarding/ApplicationOnboardingView.vue'
import ApplicationOnboardingModal from '@/views/application-onboarding/ApplicationOnboardingModal.vue'

function response(data: unknown) {
  return { data }
}

describe('ApplicationOnboardingView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    routeMock.query = {}
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({ items: [] }))
    onboardingMocks.getOnboardingSession.mockResolvedValue(response({}))
    onboardingMocks.listOnboardingCertificateOptions.mockResolvedValue(response({ assets: [], versions: [] }))
    deploymentInputMocks.projectApplicationAssetPluginInputs.mockResolvedValue(response({
      contractVersion: 'gcac.deployment-input/v1',
      requiredVariables: [{ slot: 'allowInsecureTls', type: 'boolean', required: true, configurationMode: 'required', bindingPolicy: 'required_binding', source: { kind: 'binding' }, value: true }],
      advancedVariables: [],
      connections: [{
        slot: 'management',
        transport: 'http',
        fields: {
          host: { slot: 'host', type: 'string', required: true, configurationMode: 'required', bindingPolicy: 'required_binding', source: { kind: 'binding' }, value: '10.255.0.215' },
        },
      }],
      credentials: [{ slot: 'credential', allowedKinds: ['USERNAME_PASSWORD'], required: true, configurationMode: 'required', selectedCredentialId: 'credential-1' }],
      artifacts: [{
        slot: 'certificate',
        kind: 'certificate',
        required: true,
        configurationMode: 'required',
        outputs: {
          leafPemBase64: { role: 'public_certificate', required: true },
          privateKeyPemBase64: { role: 'private_key', required: true },
        },
        binding: {
          certificateFormatId: 'certfmt_default',
          outputBindings: { leafPemBase64: 'leafPem', privateKeyPemBase64: 'privateKeyPem' },
        },
      }],
      fixedValues: [],
      runtimeValues: [],
      issues: [],
      saveable: true,
    }))
    credentialMocks.listCredentials.mockResolvedValue(response({ items: [] }))
    certificateFormatMocks.listCertificateFormats.mockResolvedValue(response({ items: [] }))
  })

  it('平台列表加载期间显示稳定的加载状态', async () => {
    let resolvePlatforms: ((value: unknown) => void) | undefined
    onboardingMocks.listOnboardingPlatforms.mockImplementation(() => new Promise((resolve) => {
      resolvePlatforms = resolve
    }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await wrapper.vm.$nextTick()

    const loading = wrapper.get('.onboarding-platform-loading')
    expect(loading.attributes('role')).toBe('status')
    expect(loading.attributes('aria-busy')).toBe('true')
    expect(loading.find('.onboarding-platform-loading__spinner').exists()).toBe(true)
    expect(loading.text()).toContain('加载中')
    expect(wrapper.find('.platform-card').exists()).toBe(false)

    resolvePlatforms?.(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'applicationOnboarding.platforms.iis', supportStatus: 'SUPPORTED' }],
    }))
    await flushPromises()

    expect(wrapper.find('.onboarding-platform-loading').exists()).toBe(false)
    expect(wrapper.find('.platform-card').exists()).toBe(true)
  })

  it('受管设备路径列出站点并默认选择首个可部署证书版本', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'citrix.adc', source: 'PLUGIN', pluginVersionId: 'plugin-version-citrix', displayName: 'Citrix ADC', displayNameKey: 'applicationOnboarding.platforms.citrixAdc', logoUrl: '/api/v1/plugin-versions/plugin-version-citrix/resources/logos/horizontal', logoSquareUrl: '/api/v1/plugin-versions/plugin-version-citrix/resources/logos/square', businessMetadata: { capabilityVersion: '1.0.4', compatibleVersions: ['Citrix ADC 13.1'], requiredInformation: ['管理地址', '管理员凭据'] }, deploymentMode: 'MANAGED_TARGET', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({ id: 'session-1', platformKey: 'citrix.adc', deploymentMode: 'MANAGED_TARGET', state: 'PLATFORM_SELECTED', stateVersion: 1 }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'device-1', displayName: 'ADC', health: 'HEALTHY', selectable: true }] }))
    onboardingMocks.selectOnboardingResource.mockResolvedValue(response({ id: 'session-1', platformKey: 'citrix.adc', deploymentMode: 'MANAGED_TARGET', state: 'CONNECTION_TESTING', stateVersion: 2 }))
    onboardingMocks.testOnboardingConnection.mockResolvedValue(response({ id: 'session-1', platformKey: 'citrix.adc', deploymentMode: 'MANAGED_TARGET', state: 'DISCOVERING', stateVersion: 3 }))
    onboardingMocks.discoverOnboardingTargets.mockResolvedValue(response({ id: 'session-1', platformKey: 'citrix.adc', deploymentMode: 'MANAGED_TARGET', state: 'TARGET_SELECTION_REQUIRED', stateVersion: 4, targets: [{ managedTargetId: 'target-1', displayName: 'example.com', targetType: 'tls.binding', endpoint: { host: '10.255.0.215', port: 443, protocol: 'HTTPS' }, configFingerprint: 'target-fingerprint', selectable: true }] }))
    onboardingMocks.selectOnboardingTarget.mockResolvedValue(response({ id: 'session-1', platformKey: 'citrix.adc', deploymentMode: 'MANAGED_TARGET', state: 'CERTIFICATE_SELECTION_REQUIRED', stateVersion: 5 }))
    onboardingMocks.listOnboardingCertificateOptions.mockImplementation((_sessionId: string, certificateId?: string) => Promise.resolve(response(
      certificateId
        ? { versions: [{ id: 'version-latest', commonName: 'example.com', status: 'active', deployable: true, activationState: 'promoted', notAfter: '2030-01-01T00:00:00.000Z' }] }
        : { assets: [{ id: 'certificate-1', primaryDomain: 'example.com' }] },
    )))

    const wrapper = mount(ApplicationOnboardingView, { global: { plugins: [i18n] } })
    await flushPromises()
    expect(wrapper.find('.platform-card__logo img').attributes('src')).toBe('/api/v1/plugin-versions/plugin-version-citrix/resources/logos/square')
    expect(wrapper.text()).toContain('接入能力版本')
    expect(wrapper.text()).toContain('1.0.4')
    expect(wrapper.text()).toContain('Citrix ADC 13.1')
    expect(wrapper.text()).toContain('管理地址')
    expect(wrapper.text()).not.toContain('由平台插件提供固定流程')
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()
    await wrapper.find('.onboarding-device-card:not(.onboarding-device-card--new)').trigger('click')
    await wrapper.vm.runFooterPrimary()
    await flushPromises()
    await wrapper.find('.target-row').trigger('click')
    await flushPromises()

    expect(wrapper.find('input[autocomplete="url"]').element).toBeTruthy()
    expect((wrapper.findAll('input[autocomplete="url"]')[0].element as HTMLInputElement).value).toBe('example.com')
    expect((wrapper.findAll('input[autocomplete="url"]')[1].element as HTMLInputElement).value).toBe('https://example.com:443')
    await wrapper.vm.runFooterPrimary()
    await flushPromises()

    const selects = wrapper.findAll('select')
    expect(selects).toHaveLength(2)
    expect((selects[0].element as HTMLSelectElement).value).toBe('certificate-1')
    expect((selects[1].element as HTMLSelectElement).value).toBe('__LATEST__')
    expect(selects[1].text()).toContain('example.com')
  })

  it('直接工作流与受管设备一样先选择设备，再查询所选设备的站点', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'workflow.platform', source: 'PLUGIN', displayNameKey: 'applicationOnboarding.platforms.nginx', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', newDeviceOnboarding: { kind: 'AGENT_INSTALL', platformKey: 'linux' }, supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({ id: 'session-direct', platformKey: 'workflow.platform', deploymentMode: 'DIRECT_WORKFLOW', state: 'PLATFORM_SELECTED', stateVersion: 1 }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'host-direct', displayName: 'Nginx Host', health: 'HEALTHY', selectable: true }] }))
    onboardingMocks.selectOnboardingResource.mockResolvedValue(response({ id: 'session-direct', platformKey: 'workflow.platform', deploymentMode: 'DIRECT_WORKFLOW', state: 'CONNECTION_TESTING', stateVersion: 2 }))
    onboardingMocks.testOnboardingConnection.mockResolvedValue(response({ id: 'session-direct', platformKey: 'workflow.platform', deploymentMode: 'DIRECT_WORKFLOW', state: 'DISCOVERING', stateVersion: 3 }))
    onboardingMocks.discoverOnboardingTargets.mockResolvedValue(response({ id: 'session-direct', platformKey: 'workflow.platform', deploymentMode: 'DIRECT_WORKFLOW', state: 'TARGET_SELECTION_REQUIRED', stateVersion: 4, targets: [{ managedTargetId: 'target-direct', displayName: 'example.com:443', targetType: 'tls.binding', configFingerprint: 'direct-fingerprint', selectable: true }] }))

    const wrapper = mount(ApplicationOnboardingView, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()

    expect(onboardingMocks.testOnboardingConnection).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('连接业务平台')
    expect(wrapper.text()).toContain('Nginx Host')
    expect(wrapper.text()).toContain('新增设备')
    expect(wrapper.text()).not.toContain('选择业务站点')
    expect(wrapper.find('.mode-switch').exists()).toBe(false)
    await wrapper.find('.onboarding-device-card:not(.onboarding-device-card--new)').trigger('click')
    await wrapper.vm.runFooterPrimary()
    await flushPromises()

    expect(onboardingMocks.testOnboardingConnection).toHaveBeenCalledWith('session-direct', 2)
    expect(onboardingMocks.discoverOnboardingTargets).toHaveBeenCalledWith('session-direct', 3)
    expect(wrapper.find('.target-row').exists()).toBe(true)
  })

  it('连接测试失败时不调用站点发现并展示真实错误', async () => {
    routeMock.query = { session: 'session-connection-failure' }
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'citrix.netscaler-adc', source: 'PLUGIN', displayName: 'Citrix ADC', displayNameKey: 'plugin.citrix.adc', deploymentMode: 'MANAGED_TARGET', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.getOnboardingSession.mockResolvedValue(response({
      id: 'session-connection-failure',
      platformKey: 'citrix.netscaler-adc',
      deploymentMode: 'MANAGED_TARGET',
      state: 'CONNECTION_TESTING',
      stateVersion: 2,
      deviceId: 'device-test-poc',
    }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'device-test-poc', displayName: 'TEST-POC', health: 'HEALTHY', selectable: true }] }))
    onboardingMocks.testOnboardingConnection.mockRejectedValue(new ApiClientError('设备插件能力执行失败', {
      errorCode: 'PLUGIN_CAPABILITY_EXECUTION_FAILED',
      requestId: 'req-connection-failure',
      status: 500,
      details: { capabilityKey: 'device.connection.test', failedStepName: 'readVersion', errorCode: 'HTTP_NON_SUCCESS_STATUS' },
    }))
    onboardingMocks.discoverOnboardingTargets.mockResolvedValue(response({ id: 'session-connection-failure', state: 'TARGET_SELECTION_REQUIRED', stateVersion: 3, targets: [] }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.vm.runFooterPrimary()
    await flushPromises()

    expect(onboardingMocks.testOnboardingConnection).toHaveBeenCalledWith('session-connection-failure', 2)
    expect(onboardingMocks.discoverOnboardingTargets).not.toHaveBeenCalled()
    expect(wrapper.find('.onboarding-error').text()).toContain('设备插件能力执行失败')
    expect(wrapper.text()).not.toContain('选择业务站点')
  })

  it('站点列表只展示当前可选择的监听目标', async () => {
    routeMock.query = { session: 'session-targets' }
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'plugin.web.iis', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.getOnboardingSession.mockResolvedValue(response({
      id: 'session-targets',
      platformKey: 'web.iis',
      deploymentMode: 'DIRECT_WORKFLOW',
      state: 'TARGET_SELECTION_REQUIRED',
      stateVersion: 4,
      deviceId: 'windows-host',
      targets: [
        { managedTargetId: 'site-active', displayName: 'Default Web Site', targetType: 'tls.binding', endpoint: { host: 'rds.jacksonz.cn', port: 4443, protocol: 'HTTPS' }, configFingerprint: 'active-fingerprint', selectable: true },
        { managedTargetId: 'site-inactive', displayName: 'WSUS 管理', targetType: 'tls.binding', endpoint: { host: '*', port: 8531, protocol: 'HTTPS' }, configFingerprint: 'inactive-fingerprint', selectable: false, reasonCode: 'MANAGED_TARGET_INACTIVE' },
      ],
    }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()

    const targetRows = wrapper.findAll('.target-row')
    expect(targetRows).toHaveLength(1)
    expect(targetRows[0].text()).toContain('Default Web Site')
    expect(targetRows[0].text()).toContain('rds.jacksonz.cn')
    expect(targetRows[0].text()).toContain('4443')
    expect(targetRows[0].text()).toContain('HTTPS')
    expect(targetRows[0].text()).toContain('可选择的受管目标')
    expect(targetRows[0].attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('WSUS 管理')
    expect(wrapper.text()).not.toContain('tls.binding')
  })

  it('选择站点时能解包响应式部署默认值并显示通用部署表单', async () => {
    routeMock.query = { session: 'session-deployment-inputs' }
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{
        platformKey: 'citrix.netscaler-adc',
        source: 'PLUGIN',
        pluginVersionId: 'plugin-citrix',
        displayName: 'Citrix ADC',
        displayNameKey: 'plugin.citrix.adc',
        deploymentMode: 'MANAGED_TARGET',
        supportStatus: 'SUPPORTED',
        acceptedCertificateFormats: ['PEM'],
        deploymentDefaults: {
          capabilityKey: 'certificate.deploy',
          variables: { allowInsecureTls: true },
          certificateFormat: { format: 'PEM', configName: '宿主默认 PEM Bundle' },
        },
      }],
    }))
    onboardingMocks.getOnboardingSession.mockResolvedValue(response({
      id: 'session-deployment-inputs',
      platformKey: 'citrix.netscaler-adc',
      deploymentMode: 'MANAGED_TARGET',
      state: 'TARGET_SELECTION_REQUIRED',
      stateVersion: 4,
      targets: [{
        managedTargetId: 'target-citrix',
        displayName: 'ikuai.jacksonz.cn',
        targetType: 'tls.binding',
        endpoint: { host: '10.255.0.215', port: 443, protocol: 'HTTPS' },
        configFingerprint: 'citrix-fingerprint',
        selectable: true,
      }],
    }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.target-row').trigger('click')
    await flushPromises()

    expect(deploymentInputMocks.projectApplicationAssetPluginInputs).toHaveBeenCalledWith('target-citrix', expect.objectContaining({
      pluginVersionId: 'plugin-citrix',
      deploymentDefaults: expect.objectContaining({
        variables: { allowInsecureTls: true },
        certificateFormat: { format: 'PEM', configName: '宿主默认 PEM Bundle' },
      }),
    }))
    expect(wrapper.find('.deployment-input-form').exists()).toBe(true)
    expect(wrapper.text()).toContain('allowInsecureTls')
    expect(wrapper.text()).toContain('产物格式')
    expect(wrapper.text()).not.toContain('management')
    expect(wrapper.text()).not.toContain('credential')
    expect(wrapper.text()).not.toContain('leafPemBase64')
    expect(wrapper.text()).not.toContain('加载中')
  })

  it('选择新增设备时交给统一设备向导，不向应用接入接口伪造设备输入', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'workflow.platform', source: 'PLUGIN', displayNameKey: 'applicationOnboarding.platforms.nginx', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', newDeviceOnboarding: { kind: 'AGENT_INSTALL', platformKey: 'linux' }, supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({ id: 'session-new-device', platformKey: 'workflow.platform', deploymentMode: 'DIRECT_WORKFLOW', state: 'PLATFORM_SELECTED', stateVersion: 1 }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [] }))

    const wrapper = mount(ApplicationOnboardingView, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()
    await wrapper.find('.onboarding-device-card--new').trigger('click')
    expect(wrapper.text()).toContain('打开设备接入向导')
    expect(wrapper.text()).not.toContain('返回后系统会重新加载该平台已发现的可用站点设备。')
    await wrapper.vm.runFooterPrimary()

    expect(wrapper.emitted('addDevice')).toEqual([[{ kind: 'AGENT_INSTALL', platformKey: 'linux' }]])
    expect(onboardingMocks.selectOnboardingResource).not.toHaveBeenCalled()
  })

  it('恢复到设备选择阶段时重新加载兼容设备列表', async () => {
    routeMock.query = { session: 'session-restore' }
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'workflow.platform', source: 'PLUGIN', displayNameKey: 'applicationOnboarding.platforms.nginx', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.getOnboardingSession.mockResolvedValue(response({ id: 'session-restore', platformKey: 'workflow.platform', deploymentMode: 'DIRECT_WORKFLOW', state: 'RESOURCE_SELECTION_REQUIRED', stateVersion: 2 }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'host-restored', displayName: 'Restored Host', health: 'HEALTHY', selectable: true }] }))

    const wrapper = mount(ApplicationOnboardingView, { global: { plugins: [i18n] } })
    await flushPromises()

    expect(onboardingMocks.listOnboardingDevices).toHaveBeenCalledWith('session-restore')
    expect(wrapper.text()).toContain('Restored Host')
  })

  it('恢复到连接测试阶段时继续按钮不重复选择设备来源', async () => {
    routeMock.query = { session: 'session-connection' }
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'plugin.web.iis', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.getOnboardingSession.mockResolvedValue(response({
      id: 'session-connection',
      platformKey: 'web.iis',
      deploymentMode: 'DIRECT_WORKFLOW',
      state: 'CONNECTION_TESTING',
      stateVersion: 2,
      deviceId: 'windows-host',
    }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'windows-host', displayName: 'Windows Host', health: 'HEALTHY', selectable: true }] }))
    onboardingMocks.testOnboardingConnection.mockResolvedValue(response({ id: 'session-connection', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'DISCOVERING', stateVersion: 3, deviceId: 'windows-host' }))
    onboardingMocks.discoverOnboardingTargets.mockResolvedValue(response({ id: 'session-connection', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'TARGET_SELECTION_REQUIRED', stateVersion: 4, deviceId: 'windows-host', targets: [{ managedTargetId: 'site-1', displayName: 'iis.example:443', targetType: 'tls.binding', configFingerprint: 'site-fingerprint', selectable: true }] }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.vm.runFooterPrimary()
    await flushPromises()

    expect(onboardingMocks.selectOnboardingResource).not.toHaveBeenCalled()
    expect(onboardingMocks.testOnboardingConnection).toHaveBeenCalledWith('session-connection', 2)
    expect(onboardingMocks.discoverOnboardingTargets).toHaveBeenCalledWith('session-connection', 3)
    expect(wrapper.text()).toContain('选择业务站点')
  })

  it('恢复到过期失败会话时创建同平台新会话后再选择设备', async () => {
    routeMock.query = { session: 'session-expired', onboarding: '1' }
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'plugin.web.iis', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.getOnboardingSession.mockResolvedValue(response({
      id: 'session-expired',
      platformKey: 'web.iis',
      deploymentMode: 'DIRECT_WORKFLOW',
      state: 'FAILED',
      stateVersion: 63,
      lastErrorCode: 'ONBOARDING_SESSION_EXPIRED',
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({
      id: 'session-restarted',
      platformKey: 'web.iis',
      deploymentMode: 'DIRECT_WORKFLOW',
      state: 'PLATFORM_SELECTED',
      stateVersion: 1,
    }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'windows-host', displayName: 'Windows Host', health: 'HEALTHY', selectable: true }] }))
    onboardingMocks.selectOnboardingResource.mockResolvedValue(response({ id: 'session-restarted', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'CONNECTION_TESTING', stateVersion: 2, deviceId: 'windows-host' }))
    onboardingMocks.testOnboardingConnection.mockResolvedValue(response({ id: 'session-restarted', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'DISCOVERING', stateVersion: 3, deviceId: 'windows-host' }))
    onboardingMocks.discoverOnboardingTargets.mockResolvedValue(response({ id: 'session-restarted', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'TARGET_SELECTION_REQUIRED', stateVersion: 4, deviceId: 'windows-host', targets: [{ managedTargetId: 'site-1', displayName: 'iis.example:443', targetType: 'tls.binding', configFingerprint: 'site-fingerprint', selectable: true }] }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()

    expect(onboardingMocks.createOnboardingSession).toHaveBeenCalledWith('web.iis')
    expect(routerMocks.replace).toHaveBeenCalledWith({ query: { session: 'session-restarted', onboarding: '1' } })
    await wrapper.find('.onboarding-device-card:not(.onboarding-device-card--new)').trigger('click')
    await wrapper.vm.runFooterPrimary()
    await flushPromises()

    expect(onboardingMocks.selectOnboardingResource).toHaveBeenCalledWith('session-restarted', {
      expectedStateVersion: 1,
      mode: 'EXISTING_DEVICE',
      deviceId: 'windows-host',
    })
    expect(wrapper.text()).not.toContain('不能重复选择设备来源')
    expect(wrapper.text()).toContain('选择业务站点')
  })

  it('继续前刷新会话并从连接测试阶段继续', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'plugin.web.iis', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({
      id: 'session-race',
      platformKey: 'web.iis',
      deploymentMode: 'DIRECT_WORKFLOW',
      state: 'PLATFORM_SELECTED',
      stateVersion: 1,
    }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'windows-host', displayName: 'Windows Host', health: 'HEALTHY', selectable: true }] }))
    onboardingMocks.getOnboardingSession.mockResolvedValue(response({
      id: 'session-race',
      platformKey: 'web.iis',
      deploymentMode: 'DIRECT_WORKFLOW',
      state: 'CONNECTION_TESTING',
      stateVersion: 2,
      deviceId: 'windows-host',
    }))
    onboardingMocks.testOnboardingConnection.mockResolvedValue(response({ id: 'session-race', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'DISCOVERING', stateVersion: 3, deviceId: 'windows-host' }))
    onboardingMocks.discoverOnboardingTargets.mockResolvedValue(response({ id: 'session-race', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'TARGET_SELECTION_REQUIRED', stateVersion: 4, deviceId: 'windows-host', targets: [{ managedTargetId: 'site-1', displayName: 'iis.example:443', targetType: 'tls.binding', configFingerprint: 'site-fingerprint', selectable: true }] }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()
    await wrapper.find('.onboarding-device-card:not(.onboarding-device-card--new)').trigger('click')
    await wrapper.vm.runFooterPrimary()
    await flushPromises()

    expect(onboardingMocks.getOnboardingSession).toHaveBeenCalledWith('session-race')
    expect(onboardingMocks.selectOnboardingResource).not.toHaveBeenCalled()
    expect(onboardingMocks.testOnboardingConnection).toHaveBeenCalledWith('session-race', 2)
    expect(onboardingMocks.discoverOnboardingTargets).toHaveBeenCalledWith('session-race', 3)
    expect(wrapper.text()).not.toContain('不能重复选择设备来源')
    expect(wrapper.text()).toContain('选择业务站点')
  })

  it('重复选择设备来源错误会刷新会话并从连接测试阶段继续', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'plugin.web.iis', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({
      id: 'session-race-error',
      platformKey: 'web.iis',
      deploymentMode: 'DIRECT_WORKFLOW',
      state: 'PLATFORM_SELECTED',
      stateVersion: 1,
    }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'windows-host', displayName: 'Windows Host', health: 'HEALTHY', selectable: true }] }))
    onboardingMocks.getOnboardingSession
      .mockResolvedValueOnce(response({
        id: 'session-race-error',
        platformKey: 'web.iis',
        deploymentMode: 'DIRECT_WORKFLOW',
        state: 'PLATFORM_SELECTED',
        stateVersion: 1,
      }))
      .mockResolvedValueOnce(response({
        id: 'session-race-error',
        platformKey: 'web.iis',
        deploymentMode: 'DIRECT_WORKFLOW',
        state: 'CONNECTION_TESTING',
        stateVersion: 2,
        deviceId: 'windows-host',
      }))
    onboardingMocks.selectOnboardingResource.mockRejectedValue(new ApiClientError('不能重复选择设备来源', {
      errorCode: 'VALIDATION_FAILED',
      requestId: 'req-race-error',
      status: 400,
    }))
    onboardingMocks.testOnboardingConnection.mockResolvedValue(response({ id: 'session-race-error', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'DISCOVERING', stateVersion: 3, deviceId: 'windows-host' }))
    onboardingMocks.discoverOnboardingTargets.mockResolvedValue(response({ id: 'session-race-error', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'TARGET_SELECTION_REQUIRED', stateVersion: 4, deviceId: 'windows-host', targets: [{ managedTargetId: 'site-1', displayName: 'iis.example:443', targetType: 'tls.binding', configFingerprint: 'site-fingerprint', selectable: true }] }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()
    await wrapper.find('.onboarding-device-card:not(.onboarding-device-card--new)').trigger('click')
    await wrapper.vm.runFooterPrimary()
    await flushPromises()

    expect(onboardingMocks.selectOnboardingResource).toHaveBeenCalledTimes(1)
    expect(onboardingMocks.getOnboardingSession).toHaveBeenCalledTimes(2)
    expect(onboardingMocks.testOnboardingConnection).toHaveBeenCalledWith('session-race-error', 2)
    expect(onboardingMocks.discoverOnboardingTargets).toHaveBeenCalledWith('session-race-error', 3)
    expect(wrapper.text()).not.toContain('不能重复选择设备来源')
    expect(wrapper.text()).toContain('选择业务站点')
  })

  it('上一步从设备选择返回平台选择并清理接入会话地址', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'plugin.web.iis', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({
      id: 'session-iis', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'PLATFORM_SELECTED', stateVersion: 1,
    }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'windows-host', displayName: 'Windows Host', health: 'HEALTHY', selectable: true }] }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('连接业务平台')
    await wrapper.vm.goPrevious()
    await flushPromises()

    expect(wrapper.find('.platform-grid').exists()).toBe(true)
    expect(wrapper.text()).toContain('IIS')
    expect(routerMocks.replace).toHaveBeenLastCalledWith({ query: {} })
  })

  it('顶部步骤指示器允许回到已完成的设备和平台步骤', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'plugin.web.iis', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({ id: 'session-step', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'PLATFORM_SELECTED', stateVersion: 1 }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [{ deviceId: 'windows-host', displayName: 'Windows Host', health: 'HEALTHY', selectable: true }] }))
    onboardingMocks.selectOnboardingResource.mockResolvedValue(response({ id: 'session-step', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'CONNECTION_TESTING', stateVersion: 2 }))
    onboardingMocks.testOnboardingConnection.mockResolvedValue(response({ id: 'session-step', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'DISCOVERING', stateVersion: 3 }))
    onboardingMocks.discoverOnboardingTargets.mockResolvedValue(response({ id: 'session-step', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'TARGET_SELECTION_REQUIRED', stateVersion: 4, targets: [{ managedTargetId: 'site-1', displayName: 'iis.example:443', targetType: 'tls.binding', configFingerprint: 'site-fingerprint', selectable: true }] }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()
    await wrapper.find('.onboarding-device-card:not(.onboarding-device-card--new)').trigger('click')
    await wrapper.vm.runFooterPrimary()
    await flushPromises()

    expect(wrapper.text()).toContain('选择业务站点')
    const stepButtons = wrapper.findAll('.onboarding-steps__button')
    await stepButtons[1].trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('连接业务平台')
    expect(onboardingMocks.listOnboardingDevices).toHaveBeenCalledTimes(2)

    await wrapper.findAll('.onboarding-steps__button')[0].trigger('click')
    await flushPromises()
    expect(wrapper.find('.platform-grid').exists()).toBe(true)
  })

  it('取消接口失败也必须清空本地状态并关闭嵌入向导', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'web.iis', source: 'PLUGIN', displayName: 'IIS', displayNameKey: 'plugin.web.iis', deploymentMode: 'DIRECT_WORKFLOW', deviceSelection: 'EXISTING_OR_NEW', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({
      id: 'session-cancel', platformKey: 'web.iis', deploymentMode: 'DIRECT_WORKFLOW', state: 'PLATFORM_SELECTED', stateVersion: 1,
    }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [] }))
    onboardingMocks.cancelOnboardingSession.mockRejectedValue(new Error('cancel failed'))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()
    routeMock.query = { session: 'session-cancel', onboarding: '1', keep: '1' }
    await wrapper.vm.cancel()
    await flushPromises()

    expect(onboardingMocks.cancelOnboardingSession).toHaveBeenCalledWith('session-cancel', 1)
    expect(routerMocks.replace).toHaveBeenLastCalledWith({ query: { keep: '1' } })
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.find('.platform-grid').exists()).toBe(true)
  })

  it('嵌入模态框时把接入会话写回 URL 并保留打开状态', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'citrix.adc', source: 'PLUGIN', displayName: 'Citrix ADC', displayNameKey: 'plugin.citrix.adc', deploymentMode: 'MANAGED_TARGET', supportStatus: 'SUPPORTED' }],
    }))
    onboardingMocks.createOnboardingSession.mockResolvedValue(response({
      id: 'session-modal', platformKey: 'citrix.adc', deploymentMode: 'MANAGED_TARGET', state: 'PLATFORM_SELECTED', stateVersion: 1,
    }))
    onboardingMocks.listOnboardingDevices.mockResolvedValue(response({ items: [] }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')
    await flushPromises()

    expect(routerMocks.replace).toHaveBeenCalledWith({ query: { session: 'session-modal', onboarding: '1' } })
    expect(wrapper.find('.onboarding-page__header').exists()).toBe(false)
  })

  it('模态框把向导操作统一渲染到标准页脚', async () => {
    const calls = { previous: vi.fn(), primary: vi.fn(), cancel: vi.fn() }
    const GcModalStub = defineComponent({
      name: 'GcModal',
      props: { open: { type: Boolean, default: false } },
      emits: ['update:open'],
      template: '<div v-if="open"><slot /><footer class="modal-actions"><slot name="actions" /></footer></div>',
    })
    const ApplicationOnboardingViewStub = defineComponent({
      name: 'ApplicationOnboardingView',
      emits: ['footer-actions-change'],
      setup(_, { expose }) {
        expose({ goPrevious: calls.previous, runFooterPrimary: calls.primary, cancel: calls.cancel })
        return {}
      },
      template: '<button class="publish-actions" type="button" @click="$emit(\'footer-actions-change\', { visible: true, showCancel: true, showPrevious: true, previousDisabled: false, primaryAction: \'RESOURCE\', primaryLabel: \'继续\', primaryDisabled: false })">同步页脚</button>',
    })

    const wrapper = mount(ApplicationOnboardingModal, {
      props: { open: true },
      global: {
        plugins: [i18n],
        stubs: { GcModal: GcModalStub, ApplicationOnboardingView: ApplicationOnboardingViewStub },
      },
    })

    await wrapper.find('.publish-actions').trigger('click')
    const footer = wrapper.find('.modal-actions')
    expect(footer.text()).toContain('取消向导')
    expect(footer.text()).toContain('上一步')
    expect(footer.text()).toContain('继续')
    await footer.find('.gc-button--ghost').trigger('click')
    await footer.find('.gc-button--secondary').trigger('click')
    await footer.find('.gc-button--primary').trigger('click')
    expect(calls.cancel).toHaveBeenCalledTimes(1)
    expect(calls.previous).toHaveBeenCalledTimes(1)
    expect(calls.primary).toHaveBeenCalledTimes(1)
  })

  it('选择自定义手动创建时向父弹窗发出打开资产创建页事件', async () => {
    onboardingMocks.listOnboardingPlatforms.mockResolvedValue(response({
      items: [{ platformKey: 'CUSTOM_MANUAL', source: 'CUSTOM_MANUAL', displayNameKey: 'applicationOnboarding.platforms.customManual', supportStatus: 'SUPPORTED' }],
    }))

    const wrapper = mount(ApplicationOnboardingView, { props: { embedded: true }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.find('.platform-card').trigger('click')

    expect(wrapper.emitted('customManual')).toHaveLength(1)
    expect(onboardingMocks.createOnboardingSession).not.toHaveBeenCalled()
  })

  it('父级模态框关闭时清理接入会话地址，避免下次打开恢复旧步骤', async () => {
    routeMock.query = { session: 'session-modal', onboarding: '1', keep: '1' }
    const GcModalStub = defineComponent({
      name: 'GcModal',
      props: { open: { type: Boolean, default: false } },
      emits: ['update:open'],
      template: '<div v-if="open"><button class="modal-close" type="button" @click="$emit(\'update:open\', false)">close</button><slot /></div>',
    })

    const wrapper = mount(ApplicationOnboardingModal, {
      props: { open: true },
      global: {
        plugins: [i18n],
        stubs: {
          GcModal: GcModalStub,
          ApplicationOnboardingView: { template: '<div />' },
        },
      },
    })

    await wrapper.find('.modal-close').trigger('click')
    await flushPromises()

    expect(routerMocks.replace).toHaveBeenCalledWith({ query: { keep: '1' } })
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('打开统一设备向导时只通知父级，不清理待恢复的应用接入会话', async () => {
    routeMock.query = { session: 'session-preserved', onboarding: '1', keep: '1' }
    const GcModalStub = defineComponent({
      name: 'GcModal',
      props: { open: { type: Boolean, default: false } },
      emits: ['update:open'],
      template: '<div v-if="open"><slot /></div>',
    })
    const ApplicationOnboardingViewStub = defineComponent({
      name: 'ApplicationOnboardingView',
      emits: ['addDevice'],
      template: '<button class="add-device" type="button" @click="$emit(\'addDevice\', { kind: \'PLUGIN_MANAGED\', pluginId: \'device.citrix.netscaler-adc\' })">add</button>',
    })

    const wrapper = mount(ApplicationOnboardingModal, {
      props: { open: true },
      global: {
        plugins: [i18n],
        stubs: {
          GcModal: GcModalStub,
          ApplicationOnboardingView: ApplicationOnboardingViewStub,
        },
      },
    })

    await wrapper.find('.add-device').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('addDevice')).toEqual([[{ kind: 'PLUGIN_MANAGED', pluginId: 'device.citrix.netscaler-adc' }]])
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(routerMocks.replace).not.toHaveBeenCalled()
  })
})
