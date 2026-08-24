<script setup lang="ts">
import { computed, ref } from 'vue'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { createLinuxGoInstallSession, createWindowsPowerShellInstallSession, disableAgent, listAgents } from '@/api/modules/assets.api'

type InstallPlatform = 'linux_go_systemd' | 'windows_powershell_service'

interface InstallSessionView {
  readonly platform: InstallPlatform
  readonly bootstrapTokenPreview: string
  readonly zone: string
  readonly expiresAt: string
  readonly installCommand: string
  readonly bootstrapUrl: string
  readonly serviceName: string
  readonly installRoot: string
  readonly displayName: string
  readonly agentKey: string
}

const selectedPlatform = ref<InstallPlatform>('linux_go_systemd')
const installSession = ref<InstallSessionView | null>(null)
const copiedText = ref<'token' | 'command' | null>(null)

const installCommand = computed(() => installSession.value?.installCommand ?? '')

const platformOptions: Array<{ value: InstallPlatform; label: string; description: string }> = [
  {
    value: 'linux_go_systemd',
    label: 'Linux systemd',
    description: 'Ubuntu / Debian / CentOS / Rocky / AlmaLinux 等多数 Linux 发行版',
  },
  {
    value: 'windows_powershell_service',
    label: 'Windows PowerShell',
    description: 'Windows Server / Windows 10+，通过 PowerShell 安装为服务',
  },
]

async function generateInstallCommand() {
  const result = selectedPlatform.value === 'linux_go_systemd'
    ? await createLinuxGoInstallSession({ zone: 'default' })
    : await createWindowsPowerShellInstallSession({ zone: 'default', startAfterInstall: true })

  const data = result.data
  if (!data || typeof data.installCommand !== 'string') {
    throw new Error('后端没有返回安装命令')
  }

  const rawBootstrapUrl = typeof data.bootstrapUrl === 'string' ? data.bootstrapUrl : ''
  const bootstrapUrl = rewriteInstallUrlWithBrowserOrigin(rawBootstrapUrl)

  installSession.value = {
    platform: selectedPlatform.value,
    bootstrapTokenPreview: typeof data.bootstrapTokenPreview === 'string' ? data.bootstrapTokenPreview : '',
    zone: typeof data.zone === 'string' ? data.zone : 'default',
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : '',
    installCommand: buildInstallCommand(selectedPlatform.value, bootstrapUrl, data.installCommand),
    bootstrapUrl,
    serviceName: typeof data.serviceName === 'string' ? data.serviceName : '',
    installRoot: typeof data.installRoot === 'string' ? data.installRoot : '',
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    agentKey: typeof data.agentKey === 'string' ? data.agentKey : '',
  }
  copiedText.value = null
}

async function copyToken() {
  const token = installSession.value?.bootstrapTokenPreview
  if (!token) return
  await navigator.clipboard.writeText(token)
  copiedText.value = 'token'
}

async function copyInstallCommand() {
  if (!installCommand.value) return
  await navigator.clipboard.writeText(installCommand.value)
  copiedText.value = 'command'
}

function rewriteInstallUrlWithBrowserOrigin(rawUrl: string): string {
  if (!rawUrl) return ''
  if (typeof window === 'undefined' || !window.location?.origin) return rawUrl

  try {
    const parsed = new URL(rawUrl, window.location.origin)
    return `${window.location.origin}${parsed.pathname}${parsed.search}`
  } catch {
    return rawUrl
  }
}

function buildInstallCommand(platform: InstallPlatform, bootstrapUrl: string, fallbackCommand: string): string {
  if (!bootstrapUrl) return fallbackCommand
  if (platform === 'linux_go_systemd') {
    return `curl -fsSL '${bootstrapUrl}' | sudo bash`
  }
  return `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm '${bootstrapUrl}' | iex"`
}

