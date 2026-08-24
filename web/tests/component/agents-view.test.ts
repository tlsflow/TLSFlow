import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AgentsView from '@/views/agents/AgentsView.vue'
import { i18n } from '@/i18n'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  getAgentDetail: vi.fn(),
  createLinuxGoInstallSession: vi.fn(),
  createWindowsCompatibilityInstallSession: vi.fn(),
  createWindowsPowerShellInstallSession: vi.fn(),
  requestAgentCapabilityRescan: vi.fn(),
  disableAgent: vi.fn(),
  enableAgent: vi.fn(),
  deleteAgent: vi.fn(),
  listCertificateVersions: vi.fn(),
  getCertificateAssetDetail: vi.fn(),
  getCertificateVersionDetail: vi.fn(),
  getCertificateVersionUsage: vi.fn(),
}))

vi.mock('@/api/modules/assets.api', () => ({
  listAgents: apiMocks.listAgents,
  getAgentDetail: apiMocks.getAgentDetail,
  createLinuxGoInstallSession: apiMocks.createLinuxGoInstallSession,
  createWindowsCompatibilityInstallSession: apiMocks.createWindowsCompatibilityInstallSession,
  createWindowsPowerShellInstallSession: apiMocks.createWindowsPowerShellInstallSession,
  requestAgentCapabilityRescan: apiMocks.requestAgentCapabilityRescan,
  disableAgent: apiMocks.disableAgent,
  enableAgent: apiMocks.enableAgent,
  deleteAgent: apiMocks.deleteAgent,
}))

vi.mock('@/api/modules/certificates.api', () => ({
  listCertificateVersions: apiMocks.listCertificateVersions,
  getCertificateAssetDetail: apiMocks.getCertificateAssetDetail,
  getCertificateVersionDetail: apiMocks.getCertificateVersionDetail,
  getCertificateVersionUsage: apiMocks.getCertificateVersionUsage,
}))

const mountOptions = {
  global: {
    plugins: [i18n],
    stubs: { teleport: true, Teleport: true },
  },
}

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_agents',
    timestamp: '2026-06-21T00:00:00.000Z',
  }
}

