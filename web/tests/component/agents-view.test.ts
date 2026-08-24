import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AgentsView from '@/views/agents/AgentsView.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  getAgentDetail: vi.fn(),
  createLinuxGoInstallSession: vi.fn(),
  createWindowsPowerShellInstallSession: vi.fn(),
  disableAgent: vi.fn(),
  enableAgent: vi.fn(),
  deleteAgent: vi.fn(),
  listCertificateVersions: vi.fn(),
}))

const routerPush = vi.fn()

vi.mock('@/api/modules/assets.api', () => ({
  listAgents: apiMocks.listAgents,
  getAgentDetail: apiMocks.getAgentDetail,
  createLinuxGoInstallSession: apiMocks.createLinuxGoInstallSession,
  createWindowsPowerShellInstallSession: apiMocks.createWindowsPowerShellInstallSession,
  disableAgent: apiMocks.disableAgent,
  enableAgent: apiMocks.enableAgent,
  deleteAgent: apiMocks.deleteAgent,
}))

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificateVersions: apiMocks.listCertificateVersions,
}))

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return {
    ...actual,
    useRouter: () => ({
      push: routerPush,
    }),
  }
})

const mountOptions = {
  global: {
    stubs: { teleport: true, Teleport: true },
  },
} as const

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_agents',
    timestamp: '2026-06-21T00:00:00.000Z',
  }
}