const config: BusinessPageConfig = {
  title: 'Agent',
  description: '查看 Agent 列表，并为不同平台生成安装命令。',
  readPermission: 'agent.read',
  primaryPermission: 'agent.write',
  primaryActionLabel: '生成安装命令',
  primaryAction: generateInstallCommand,
  moduleName: 'agents',
  resourceName: 'Agent',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  columns: [
    { key: 'name', title: 'Agent 名称', candidates: ['name', 'hostname', 'agentKey', 'descriptor.hostname'] },
    { key: 'status', title: '在线状态', candidates: ['status', 'state'] },
    { key: 'role', title: '角色', candidates: ['role', 'agentRole'] },
    { key: 'version', title: '版本', candidates: ['descriptor.version', 'version'] },
    { key: 'lastSeenAt', title: '最近心跳', candidates: ['lastSeenAt', 'updatedAt', 'registeredAt'], kind: 'date' },
  ],
  detailFields: [
    { label: 'Agent ID', candidates: ['id', 'agentId'] },
    { label: '版本', candidates: ['descriptor.version', 'version'] },
    { label: '系统', candidates: ['descriptor.osType', 'osType', 'platform'] },
    { label: '架构', candidates: ['descriptor.arch', 'arch'] },
    { label: '角色', candidates: ['role', 'agentRole'] },
    { label: '区域', candidates: ['zone', 'zoneId'] },
    { label: '最近心跳', candidates: ['lastSeenAt', 'updatedAt', 'registeredAt'] },
  ],
  metrics: [
    { title: 'Agent 总数', description: '当前已经注册到控制面的 Agent 总量。', status: 'ONLINE', risk: 'MEDIUM' },
    { title: '待处理风险', description: '离线、失败或漂移状态的 Agent 需要优先处理。', status: 'OFFLINE', risk: 'HIGH' },
  ],
  emptyTitle: '暂无 Agent',
  emptyDescription: '从这里选择平台并生成安装命令，不再提供单独的公开安装页面。',
  load: () => listAgents({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  actions: [
    {
      label: '禁用 Agent',
      permission: 'agent.write',
      danger: true,
      confirmText: 'DISABLE',
      riskText: '禁用后该 Agent 将停止接收任务。',
      requiresSelection: true,
      run: (row) => disableAgent(row?.id ? String(row.id) : '', { dryRun: true }),
    },
  ],
}
</script>

<template>
  <BusinessResourcePage :config="config">
    <template #after-header>
      <section class="agent-install-entry gc-card">
        <div class="agent-install-entry__header">
          <div>
            <p class="agent-install-entry__eyebrow">Agent 安装</p>
            <h2>选择平台并生成安装命令</h2>
            <p class="agent-install-entry__text">
              安装入口统一收敛到当前 Agent 页面。安装码为 8 位短码，10 分钟内有效，并且只能使用一次。
            </p>
          </div>
        </div>

        <div class="agent-install-entry__platforms">
          <button
            v-for="option in platformOptions"
            :key="option.value"
            class="agent-install-entry__platform"
            :data-active="selectedPlatform === option.value"
            type="button"
            @click="selectedPlatform = option.value"
          >
            <strong>{{ option.label }}</strong>
            <span>{{ option.description }}</span>
          </button>
        </div>
      </section>

      <section v-if="installSession" class="agent-install-session gc-card" aria-label="安装会话">
        <header>
          <div>
            <p class="agent-install-session__eyebrow">一次性安装会话</p>
            <h2>{{ installSession.displayName || installSession.serviceName }}</h2>
          </div>
        </header>

        <dl class="agent-install-session__meta">
          <div>
            <dt>平台</dt>
            <dd>{{ installSession.platform === 'linux_go_systemd' ? 'Linux systemd' : 'Windows PowerShell' }}</dd>
          </div>
          <div>
            <dt>安装码</dt>
            <dd>{{ installSession.bootstrapTokenPreview }}</dd>
          </div>
          <div>
            <dt>区域</dt>
            <dd>{{ installSession.zone }}</dd>
          </div>
          <div>
            <dt>Agent Key</dt>
            <dd>{{ installSession.agentKey }}</dd>
          </div>
          <div>
            <dt>服务名</dt>
            <dd>{{ installSession.serviceName }}</dd>
          </div>
          <div>
            <dt>安装目录</dt>
            <dd>{{ installSession.installRoot }}</dd>
          </div>
          <div>
            <dt>过期时间</dt>
            <dd>{{ installSession.expiresAt }}</dd>
          </div>
          <div>
            <dt>Bootstrap 地址</dt>
            <dd>{{ installSession.bootstrapUrl }}</dd>
          </div>
        </dl>

        <label class="agent-install-session__field">
          <span>安装命令</span>
          <textarea readonly :value="installCommand" rows="3" />
        </label>

        <p class="agent-install-session__hint">
          同一个安装码一旦被请求 bootstrap 脚本，就会立即失效，不能重复使用。
        </p>

        <footer class="agent-install-session__actions">
          <button class="gc-button" type="button" @click="copyToken">复制安装码</button>
          <button class="gc-button" type="button" @click="copyInstallCommand">复制安装命令</button>
          <span v-if="copiedText === 'token'">安装码已复制</span>
          <span v-else-if="copiedText === 'command'">安装命令已复制</span>
        </footer>
      </section>
    </template>
  </BusinessResourcePage>
</template>

<style scoped>
.agent-install-entry,
.agent-install-session {
  display: grid;
  gap: var(--gc-space-4);
  padding: 24px;
}

.agent-install-entry {
  border-color: #dbeafe;
  background: linear-gradient(135deg, #eff6ff, #ffffff);
}

.agent-install-entry__header {
  display: grid;
  gap: 10px;
}

.agent-install-entry__eyebrow,
.agent-install-session__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-install-entry h2,
.agent-install-session h2,
.agent-install-entry p,
.agent-install-session p {
  margin: 0;
}

.agent-install-entry__text,
.agent-install-session__hint {
  color: var(--gc-color-text-muted);
  line-height: 1.6;
  font-weight: 650;
}

.agent-install-entry__platforms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}

.agent-install-entry__platform {
  display: grid;
  gap: 6px;
  text-align: left;
  border: 1px solid var(--gc-color-border);
  border-radius: 18px;
  padding: 16px;
  background: #fff;
  cursor: pointer;
}

.agent-install-entry__platform[data-active='true'] {
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgb(96 165 250 / 12%);
  background: linear-gradient(135deg, #eff6ff, #ffffff);
}

.agent-install-entry__platform strong {
  color: #0f172a;
  font-size: 16px;
}

.agent-install-entry__platform span {
  color: var(--gc-color-text-muted);
  line-height: 1.5;
  font-weight: 650;
}

.agent-install-session__meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.agent-install-session__meta dt {
  margin-bottom: 4px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.agent-install-session__meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-weight: 800;
}

.agent-install-session__field {
  display: grid;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-weight: 850;
}

.agent-install-session__field textarea {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--gc-color-border);
  border-radius: 14px;
  padding: 12px;
  color: #0f172a;
  background: #fff;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  resize: vertical;
}

.agent-install-session__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gc-space-2);
  align-items: center;
}

.agent-install-session__actions span {
  color: var(--gc-color-success);
  font-weight: 850;
}
</style>
