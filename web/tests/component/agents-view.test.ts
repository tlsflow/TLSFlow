import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AgentsView from '@/views/agents/AgentsView.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  listAgents: vi.fn(),
  createLinuxGoInstallSession: vi.fn(),
  createWindowsPowerShellInstallSession: vi.fn(),
  disableAgent: vi.fn()
}))

vi.mock('@/api/modules/assets.api', () => ({
  listAgents: apiMocks.listAgents,
  createLinuxGoInstallSession: apiMocks.createLinuxGoInstallSession,
  createWindowsPowerShellInstallSession: apiMocks.createWindowsPowerShellInstallSession,
  disableAgent: apiMocks.disableAgent
}))

function okPage(items: readonly Record<string, unknown>[]) {
  return {
    data: { items, page: 1, pageSize: 20, total: items.length },
    requestId: 'req_agents',
    timestamp: '2026-06-21T00:00:00.000Z'
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
        descriptor: { hostname: 'prod-1', version: '1.2.3', osType: 'windows', arch: 'amd64' },
        status: 'ONLINE',
        role: 'full_agent'
      }
    ]))
    apiMocks.createLinuxGoInstallSession.mockResolvedValue({
      data: {
        enrollmentTokenPreview: 'linux-preview',
        zone: 'default',
        expiresAt: '2026-06-21T01:00:00.000Z',
        installCommand: `curl -fsSL 'http://127.0.0.1:3003/api/v1/agents/install/linux/bootstrap.sh?token=linux' | sudo bash`,
        bootstrapUrl: 'http://127.0.0.1:3003/api/v1/agents/install/linux/bootstrap.sh?token=linux',
        serviceName: 'gcac-linux-agent',
        installRoot: '/opt/gcac/linux-agent',
        displayName: 'GCAC Linux Go Full Agent',
        agentKey: 'linuxgo.agent.test'
      },
      requestId: 'req_linux_install',
      timestamp: '2026-06-21T00:00:00.000Z'
    })
    apiMocks.createWindowsPowerShellInstallSession.mockResolvedValue({
      data: {
        enrollmentToken: 'secret-token',
        enrollmentTokenPreview: 'secret-token-preview',
        zone: 'default',
        expiresAt: '2026-06-21T01:00:00.000Z',
        installCommand: `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'http://127.0.0.1:3003/api/v1/agents/install/windows/bootstrap.ps1?token=abc' | iex"`,
        bootstrapUrl: 'http://127.0.0.1:3003/api/v1/agents/install/windows/bootstrap.ps1?token=abc',
        serviceName: 'gcac-full-agent-ps',
        installRoot: 'C:\\Program Files\\GCAC\\FullAgentPS',
        displayName: 'GCAC PowerShell Full Agent',
        agentKey: 'winps.agent.test'
      },
      requestId: 'req_install',
      timestamp: '2026-06-21T00:00:00.000Z'
    })
    apiMocks.disableAgent.mockResolvedValue({ data: {}, requestId: 'req_disable', timestamp: '2026-06-21T00:00:00.000Z' })
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    })
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        origin: 'https://portal.example.com'
      }
    })
  })

  it('展示并生成 Windows 安装命令时，使用当前浏览器访问 URL', async () => {
    const wrapper = mount(AgentsView)
    await flushPromises()

    expect(wrapper.text()).toContain('Windows PowerShell')
    expect(wrapper.text()).toContain('agt-1')

    const issueButton = wrapper.findAll('button').find((button) => button.text().includes('生成安装命令'))
    expect(issueButton).toBeTruthy()

    await issueButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.createLinuxGoInstallSession).toHaveBeenCalledWith({ zone: 'default' })
    expect(wrapper.text()).toContain('https://portal.example.com/api/v1/agents/install/linux/bootstrap.sh?token=linux')

    const platformButtons = wrapper.findAll('button')
    const windowsButton = platformButtons.find((button) => button.text().includes('Windows PowerShell'))
    expect(windowsButton).toBeTruthy()
    await windowsButton!.trigger('click')

    await issueButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.createWindowsPowerShellInstallSession).toHaveBeenCalledWith({
      zone: 'default',
      startAfterInstall: true
    })
    expect(wrapper.text()).toContain('https://portal.example.com/api/v1/agents/install/windows/bootstrap.ps1?token=abc')

    const textareas = wrapper.findAll('textarea')
    expect((textareas[0].element as HTMLTextAreaElement).value).toContain("powershell -NoProfile -ExecutionPolicy Bypass -Command \"irm 'https://portal.example.com/api/v1/agents/install/windows/bootstrap.ps1?token=abc' | iex\"")
  })

  it('复制安装命令时，使用当前浏览器访问 URL', async () => {
    const wrapper = mount(AgentsView)
    await flushPromises()

    const platformButtons = wrapper.findAll('button')
    const windowsButton = platformButtons.find((button) => button.text().includes('Windows PowerShell'))
    const issueButton = platformButtons.find((button) => button.text().includes('生成安装命令'))
    await windowsButton!.trigger('click')
    await issueButton!.trigger('click')
    await flushPromises()

    const copyCommandButton = wrapper.findAll('button').find((button) => button.text().includes('复制安装命令'))
    expect(copyCommandButton).toBeTruthy()

    await copyCommandButton!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://portal.example.com/api/v1/agents/install/windows/bootstrap.ps1?token=abc' | iex"`
    )
  })
})
