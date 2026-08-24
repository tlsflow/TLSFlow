<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { GcModal } from '@/design-system/components'
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

const installModalOpen = ref(false)
const selectedPlatform = ref<InstallPlatform>('linux_go_systemd')
const selectedVersion = ref<string>('latest')
const installSession = ref<InstallSessionView | null>(null)
const copiedText = ref<'token' | 'command' | null>(null)
const installPending = ref(false)
const installError = ref('')
const now = ref(Date.now())

const VERSION_OPTIONS = [
  { value: 'latest', label: '最新稳定版' },
  { value: '1.2.0', label: '1.2.0' },
  { value: '1.1.0', label: '1.1.0' },
] as const

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

// ====== Token 剩余有效期倒计时 ======
const expiresAtMs = computed(() =>
  installSession.value?.expiresAt ? Date.parse(installSession.value.expiresAt) : 0,
)

const remainingSeconds = computed(() => {
  if (!expiresAtMs.value) return 0
  return Math.max(0, Math.floor((expiresAtMs.value - now.value) / 1000))
})

const remainingLabel = computed(() => {
  const seconds = remainingSeconds.value
  if (seconds <= 0) return '已过期'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}分${String(rest).padStart(2, '0')}秒`
})

const isExpired = computed(() => remainingSeconds.value <= 0)

let countdownTimer: ReturnType<typeof setInterval> | null = null

function ensureCountdown() {
  if (countdownTimer) return
  now.value = Date.now()
  countdownTimer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

// 仅在「模态框打开 && 已有 session」时跑 interval，关闭或卸载时立即停掉，避免泄漏
watch(
  () => installModalOpen.value && installSession.value !== null,
  (active) => {
    if (active) ensureCountdown()
    else stopCountdown()
  },
)

onBeforeUnmount(stopCountdown)

// ====== 模态框开关 ======
function openInstallModal() {
  installModalOpen.value = true
}

function closeInstallModal() {
  if (installPending.value) return
  installModalOpen.value = false
}

// ====== 生成安装命令（复用原有 URL 重写 + 命令拼装逻辑） ======
async function generateInstallCommand() {
  installPending.value = true
  installError.value = ''
  try {
    const version = selectedVersion.value
    const result = selectedPlatform.value === 'linux_go_systemd'
      ? await createLinuxGoInstallSession({ zone: 'default', version })
      : await createWindowsPowerShellInstallSession({ zone: 'default', startAfterInstall: true, version })

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
    ensureCountdown()
  } catch (cause) {
    installError.value = cause instanceof Error ? cause.message : '生成安装命令失败'
  } finally {
    installPending.value = false
  }
}

// 优先使用 Clipboard API（需要 secure context：HTTPS 或 localhost），
// 不满足时降级为 textarea + execCommand('copy')，兼容内网 HTTP 部署场景。
async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 继续走降级路径
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

async function copyToken() {
  const token = installSession.value?.bootstrapTokenPreview
  if (!token) return
  const ok = await copyToClipboard(token)
  if (ok) copiedText.value = 'token'
}

async function copyInstallCommand() {
  if (!installCommand.value) return
  const ok = await copyToClipboard(installCommand.value)
  if (ok) copiedText.value = 'command'
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
  primaryActionLabel: '安装Agent',
  primaryAction: openInstallModal,
  moduleName: 'agents',
  resourceName: 'Agent',
  defaultStatus: 'ONLINE',
  defaultRisk: 'MEDIUM',
  showMetrics: false,
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
  emptyDescription: '点击右上角"安装Agent"，选择平台与版本生成一次性安装命令。',
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
  <BusinessResourcePage :config="config" />

  <GcModal
    v-model:open="installModalOpen"
    title="安装 Agent"
    description="选择平台与版本，生成一次性安装命令。安装码 10 分钟内有效，且只能使用一次。"
    size="lg"
    :close-on-backdrop="false"
    width="60vw"
  >
    <section class="agent-install-modal">
      <div class="agent-install-modal__field">
        <p class="agent-install-modal__label">平台</p>
        <div class="agent-install-modal__platforms">
          <button
            v-for="option in platformOptions"
            :key="option.value"
            class="agent-install-modal__platform"
            :data-active="selectedPlatform === option.value"
            type="button"
            @click="selectedPlatform = option.value"
          >
            <strong>{{ option.label }}</strong>
            <span>{{ option.description }}</span>
          </button>
        </div>
      </div>

      <div class="agent-install-modal__field">
        <label class="agent-install-modal__label" for="agent-version">版本</label>
        <select id="agent-version" v-model="selectedVersion">
          <option v-for="opt in VERSION_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>

      <div class="agent-install-modal__actions-top">
        <button
          class="gc-button agent-install-modal__primary"
          type="button"
          :disabled="installPending"
          @click="generateInstallCommand"
        >
          {{ installPending ? '生成中…' : '生成安装命令' }}
        </button>
      </div>

      <p v-if="installError" class="agent-install-modal__error">{{ installError }}</p>

      <div v-if="installSession" class="agent-install-modal__result">
        <dl class="agent-install-modal__meta">
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
            <dt>剩余有效期</dt>
            <dd>
              <span :class="{ 'agent-install-modal__expired': isExpired }">{{ remainingLabel }}</span>
            </dd>
          </div>
        </dl>

        <label class="agent-install-modal__field">
          <span class="agent-install-modal__label">安装命令</span>
          <textarea readonly :value="installCommand" rows="3" />
        </label>

        <p class="agent-install-modal__hint">
          同一个安装码一旦被请求 bootstrap 脚本，就会立即失效，不能重复使用。
        </p>

        <p v-if="copiedText" class="agent-install-modal__copied">
          {{ copiedText === 'token' ? '安装码已复制' : '安装命令已复制' }}
        </p>
      </div>
    </section>

    <template #actions>
      <button class="gc-button" type="button" :disabled="installPending" @click="closeInstallModal">关闭</button>
      <button
        v-if="installSession"
        class="gc-button"
        type="button"
        @click="copyToken"
      >复制安装码</button>
      <button
        v-if="installSession"
        class="gc-button agent-install-modal__primary"
        type="button"
        :disabled="!installCommand"
        @click="copyInstallCommand"
      >复制安装命令</button>
    </template>
  </GcModal>
</template>

<style scoped>
.agent-install-modal {
  display: grid;
  gap: var(--gc-space-4);
}

.agent-install-modal__field {
  display: grid;
  gap: var(--gc-space-2);
  color: var(--gc-color-text-muted);
  font-weight: 850;
}

.agent-install-modal__label {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.agent-install-modal__platforms {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}

.agent-install-modal__platform {
  display: grid;
  gap: 6px;
  text-align: left;
  border: 1px solid var(--gc-color-border);
  border-radius: 18px;
  padding: 16px;
  background: #fff;
  cursor: pointer;
}

.agent-install-modal__platform[data-active='true'] {
  border-color: #60a5fa;
  box-shadow: 0 0 0 4px rgb(96 165 250 / 12%);
  background: linear-gradient(135deg, #eff6ff, #ffffff);
}

.agent-install-modal__platform strong {
  color: #0f172a;
  font-size: 16px;
}

.agent-install-modal__platform span {
  color: var(--gc-color-text-muted);
  line-height: 1.5;
  font-weight: 650;
}

.agent-install-modal__field select {
  width: 100%;
  border: 1px solid var(--gc-color-border);
  border-radius: 11px;
  padding: 9px 11px;
  color: var(--gc-color-text);
  background: #fff;
  font: inherit;
}

.agent-install-modal__actions-top {
  display: flex;
}

.agent-install-modal__primary {
  border-color: var(--gc-color-primary);
  background: var(--gc-color-primary);
  color: #fff;
}

.agent-install-modal__primary:hover:not(:disabled),
.agent-install-modal__primary:focus-visible:not(:disabled) {
  border-color: var(--gc-color-primary-hover);
  background: var(--gc-color-primary-hover);
  color: #fff;
}

.agent-install-modal__error {
  margin: 0;
  border: 1px solid #fecaca;
  border-radius: 14px;
  padding: 10px 12px;
  color: var(--gc-color-danger);
  background: var(--gc-color-danger-bg);
  font-weight: 750;
}

.agent-install-modal__result {
  display: grid;
  gap: var(--gc-space-3);
  border-top: 1px dashed var(--gc-color-border);
  padding-top: var(--gc-space-3);
}

.agent-install-modal__meta {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--gc-space-3);
  margin: 0;
}

.agent-install-modal__meta dt {
  margin-bottom: 4px;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-xs);
  font-weight: 850;
}

.agent-install-modal__meta dd {
  margin: 0;
  overflow-wrap: anywhere;
  font-weight: 800;
}

.agent-install-modal__expired {
  color: var(--gc-color-danger);
}

.agent-install-modal__field textarea {
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

.agent-install-modal__hint {
  margin: 0;
  color: var(--gc-color-text-muted);
  line-height: 1.6;
  font-weight: 650;
}

.agent-install-modal__copied {
  margin: 0;
  color: var(--gc-color-success);
  font-size: var(--gc-font-size-xs);
  font-weight: 700;
}
</style>