describe('AgentsView', () => {
  beforeEach(() => {
    Object.values(apiMocks).forEach((mock) => mock.mockReset())
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
        health: {
          status: 'degraded',
          offline: false,
          offlineTimeoutSeconds: 180,
          lastHeartbeatAt: '2026-06-21T00:30:00.000Z',
          heartbeatAgeSeconds: 12,
          lastRecoveryAt: '2026-06-21T00:28:00.000Z',
          lastTaskPollAt: '2026-06-21T00:29:00.000Z',
          lastTaskResultAt: '2026-06-21T00:29:30.000Z',
          lastSelfCheckAt: '2026-06-21T00:27:00.000Z',
          pendingResultCount: 2,
          recoverableTaskCount: 1,
          lastError: 'network timeout',
          degradedReasons: ['pending_results:2', 'recovery_failures:1'],
          offlineEvidence: [
            'lastHeartbeatAt=2026-06-21T00:30:00.000Z',
            'heartbeatAgeSeconds=12',
            'offlineTimeoutSeconds=180',
          ],
          failureCounts: {
            heartbeat: 0,
            taskPoll: 0,
            recovery: 1,
          },
        },
        lifecycle: {
          canPullTasks: true,
        },
        runtimeLogs: [
          {
            id: 'rtlog-1',
            category: 'manual_rescan',
            level: 'info',
            summary: 'manual capability rescan succeeded',
            emittedAt: '2026-06-21T00:20:00.000Z',
            detail: { taskId: 'agtask-rescan-1', requestedBy: 'ops' },
          },
          {
            id: 'rtlog-2',
            category: 'heartbeat',
            level: 'error',
            summary: 'heartbeat failed',
            emittedAt: '2026-06-21T00:10:00.000Z',
            detail: { error: 'network timeout' },
          },
          {
            id: 'rtlog-3',
            category: 'capability_report',
            level: 'error',
            summary: 'initial capability report failed',
            emittedAt: '2026-06-21T00:05:00.000Z',
            detail: { error: 'control plane unavailable' },
          },
        ],
        recentTaskLogs: [
          {
            id: 'tasklog-1',
            taskId: 'agtask-dryrun-1',
            executionStepId: 'step-dryrun-1',
            emittedAt: '2026-06-21T00:20:00.000Z',
            level: 'info',
            message: 'IIS dry-run preflight succeeded',
            taskType: 'windows.iis.deploy_certificate',
            siteName: 'Default Web Site',
            bindingInformation: '*:443:portal.example.com',
            dryRun: true,
          },
          {
            id: 'tasklog-2',
            taskId: 'agtask-install-1',
            executionStepId: 'step-install-1',
            emittedAt: '2026-06-21T00:18:00.000Z',
            level: 'info',
            message: 'IIS certificate binding updated',
            taskType: 'windows.iis.deploy_certificate',
            siteName: 'Default Web Site',
            bindingInformation: '*:443:portal.example.com',
            dryRun: false,
          },
        ],
        capabilitySnapshot: {
          compatibilityLevel: 'L1',
          reportedAt: '2026-06-21T00:25:00.000Z',
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
                        FingerprintSHA256: '11'.repeat(32),
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
    apiMocks.requestAgentCapabilityRescan.mockResolvedValue({ data: { id: 'agtask-rescan-1', status: 'queued' }, requestId: 'req_rescan', timestamp: '2026-06-21T00:00:00.000Z' })
    apiMocks.listCertificateVersions.mockResolvedValue({
      data: {
        items: [
          {
            id: 'ver-1',
            certificateAssetId: 'cert-1',
            fingerprintSha256: '11'.repeat(32),
            commonName: 'portal.example.com',
            subject: { commonName: 'portal.example.com' },
            sans: ['portal.example.com'],
          },
        ],
        page: 1,
        pageSize: 20,
        total: 1,
      },
      requestId: 'req_certificate_versions',
      timestamp: '2026-06-21T00:00:00.000Z',
    })
    apiMocks.getCertificateAssetDetail.mockResolvedValue({
      data: {
        id: 'cert-1',
        name: 'portal.example.com',
        primaryDomain: 'portal.example.com',
        currentVersionId: 'ver-1',
      },
      requestId: 'req_certificate_asset_detail',
      timestamp: '2026-06-21T00:00:00.000Z',
    })
    apiMocks.getCertificateVersionDetail.mockResolvedValue({
      data: {
        id: 'ver-1',
        certificateAssetId: 'cert-1',
        commonName: 'portal.example.com',
        sans: ['portal.example.com'],
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z',
        fingerprintSha256: '11'.repeat(32),
        chainStatus: 'complete',
        subject: { commonName: 'portal.example.com' },
        issuer: { commonName: 'GCAC Test CA' },
        chainCertificates: [],
      },
      requestId: 'req_certificate_version_detail',
      timestamp: '2026-06-21T00:00:00.000Z',
    })
    apiMocks.getCertificateVersionUsage.mockResolvedValue({
      data: {
        usages: [],
      },
      requestId: 'req_certificate_usage',
      timestamp: '2026-06-21T00:00:00.000Z',
    })
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
    expect(apiMocks.createWindowsCompatibilityInstallSession).not.toHaveBeenCalled()
    expect(apiMocks.createWindowsPowerShellInstallSession).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('生成安装命令')
    expect(wrapper.text()).toContain('Windows Modern Agent')
    expect(wrapper.text()).toContain('Windows Server 2016 及以上')
    expect(wrapper.text()).toContain('Windows Compatibility Agent')
    expect(wrapper.text()).toContain('Windows Server 2008 R2 SP1')
    expect(wrapper.text()).toContain('Windows Server 2012 / 2012 R2')
    expect(wrapper.text()).not.toContain('需要 .NET Framework 4.8')
    expect(wrapper.text()).toContain('Linux 通用 Agent')
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

  it('切换到 Windows Modern Agent 并指定版本后，生成 Go Agent 极简安装命令', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
    await primaryButton!.trigger('click')
    await flushPromises()

    const windowsButton = wrapper.findAll('button').find((button) => button.text().includes('Windows Modern Agent'))
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

  it('选择 Windows Compatibility Agent 时生成独立的兼容版安装命令', async () => {
    apiMocks.createWindowsCompatibilityInstallSession.mockResolvedValue({
      data: {
        platform: 'windows_compatibility_service',
        bootstrapTokenPreview: 'compat-token',
        zone: 'default',
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        bootstrapUrl: 'http://backend.internal/api/v1/agents/install/windows/bootstrap.ps1?token=compat',
        installCommand: 'fallback-compat-command',
      },
    })
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
    await primaryButton!.trigger('click')
    await flushPromises()

    const compatibilityButton = wrapper.findAll('button').find((button) => button.text().includes('Windows Compatibility Agent'))
    expect(compatibilityButton).toBeTruthy()
    await compatibilityButton!.trigger('click')

    const generateButton = wrapper.findAll('button').find((button) => button.text().includes('生成安装命令'))
    await generateButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.createLinuxGoInstallSession).not.toHaveBeenCalled()
    expect(apiMocks.createWindowsPowerShellInstallSession).not.toHaveBeenCalled()
    expect(apiMocks.createWindowsCompatibilityInstallSession).toHaveBeenCalledWith({
      zone: 'default',
      startAfterInstall: true,
      version: 'latest',
    })
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(
      `(New-Object Net.WebClient).DownloadString('https://portal.example.com/api/v1/agents/install/windows/bootstrap.ps1?token=compat') | Invoke-Expression`,
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
    expect(wrapper.text()).toContain('健康与恢复')
    expect(wrapper.text()).toContain('最近心跳')
    expect(wrapper.text()).toContain('最近上报时间')
    expect(wrapper.text()).toContain('2026-06-21 08:29')
    expect(wrapper.text()).toContain('异常摘要')
    expect(wrapper.text()).toContain('pending_results:2')
    expect(wrapper.text()).not.toContain('失败计数')
    expect(wrapper.text()).not.toContain('最近任务拉取')

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

    expect(apiMocks.listCertificateVersions).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('站点绑定证书')
    expect(wrapper.text()).toContain('证书指纹')
    expect(wrapper.text()).toContain('AABBCCDDEEFF00112233445566778899AABBCCDD')
    expect(wrapper.text()).toContain('portal.example.com')
  })

  it('详情页支持发起手动重扫任务', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()

    const rescanButton = wrapper.findAll('button').find((button) => button.text().includes('手动重扫'))
    expect(rescanButton).toBeTruthy()
    expect((rescanButton!.element as HTMLButtonElement).disabled).toBe(false)

    await rescanButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.requestAgentCapabilityRescan).toHaveBeenCalledWith('agt-1')
    expect(wrapper.text()).toContain('已创建手动重扫任务，等待 Agent 拉取执行。')
  })

  it('详情页提供日志标签页，并展示运行日志', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()

    const logTab = wrapper.findAll('button').find((button) => button.text() === '日志')
    expect(logTab).toBeTruthy()
    await logTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('日志概览')
    expect(wrapper.text()).toContain('上次能力上报时间')
    expect(wrapper.text()).toContain('2026-06-21 08:25')
    expect(wrapper.text()).toContain('运行日志')
    expect(wrapper.text()).toContain('IIS dry-run preflight succeeded')
    expect(wrapper.text()).toContain('IIS certificate binding updated')
    expect(wrapper.text()).toContain('windows.iis.deploy_certificate')
    expect(wrapper.text()).toContain('Default Web Site')
  })

  it('不可拉取任务的 Agent 禁用手动重扫按钮', async () => {
    apiMocks.getAgentDetail.mockResolvedValueOnce({
      data: {
        agent: {
          id: 'agt-1',
          agentKey: 'agent-prod-1',
          status: 'OFFLINE',
          role: 'full_agent',
          zone: 'default',
          descriptor: {
            hostname: 'prod-1',
            version: '1.2.3',
            osType: 'LINUX',
            arch: 'amd64',
            ipAddress: '10.0.0.10',
            osVersion: 'Ubuntu 22.04',
          },
        },
        lifecycle: {
          canPullTasks: false,
        },
        latestHeartbeat: {
          receivedAt: '2026-06-21T00:30:00.000Z',
        },
      },
      requestId: 'req_agent_detail_no_pull',
      timestamp: '2026-06-21T00:00:00.000Z',
    })

    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()

    const rescanButton = wrapper.findAll('button').find((button) => button.text().includes('手动重扫'))
    expect(rescanButton).toBeTruthy()
    expect((rescanButton!.element as HTMLButtonElement).disabled).toBe(true)
    expect(rescanButton!.attributes('title')).toContain('当前 Agent 不可拉取任务')
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
        lifecycle: {
          canPullTasks: true,
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
        lifecycle: {
          canPullTasks: true,
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

  it('Linux Go Agent 详情页展示 Nginx、Apache、Tomcat 独立标签页及站点信息', async () => {
    apiMocks.getAgentDetail.mockResolvedValueOnce({
      data: {
        agent: {
          id: 'agt-linux-1',
          agentKey: 'happy',
          status: 'ONLINE',
          role: 'full_agent',
          zone: 'default',
          descriptor: {
            hostname: 'linux-web-01',
            version: '0.1.0',
            osType: 'LINUX',
            arch: 'amd64',
            ipAddress: '10.0.0.21',
            linuxDistribution: 'Ubuntu 24.04.2 LTS',
            osVersion: '24.04',
          },
        },
        latestHeartbeat: {
          receivedAt: '2026-06-30T13:30:00.000Z',
        },
        lifecycle: {
          canPullTasks: true,
        },
        capabilitySnapshot: {
          compatibilityLevel: 'L1',
          reportedAt: '2026-06-30T13:25:00.000Z',
          capabilities: [
            {
              capabilityKey: 'linux.nginx.detail',
              value: {
                installed: true,
                running: true,
                version: '1.24.0',
                binaryPath: '/usr/sbin/nginx',
                configPath: '/etc/nginx/nginx.conf',
                prefix: '/etc/nginx',
                serviceName: 'nginx',
                sites: [
                  {
                    name: 'nginx-main',
                    siteMode: 'static_root',
                    serverNames: ['test.local'],
                    sitePath: '/srv/www/nginx-test',
                    proxyTargets: [],
                    configFiles: ['/etc/nginx/sites-enabled/test.conf'],
                    listen: [
                      {
                        address: '0.0.0.0',
                        port: 443,
                        protocol: 'https',
                        certificateName: 'CN=test.local',
                        certificatePath: '/etc/gcac-test/certs/test.crt',
                        certificateKeyPath: '/etc/gcac-test/certs/test.key',
                        certificate: {
                          subject: 'CN=test.local',
                          issuer: 'CN=GCAC Test CA',
                          notBefore: '2026-06-23T06:40:46.000Z',
                          notAfter: '2027-06-23T06:40:46.000Z',
                          thumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
                          storeName: 'FILE_PATH',
                        },
                      },
                    ],
                  },
                ],
              },
            },
            {
              capabilityKey: 'linux.apache.detail',
              value: {
                installed: true,
                running: true,
                version: '2.4.58',
                binaryPath: '/usr/sbin/apache2ctl',
                serverRoot: '/etc/apache2',
                configPath: '/etc/apache2/apache2.conf',
                serviceName: 'apache2',
                sites: [
                  {
                    name: 'test.local',
                    siteMode: 'static_root',
                    serverNames: ['test.local', 'www.test.local'],
                    sitePath: '/var/www/apache-test',
                    proxyTargets: [],
                    configFiles: ['/etc/apache2/sites-available/gcac-test.conf'],
                    listen: [
                      {
                        address: '*',
                        port: 8444,
                        protocol: 'https',
                        certificateName: 'CN=test.local',
                        certificatePath: '/etc/gcac-test/certs/test.crt',
                        certificateKeyPath: '/etc/gcac-test/certs/test.key',
                      },
                    ],
                  },
                ],
              },
            },
            {
              capabilityKey: 'linux.tomcat.detail',
              value: {
                installed: true,
                running: true,
                version: '9.0.89',
                catalinaHome: '/usr/share/tomcat9',
                catalinaBase: '/var/lib/tomcat9',
                configPath: '/var/lib/tomcat9/conf/server.xml',
                serviceName: 'tomcat',
                connectors: [
                  {
                    address: '0.0.0.0',
                    port: 8445,
                    protocol: 'HTTP/1.1',
                    tls: true,
                    certificateName: 'CN=test.local',
                    certificatePath: '/etc/gcac-test/certs/test.crt',
                    certificateKeyPath: '/etc/gcac-test/certs/test.key',
                    keystorePath: '/var/lib/tomcat9/conf/keystore.jks',
                    certificate: {
                      subject: 'CN=test.local',
                      issuer: 'CN=GCAC Test CA',
                      notBefore: '2026-06-23T06:40:46.000Z',
                      notAfter: '2027-06-23T06:40:46.000Z',
                      thumbprint: '00112233445566778899AABBCCDDEEFF00112233',
                      storeName: '/var/lib/tomcat9/conf/keystore.jks',
                    },
                  },
                ],
                apps: [
                  {
                    contextPath: '/demo',
                    docBase: '/var/lib/tomcat9/webapps/demo',
                    appBase: '/var/lib/tomcat9/webapps',
                  },
                ],
              },
            },
          ],
        },
      },
      requestId: 'req_agent_detail_linux_tabs',
      timestamp: '2026-06-30T13:00:00.000Z',
    })

    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('button').some((button) => button.text() === 'Nginx')).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === 'Apache')).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === 'Tomcat')).toBe(true)

    const nginxTab = wrapper.findAll('button').find((button) => button.text() === 'Nginx')
    expect(nginxTab).toBeTruthy()
    await nginxTab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Nginx 概况')
    expect(wrapper.text()).toContain('Nginx 站点')
    expect(wrapper.text()).toContain('/srv/www/nginx-test')
    expect(wrapper.text()).toContain('/etc/nginx/sites-enabled/test.conf')
    expect(wrapper.text()).toContain('/etc/gcac-test/certs/test.crt')

    const apacheTab = wrapper.findAll('button').find((button) => button.text() === 'Apache')
    expect(apacheTab).toBeTruthy()
    await apacheTab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Apache 概况')
    expect(wrapper.text()).toContain('Apache 站点')
    expect(wrapper.text()).toContain('/var/www/apache-test')
    expect(wrapper.text()).toContain('/etc/apache2/sites-available/gcac-test.conf')
    expect(wrapper.text()).toContain('www.test.local')

    const tomcatTab = wrapper.findAll('button').find((button) => button.text() === 'Tomcat')
    expect(tomcatTab).toBeTruthy()
    await tomcatTab!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Tomcat 概况')
    expect(wrapper.text()).toContain('Tomcat 连接器')
    expect(wrapper.text()).toContain('Tomcat 应用')
    expect(wrapper.text()).toContain('/var/lib/tomcat9/conf/server.xml')
    expect(wrapper.text()).toContain('/var/lib/tomcat9/webapps/demo')
    expect(wrapper.text()).toContain('/var/lib/tomcat9/conf/keystore.jks')
  })

  it('Linux 站点绑定证书支持点击查看详情', async () => {
    apiMocks.listCertificateVersions.mockResolvedValueOnce({
      data: {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      },
      requestId: 'req_linux_certificate_versions_empty',
      timestamp: '2026-07-01T00:00:00.000Z',
    })

    apiMocks.getAgentDetail.mockResolvedValueOnce({
      data: {
        agent: {
          id: 'agt-linux-cert-1',
          agentKey: 'happy',
          status: 'ONLINE',
          role: 'full_agent',
          zone: 'default',
          descriptor: {
            hostname: 'linux-web-01',
            version: '0.1.0',
            osType: 'LINUX',
            arch: 'amd64',
            ipAddress: '10.0.0.21',
            linuxDistribution: 'Ubuntu 24.04.2 LTS',
            osVersion: '24.04',
          },
        },
        latestHeartbeat: {
          receivedAt: '2026-07-01T01:30:00.000Z',
        },
        lifecycle: {
          canPullTasks: true,
        },
        capabilitySnapshot: {
          compatibilityLevel: 'L1',
          capabilities: [
            {
              capabilityKey: 'linux.nginx.detail',
              value: {
                installed: true,
                running: true,
                version: '1.24.0',
                binaryPath: '/usr/sbin/nginx',
                configPath: '/etc/nginx/nginx.conf',
                prefix: '/etc/nginx',
                serviceName: 'nginx',
                sites: [
                  {
                    name: 'test.local',
                    siteMode: 'static_root',
                    serverNames: ['test.local'],
                    sitePath: '/srv/www/nginx-test',
                    configFiles: ['/etc/nginx/sites-enabled/test.conf'],
                    listen: [
                      {
                        address: '0.0.0.0',
                        port: 443,
                        protocol: 'https',
                        certificateName: 'CN=test.local',
                        certificatePath: '/etc/gcac-test/certs/test.crt',
                        certificateKeyPath: '/etc/gcac-test/certs/test.key',
                        certificate: {
                          subject: 'CN=test.local',
                          issuer: 'CN=GCAC Test CA',
                          notBefore: '2026-06-23T06:40:46.000Z',
                          notAfter: '2027-06-23T06:40:46.000Z',
                          thumbprint: 'AABBCCDDEEFF00112233445566778899AABBCCDD',
                          storeName: 'FILE_PATH',
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
      requestId: 'req_linux_binding_certificate',
      timestamp: '2026-07-01T01:00:00.000Z',
    })

    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()

    const nginxTab = wrapper.findAll('button').find((button) => button.text() === 'Nginx')
    expect(nginxTab).toBeTruthy()
    await nginxTab!.trigger('click')
    await flushPromises()

    const bindingCard = wrapper.findAll('.agent-detail-modal__binding-chip').find((item) => item.text().includes('HTTPS:443'))
    expect(bindingCard).toBeTruthy()
    await bindingCard!.trigger('click')
    await flushPromises()

    expect(apiMocks.listCertificateVersions).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('证书详情')
    expect(wrapper.text()).toContain('CN=test.local')
    expect(wrapper.text()).toContain('CN=GCAC Test CA')
    expect(wrapper.text()).toContain('2027-06-23')
    expect(wrapper.text()).toContain('FILE_PATH')
  })

  it('Tomcat TLS 连接器证书支持点击查看详情', async () => {
    apiMocks.listCertificateVersions.mockResolvedValueOnce({
      data: {
        items: [],
        page: 1,
        pageSize: 20,
        total: 0,
      },
      requestId: 'req_tomcat_certificate_versions_empty',
      timestamp: '2026-07-01T00:00:00.000Z',
    })

    apiMocks.getAgentDetail.mockResolvedValueOnce({
      data: {
        agent: {
          id: 'agt-linux-tomcat-cert-1',
          agentKey: 'happy',
          status: 'ONLINE',
          role: 'full_agent',
          zone: 'default',
          descriptor: {
            hostname: 'linux-web-01',
            version: '0.1.0',
            osType: 'LINUX',
            arch: 'amd64',
            ipAddress: '10.0.0.21',
            linuxDistribution: 'Ubuntu 24.04.2 LTS',
            osVersion: '24.04',
          },
        },
        latestHeartbeat: {
          receivedAt: '2026-07-01T01:30:00.000Z',
        },
        lifecycle: {
          canPullTasks: true,
        },
        capabilitySnapshot: {
          compatibilityLevel: 'L1',
          capabilities: [
            {
              capabilityKey: 'linux.tomcat.detail',
              value: {
                installed: true,
                running: true,
                version: '9.0.89',
                catalinaHome: '/usr/share/tomcat9',
                catalinaBase: '/var/lib/tomcat9',
                configPath: '/etc/tomcat9/server.xml',
                serviceName: 'tomcat',
                connectors: [
                  {
                    address: '*',
                    port: 8445,
                    protocol: 'org.apache.coyote.http11.Http11NioProtocol',
                    tls: true,
                    certificateName: 'CN=test.local,OU=QA,O=GCAC,L=Test,ST=Test,C=CN',
                    certificatePath: '/etc/gcac-test/certs/test.crt',
                    certificateKeyPath: '/etc/gcac-test/certs/test.key',
                    keystorePath: '/etc/gcac-test/certs/test.p12',
                    certificate: {
                      subject: 'CN=test.local,OU=QA,O=GCAC,L=Test,ST=Test,C=CN',
                      issuer: 'CN=test.local,OU=QA,O=GCAC,L=Test,ST=Test,C=CN',
                      notBefore: '2026-06-23T06:40:46.000Z',
                      notAfter: '2027-06-23T06:40:46.000Z',
                      thumbprint: 'FFEEDDCCBBAA99887766554433221100FFEEDDCC',
                      storeName: '/etc/gcac-test/certs/test.p12',
                    },
                  },
                ],
                apps: [],
              },
            },
          ],
        },
      },
      requestId: 'req_tomcat_binding_certificate',
      timestamp: '2026-07-01T01:00:00.000Z',
    })

    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const detailButton = wrapper.findAll('button').find((button) => button.text().includes('详情'))
    expect(detailButton).toBeTruthy()
    await detailButton!.trigger('click')
    await flushPromises()

    const tomcatTab = wrapper.findAll('button').find((button) => button.text() === 'Tomcat')
    expect(tomcatTab).toBeTruthy()
    await tomcatTab!.trigger('click')
    await flushPromises()

    const certificateButton = wrapper.findAll('button').find((button) => button.text() === '查看证书')
    expect(certificateButton).toBeTruthy()
    await certificateButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.listCertificateVersions).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('证书详情')
    expect(wrapper.text()).toContain('2027-06-23')
    expect(wrapper.text()).toContain('FFEEDDCCBBAA99887766554433221100FFEEDDCC')
    expect(wrapper.text()).toContain('证书仓库')
    expect(wrapper.text()).toContain('/etc/gcac-test/certs/test.p12')
  })

  it('点击 IIS 站点证书时直接显示 Agent 实际上报的证书详情', async () => {
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

    expect(apiMocks.listCertificateVersions).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('证书详情')
    expect(wrapper.text()).toContain('证书名称')
    expect(wrapper.text()).toContain('颁发者')
    expect(wrapper.text()).toContain('开始时间')
    expect(wrapper.text()).toContain('到期时间')
    expect(wrapper.text()).toContain('CN=GCAC Test CA')
    expect(wrapper.text()).toContain('AABBCCDDEEFF00112233445566778899AABBCCDD')
  })

  it('IIS 证书主题包含 CN 前缀时，也不会按域名自动打开项目最新证书', async () => {
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
        health: {
          status: 'healthy',
          offline: false,
          offlineTimeoutSeconds: 180,
          lastHeartbeatAt: '2026-06-21T00:30:00.000Z',
          heartbeatAgeSeconds: 12,
        },
        lifecycle: {
          canPullTasks: true,
        },
        runtimeLogs: [],
        capabilitySnapshot: {
          compatibilityLevel: 'L1',
          reportedAt: '2026-06-21T00:25:00.000Z',
          capabilities: [
            {
              capabilityKey: 'windows.iis.detail',
              value: {
                Installed: true,
                VersionString: 'Version 10.0',
              },
            },
            {
              capabilityKey: 'windows.iis.sites',
              value: [
                {
                  Name: 'TEST',
                  PhysicalPath: 'C:\\inetpub\\wwwroot',
                  Bindings: [
                    {
                      Protocol: 'https',
                      Port: 4433,
                      Certificate: {
                        Subject: 'CN=*.jacksonz.cn',
                        Issuer: "CN=E2, O=Let's Encrypt, C=US",
                        NotBefore: '2026-06-09T10:18:39.000Z',
                        NotAfter: '2026-09-07T10:18:38.000Z',
                        Thumbprint: '95D9A57D301B626A02B7BEF5E5218D6EAE3A55CA',
                        StoreName: 'My',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      requestId: 'req_agent_detail_iis_cn_prefix',
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

    const bindingCard = wrapper.findAll('.agent-detail-modal__binding-chip').find((item) => item.text().includes('HTTPS:4433'))
    expect(bindingCard).toBeTruthy()
    await bindingCard!.trigger('click')
    await flushPromises()

    expect(apiMocks.listCertificateVersions).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('站点绑定证书')
    expect(wrapper.text()).toContain('CN=*.jacksonz.cn')
    expect(wrapper.text()).toContain('95D9A57D301B626A02B7BEF5E5218D6EAE3A55CA')
  })

  it('关闭本项目证书详情模态框后，仍停留在 Agent 站点详情上下文', async () => {
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

    expect(wrapper.text()).toContain('站点绑定证书')
    const assetDetailButton = wrapper.findAll('button').find((button) => button.text() === '查看本项目证书详情')
    expect(assetDetailButton).toBeTruthy()
    await assetDetailButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.listCertificateVersions).toHaveBeenCalledWith({
      page: 1,
      pageSize: 20,
      keyword: '11'.repeat(32),
    })
    expect(wrapper.text()).toContain('本项目证书详情')
    expect(wrapper.find('.certificate-detail-panel').exists()).toBe(true)
    expect(wrapper.text()).toContain('Agent详情')

    const closeButtons = wrapper.findAll('button').filter((button) => button.text() === '关闭')
    expect(closeButtons.length).toBeGreaterThan(0)
    await closeButtons[closeButtons.length - 1]!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.certificate-detail-panel').exists()).toBe(false)
    expect(wrapper.text()).toContain('Agent详情')
    expect(wrapper.text()).toContain('IIS 概况')
    expect(wrapper.text()).toContain('Default Web Site')
  })

  it('从 Agent 上下文打开证书详情时，关联资产标签页会反向显示当前 IIS 站点', async () => {
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

    const assetDetailButton = wrapper.findAll('button').find((button) => button.text() === '查看本项目证书详情')
    expect(assetDetailButton).toBeTruthy()
    await assetDetailButton!.trigger('click')
    await flushPromises()
    await flushPromises()

    const usageTab = wrapper.findAll('button').find((button) => button.text() === '关联资产')
    expect(usageTab).toBeTruthy()
    await usageTab!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('CN=portal.example.com')
    expect(wrapper.text()).toContain('WINDOWS_CERT_STORE')
    expect(wrapper.text()).toContain('Agent上下文')
    expect(wrapper.text()).toContain('ACTIVE')
  })
})