describe('AgentsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['agent.read', 'agent.write'])

    apiMocks.listAgents.mockResolvedValue(okPage([
      {
        id: 'agt-1',
        agentKey: 'agent-prod-1',
        descriptor: {
          hostname: 'prod-1',
          version: '1.2.3',
          osType: 'WINDOWS',
          arch: 'amd64',
          ipAddress: '10.0.0.10',
        },
        status: 'ONLINE',
        role: 'full_agent',
        updatedAt: '2026-06-21T00:30:00.000Z',
      },
    ]))

    apiMocks.getAgentDetail.mockResolvedValue({
      data: {
        agent: {
          id: 'agt-1',
          agentKey: 'agent-prod-1',
          status: 'ONLINE',
          role: 'full_agent',
          zone: 'default',
          descriptor: {
            hostname: 'prod-1',
            version: '1.2.3',
            osType: 'WINDOWS',
            arch: 'amd64',
            ipAddress: '10.0.0.10',
            osVersion: '10.0.20348',
          },
        },
        latestHeartbeat: {
          receivedAt: '2026-06-21T00:30:00.000Z',
        },
        capabilitySnapshot: {
          compatibilityLevel: 'L1',
          capabilities: [
            {
              capabilityKey: 'windows.os.detail',
              value: {
                ProductName: 'Windows Server 2022 Datacenter',
                Version: '10.0.20348',
                BuildRevision: '20348.2402',
              },
            },
            {
              capabilityKey: 'windows.iis.detail',
              value: {
                Installed: true,
                VersionString: 'Version 10.0',
                MajorVersion: 10,
                MinorVersion: 0,
                BuildNumber: 20348,
                SetupString: 'IIS',
              },
            },
            {
              capabilityKey: 'windows.iis.sites',
              value: [
                {
                  Name: 'Default Web Site',
                  PhysicalPath: 'C:\\inetpub\\wwwroot',
                  Bindings: [
                    {
                      Protocol: 'https',
                      Port: 443,
                      Certificate: {
                        Subject: 'CN=portal.example.com',
                        Issuer: 'CN=GCAC Test CA',
                        NotBefore: '2026-01-01T00:00:00.000Z',
                        NotAfter: '2027-01-01T00:00:00.000Z',
                        Thumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
                        StoreName: 'My',
                      },
                    },
                  ],
                },
              ],
            },
            {
              capabilityKey: 'windows.network.adapters',
              value: [
                {
                  Name: 'Intel(R) Ethernet Connection',
                  IPv4: ['10.255.0.85'],
                },
              ],
            },
          ],
        },
      },
      requestId: 'req_agent_detail',
      timestamp: '2026-06-21T00:00:00.000Z',
    })

    apiMocks.createLinuxGoInstallSession.mockResolvedValue({
      data: {
        bootstrapTokenPreview: 'linux-preview',
        zone: 'default',
        expiresAt: '2026-06-21T01:00:00.000Z',
        installCommand: `curl -fsSL 'http://127.0.0.1:3003/api/v1/agents/install/linux/bootstrap.sh?token=linux' | sudo bash`,
        bootstrapUrl: 'http://127.0.0.1:3003/api/v1/agents/install/linux/bootstrap.sh?token=linux',
      },
      requestId: 'req_linux_install',
      timestamp: '2026-06-21T00:00:00.000Z',
    })

    apiMocks.createWindowsPowerShellInstallSession.mockResolvedValue({
      data: {
        bootstrapTokenPreview: 'secret-token-preview',
        zone: 'default',
        expiresAt: '2026-06-21T01:00:00.000Z',
        installCommand: `irm 'http://127.0.0.1:3003/api/v1/agents/install/windows/bootstrap.ps1?token=abc' | iex`,
        bootstrapUrl: 'http://127.0.0.1:3003/api/v1/agents/install/windows/bootstrap.ps1?token=abc',
      },
      requestId: 'req_install',
      timestamp: '2026-06-21T00:00:00.000Z',
    })

    apiMocks.disableAgent.mockResolvedValue({ data: {}, requestId: 'req_disable', timestamp: '2026-06-21T00:00:00.000Z' })
    apiMocks.enableAgent.mockResolvedValue({ data: {}, requestId: 'req_enable', timestamp: '2026-06-21T00:00:00.000Z' })
    apiMocks.deleteAgent.mockResolvedValue({ data: {}, requestId: 'req_delete', timestamp: '2026-06-21T00:00:00.000Z' })
    apiMocks.listCertificateVersions.mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-1',
            certificateAssetId: 'cert-1',
            fingerprintSha256: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
            commonName: 'CN=portal.example.com',
            subject: { commonName: 'CN=portal.example.com' },
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      },
      requestId: 'req_certificate_versions',
      timestamp: '2026-06-21T00:00:00.000Z',
    })
    routerPush.mockReset()
    routerPush.mockResolvedValue(undefined)

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        origin: 'https://portal.example.com',
      },
    })
  })

  it('点击安装Agent只打开模态框，不会立即请求后端', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
    expect(primaryButton).toBeTruthy()

    await primaryButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.createLinuxGoInstallSession).not.toHaveBeenCalled()
    expect(apiMocks.createWindowsPowerShellInstallSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('生成安装命令')
  })

  it('默认 Linux + latest 生成安装命令时，会把 URL 重写为浏览器 origin', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
    await primaryButton!.trigger('click')
    await flushPromises()

    const generateButton = wrapper.findAll('button').find((button) => button.text().includes('生成安装命令'))
    await generateButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.createLinuxGoInstallSession).toHaveBeenCalledWith({ zone: 'default', version: 'latest' })
    expect(apiMocks.createWindowsPowerShellInstallSession).not.toHaveBeenCalled()

    const textarea = wrapper.find('textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      `curl -fsSL 'https://portal.example.com/api/v1/agents/install/linux/bootstrap.sh?token=linux' | sudo bash`,
    )
  })

  it('切换到 Windows 平台并指定版本后，生成 Go Agent 极简安装命令', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
    await primaryButton!.trigger('click')
    await flushPromises()

    const windowsButton = wrapper.findAll('button').find((button) => button.text().includes('Windows Go Service'))
    await windowsButton!.trigger('click')

    const versionSelect = wrapper.find('select#agent-version')
    await versionSelect.setValue('1.2.0')

    const generateButton = wrapper.findAll('button').find((button) => button.text().includes('生成安装命令'))
    await generateButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.createWindowsPowerShellInstallSession).toHaveBeenCalledWith({
      zone: 'default',
      startAfterInstall: true,
      version: '1.2.0',
    })

    const textarea = wrapper.find('textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      `irm 'https://portal.example.com/api/v1/agents/install/windows/bootstrap.ps1?token=abc' | iex`,
    )
  })

  it('详情页提供独立 IIS 标签页，并展示网站列表、路径、端口和证书主题名', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()

    await detailButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.getAgentDetail).toHaveBeenCalledWith('agt-1')
    expect(wrapper.text()).toContain('概览')
    expect(wrapper.text()).toContain('IIS')
    expect(wrapper.text()).toContain('Windows Server 2022 Datacenter')
    expect(wrapper.text()).toContain('20348.2402')

    const iisTab = wrapper.findAll('button').find((button) => button.text() === 'IIS')
    expect(iisTab).toBeTruthy()
    await iisTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('IIS 概况')
    expect(wrapper.text()).toContain('IIS 站点')
    expect(wrapper.text()).toContain('站点数量')
    expect(wrapper.text()).toContain('HTTPS 绑定')
    expect(wrapper.text()).toContain('Default Web Site')
    expect(wrapper.text()).toContain('C:\\inetpub\\wwwroot')
    expect(wrapper.text()).toContain('CN=portal.example.com')

    const bindingCard = wrapper.findAll('.agent-detail-modal__binding-chip').find((item) => item.text().includes('HTTPS:443'))
    expect(bindingCard).toBeTruthy()
    await bindingCard!.trigger('click')
    await flushPromises()

    expect(apiMocks.listCertificateVersions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
    })
    expect(routerPush).toHaveBeenCalledWith({
      name: 'certificate.detail',
      params: { id: 'cert-1' },
      query: { versionId: 'ver-1' },
    })
  })

  it('没有 IIS 安装信息和站点数据时，不显示 IIS 标签', async () => {
    apiMocks.getAgentDetail.mockResolvedValueOnce({
      data: {
        agent: {
          id: 'agt-1',
          agentKey: 'agent-prod-1',
          status: 'ONLINE',
          role: 'full_agent',
          zone: 'default',
          descriptor: {
            hostname: 'prod-1',
            version: '1.2.3',
            osType: 'WINDOWS',
            arch: 'amd64',
            ipAddress: '10.0.0.10',
            osVersion: '10.0.20348',
          },
        },
        latestHeartbeat: {
          receivedAt: '2026-06-21T00:30:00.000Z',
        },
        capabilitySnapshot: {
          compatibilityLevel: 'L1',
          capabilities: [
            {
              capabilityKey: 'windows.os.detail',
              value: {
                ProductName: 'Windows Server 2022 Standard',
                Version: '10.0.20348',
                BuildRevision: '20348.2762',
              },
            },
          ],
        },
      },
      requestId: 'req_agent_detail_no_iis',
      timestamp: '2026-06-21T00:00:00.000Z',
    })

    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()

    await detailButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('概览')
    expect(wrapper.text()).toContain('Windows Server 2022 Standard')
    expect(wrapper.text()).not.toContain('IIS 概况')
    expect(wrapper.findAll('button').some((button) => button.text() === 'IIS')).toBe(false)
  })

  it('兼容 Go Agent 上报的小写 IIS 字段，并显示 IIS 标签与站点列表', async () => {
    apiMocks.getAgentDetail.mockResolvedValueOnce({
      data: {
        agent: {
          id: 'agt-1',
          agentKey: 'agent-prod-1',
          status: 'ONLINE',
          role: 'full_agent',
          zone: 'default',
          descriptor: {
            hostname: 'prod-1',
            version: '1.2.3',
            osType: 'WINDOWS',
            arch: 'amd64',
            ipAddress: '10.0.0.10',
            osVersion: '10.0.20348',
          },
        },
        latestHeartbeat: {
          receivedAt: '2026-06-21T00:30:00.000Z',
        },
        capabilitySnapshot: {
          compatibilityLevel: 'L1',
          capabilities: [
            {
              capabilityKey: 'windows.os.detail',
              value: {
                productName: 'Windows Server 2022 Standard',
                version: '10.0.20348',
                buildRevision: '20348.2762',
              },
            },
            {
              capabilityKey: 'windows.iis.detail',
              value: {
                installed: true,
                versionString: 'Version 10.0',
                sites: [
                  {
                    id: 1,
                    name: 'Default Web Site',
                  },
                ],
              },
            },
            {
              capabilityKey: 'windows.iis.sites',
              value: [
                {
                  id: 1,
                  name: 'Default Web Site',
                  physicalPath: 'C:\\inetpub\\wwwroot',
                  bindings: [
                    {
                      protocol: 'https',
                      port: 443,
                      certificate: {
                        subject: 'CN=portal.example.com',
                        issuer: 'CN=GCAC Test CA',
                        notBefore: '2026-01-01T00:00:00.000Z',
                        notAfter: '2027-01-01T00:00:00.000Z',
                        thumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
                        storeName: 'My',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      requestId: 'req_agent_detail_iis_lowercase',
      timestamp: '2026-06-21T00:00:00.000Z',
    })

    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()

    await detailButton!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('IIS')

    const iisTab = wrapper.findAll('button').find((button) => button.text() === 'IIS')
    expect(iisTab).toBeTruthy()
    await iisTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('IIS 概况')
    expect(wrapper.text()).toContain('站点数量')
    expect(wrapper.text()).toContain('Default Web Site')
    expect(wrapper.text()).toContain('C:\\inetpub\\wwwroot')
    expect(wrapper.text()).toContain('CN=portal.example.com')
  })

  it('站点证书不在本项目中时，退回显示简单证书详情', async () => {
    apiMocks.listCertificateVersions.mockResolvedValueOnce({
      data: {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      },
      requestId: 'req_certificate_versions_empty',
      timestamp: '2026-06-21T00:00:00.000Z',
    })

    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()

    const iisTab = wrapper.findAll('button').find((button) => button.text() === 'IIS')
    expect(iisTab).toBeTruthy()
    await iisTab!.trigger('click')
    await flushPromises()

    const bindingCard = wrapper.findAll('.agent-detail-modal__binding-chip').find((item) => item.text().includes('HTTPS:443'))
    expect(bindingCard).toBeTruthy()
    await bindingCard!.trigger('click')
    await flushPromises()

    expect(apiMocks.listCertificateVersions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
    })
    expect(routerPush).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('证书详情')
    expect(wrapper.text()).toContain('证书名称')
    expect(wrapper.text()).toContain('颁发者')
    expect(wrapper.text()).toContain('开始时间')
    expect(wrapper.text()).toContain('到期时间')
    expect(wrapper.text()).toContain('CN=GCAC Test CA')
    expect(wrapper.text()).toContain('本项目中未找到对应证书资产')
  })
})
