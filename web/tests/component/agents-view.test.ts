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

// GcModal 用 <Teleport to="body">，必须 stub 才能在 wrapper 里 find 模态框内容
const mountOptions = {
  global: {
    stubs: { teleport: true, Teleport: true }
  }
} as const

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
        bootstrapTokenPreview: 'linux-preview',
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
        bootstrapTokenPreview: 'secret-token-preview',
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

  it('主按钮文案为"安装Agent"，点击后打开模态框且不会立即调用后端', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
    expect(primaryButton).toBeTruthy()

    await primaryButton!.trigger('click')
    await flushPromises()

    // 打开模态框不会立即调用安装会话 API
    expect(apiMocks.createLinuxGoInstallSession).not.toHaveBeenCalled()
    expect(apiMocks.createWindowsPowerShellInstallSession).not.toHaveBeenCalled()

    // 模态框内有"生成安装命令"按钮
    const generateButton = wrapper.findAll('button').find((button) => button.text().includes('生成安装命令'))
    expect(generateButton).toBeTruthy()
  })

  it('默认 Linux + latest 生成安装命令时，payload 携带 version 且 URL 被重写为浏览器 origin', async () => {
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
    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      `curl -fsSL 'https://portal.example.com/api/v1/agents/install/linux/bootstrap.sh?token=linux' | sudo bash`
    )
  })

  it('选择 Windows 平台和指定版本后生成安装命令，调用 Windows 接口并携带 version', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    // 打开模态框
    const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
    await primaryButton!.trigger('click')
    await flushPromises()

    // 切到 Windows
    const windowsButton = wrapper.findAll('button').find((button) => button.text().includes('Windows PowerShell'))
    expect(windowsButton).toBeTruthy()
    await windowsButton!.trigger('click')

    // 选 1.2.0
    const versionSelect = wrapper.find('select#agent-version')
    expect(versionSelect.exists()).toBe(true)
    await versionSelect.setValue('1.2.0')

    // 生成
    const generateButton = wrapper.findAll('button').find((button) => button.text().includes('生成安装命令'))
    await generateButton!.trigger('click')
    await flushPromises()

    expect(apiMocks.createWindowsPowerShellInstallSession).toHaveBeenCalledWith({
      zone: 'default',
      startAfterInstall: true,
      version: '1.2.0'
    })

    const textarea = wrapper.find('textarea')
    expect((textarea.element as HTMLTextAreaElement).value).toBe(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://portal.example.com/api/v1/agents/install/windows/bootstrap.ps1?token=abc' | iex"`
    )
  })

  it('复制安装命令时，写入剪贴板的是重写为浏览器 origin 后的命令', async () => {
    const wrapper = mount(AgentsView, mountOptions)
    await flushPromises()

    // 打开模态框，选 Windows，生成
    const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
    await primaryButton!.trigger('click')
    await flushPromises()

    const windowsButton = wrapper.findAll('button').find((button) => button.text().includes('Windows PowerShell'))
    await windowsButton!.trigger('click')

    const generateButton = wrapper.findAll('button').find((button) => button.text().includes('生成安装命令'))
    await generateButton!.trigger('click')
    await flushPromises()

    const copyCommandButton = wrapper.findAll('button').find((button) => button.text().includes('复制安装命令'))
    expect(copyCommandButton).toBeTruthy()
    await copyCommandButton!.trigger('click')

    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm 'https://portal.example.com/api/v1/agents/install/windows/bootstrap.ps1?token=abc' | iex"`
    )
  })

  it('生成后显示 token 剩余有效期倒计时，过期后显示"已过期"', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-21T00:55:00.000Z'))

    try {
      const wrapper = mount(AgentsView, mountOptions)
      await flushPromises()

      // 打开模态框并生成（mock expiresAt 为 01:00:00Z，还剩 5 分钟）
      const primaryButton = wrapper.findAll('button').find((button) => button.text().includes('安装Agent'))
      await primaryButton!.trigger('click')
      await flushPromises()

      const generateButton = wrapper.findAll('button').find((button) => button.text().includes('生成安装命令'))
      await generateButton!.trigger('click')
      await flushPromises()

      expect(wrapper.text()).toContain('5分00秒')

      // 推进 3 分钟
      vi.advanceTimersByTime(3 * 60 * 1000)
      await flushPromises()
      expect(wrapper.text()).toContain('2分00秒')

      // 再推进 3 分钟，超过过期时间
      vi.advanceTimersByTime(3 * 60 * 1000)
      await flushPromises()
      expect(wrapper.text()).toContain('已过期')
    } finally {
      vi.useRealTimers()
    }
  })
})
