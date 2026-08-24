import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  FullAgentInstallerArtifact,
  FullAgentInstallerBundle,
  FullAgentInstallerOptions,
  FullAgentLifecycleCommands,
  FullAgentLinuxInstallOptions,
  FullAgentWindowsInstallOptions,
  WriteFullAgentInstallerBundleOptions,
  WrittenFullAgentInstallerBundle,
} from './full-agent-installer.types.js';

const DEFAULT_SERVICE_NAME = 'gcac-full-agent';
const DEFAULT_DISPLAY_NAME = 'GCAC Full Agent';
const DEFAULT_NGINX_HELPER_PATH = '/usr/local/libexec/gcac-nginx-helper';

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/u, '');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/gu, "''")}'`;
}

function mergeLinuxOptions(options: FullAgentInstallerOptions): FullAgentLinuxInstallOptions {
  const serviceName = options.serviceName ?? DEFAULT_SERVICE_NAME;
  const installRoot = trimTrailingSlash(options.linux?.installRoot ?? `/opt/gcac/full-agent`);
  const configDir = trimTrailingSlash(options.linux?.configDir ?? `/etc/gcac/full-agent`);
  const dataDir = trimTrailingSlash(options.linux?.dataDir ?? `/var/lib/gcac/full-agent`);
  const logDir = trimTrailingSlash(options.linux?.logDir ?? `/var/log/gcac/full-agent`);
  return {
    serviceName,
    user: options.linux?.user ?? 'gcac-agent',
    group: options.linux?.group ?? 'gcac-agent',
    installRoot,
    binaryPath: options.linux?.binaryPath ?? `${installRoot}/bin/gcac-full-agent`,
    configDir,
    configPath: options.linux?.configPath ?? `${configDir}/agent.config.json`,
    dataDir,
    logDir,
    unitPath: options.linux?.unitPath ?? `/etc/systemd/system/${serviceName}.service`,
  };
}

function mergeWindowsOptions(options: FullAgentInstallerOptions): FullAgentWindowsInstallOptions {
  const serviceName = options.serviceName ?? DEFAULT_SERVICE_NAME;
  const installRoot = trimTrailingSlash(options.windows?.installRoot ?? `C:\\Program Files\\GCAC\\FullAgent`);
  const configDir = trimTrailingSlash(options.windows?.configDir ?? `C:\\ProgramData\\GCAC\\FullAgent`);
  const dataDir = trimTrailingSlash(options.windows?.dataDir ?? `C:\\ProgramData\\GCAC\\FullAgent\\data`);
  const logDir = trimTrailingSlash(options.windows?.logDir ?? `C:\\ProgramData\\GCAC\\FullAgent\\logs`);
  return {
    serviceName,
    displayName: options.displayName ?? options.windows?.displayName ?? DEFAULT_DISPLAY_NAME,
    installRoot,
    binaryPath: options.windows?.binaryPath ?? `${installRoot}\\gcac-full-agent.exe`,
    configDir,
    configPath: options.windows?.configPath ?? `${configDir}\\agent.config.json`,
    dataDir,
    logDir,
  };
}

export function buildLinuxFullAgentCommands(options: FullAgentLinuxInstallOptions): FullAgentLifecycleCommands {
  return {
    selfCheck: `sudo -u ${shellQuote(options.user)} ${shellQuote(options.binaryPath)} self-check --config ${shellQuote(options.configPath)} --json`,
    healthCheck: `${shellQuote(options.binaryPath)} health --config ${shellQuote(options.configPath)} --timeout 5s --json`,
    install: `sudo bash ./linux/install-systemd.sh`,
    uninstall: `sudo bash ./linux/uninstall-systemd.sh`,
    rollbackUninstall: `sudo systemctl disable --now ${shellQuote(options.serviceName)}.service && sudo rm -f ${shellQuote(options.unitPath)} && sudo systemctl daemon-reload`,
    start: `sudo systemctl start ${shellQuote(options.serviceName)}.service`,
    status: `systemctl status ${shellQuote(options.serviceName)}.service --no-pager`,
  };
}

export function buildWindowsFullAgentCommands(options: FullAgentWindowsInstallOptions): FullAgentLifecycleCommands {
  const binary = `& ${psQuote(options.binaryPath)}`;
  return {
    selfCheck: `${binary} self-check --config ${psQuote(options.configPath)} --json`,
    healthCheck: `${binary} health --config ${psQuote(options.configPath)} --timeout 5s --json`,
    install: `powershell -ExecutionPolicy Bypass -File .\\windows\\install-service.ps1`,
    uninstall: `powershell -ExecutionPolicy Bypass -File .\\windows\\uninstall-service.ps1`,
    rollbackUninstall: `powershell -ExecutionPolicy Bypass -Command "Stop-Service -Name '${options.serviceName}' -ErrorAction SilentlyContinue; sc.exe delete '${options.serviceName}'"`,
    start: `Start-Service -Name ${psQuote(options.serviceName)}`,
    status: `Get-Service -Name ${psQuote(options.serviceName)}`,
  };
}

function renderSystemdUnit(options: FullAgentLinuxInstallOptions, description: string): string {
  return `[Unit]
Description=${description}
Documentation=https://gcac.local/docs/full-agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${options.user}
Group=${options.group}
WorkingDirectory=${options.installRoot}
Environment=GCAC_FULL_AGENT_CONFIG=${options.configPath}
ExecStartPre=${options.binaryPath} self-check --config ${options.configPath} --json
ExecStart=${options.binaryPath} run --config ${options.configPath}
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5s
TimeoutStartSec=30s
TimeoutStopSec=30s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=${options.dataDir} ${options.logDir} ${options.configDir}
RuntimeDirectory=${options.serviceName}
RuntimeDirectoryMode=0750
UMask=0027
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

function renderLinuxInstallScript(options: FullAgentLinuxInstallOptions, commands: FullAgentLifecycleCommands): string {
  return `#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME=${shellQuote(options.serviceName)}
SERVICE_USER=${shellQuote(options.user)}
SERVICE_GROUP=${shellQuote(options.group)}
INSTALL_ROOT=${shellQuote(options.installRoot)}
BINARY_PATH=${shellQuote(options.binaryPath)}
CONFIG_DIR=${shellQuote(options.configDir)}
CONFIG_PATH=${shellQuote(options.configPath)}
DATA_DIR=${shellQuote(options.dataDir)}
LOG_DIR=${shellQuote(options.logDir)}
UNIT_PATH=${shellQuote(options.unitPath)}
BUNDLE_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "\${EUID}" -ne 0 ]]; then
  echo "错误：安装 systemd 服务需要 root 权限。请使用 sudo bash ./linux/install-systemd.sh" >&2
  exit 1
fi

if [[ ! -x "\${BINARY_PATH}" ]]; then
  echo "错误：Agent 可执行文件不存在或不可执行：\${BINARY_PATH}" >&2
  echo "提示：先把 gcac-full-agent 二进制放到 \${BINARY_PATH}，并执行 chmod 0755。" >&2
  exit 1
fi

if ! getent group "\${SERVICE_GROUP}" >/dev/null 2>&1; then
  groupadd --system "\${SERVICE_GROUP}"
fi

if ! id -u "\${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --gid "\${SERVICE_GROUP}" --home-dir "\${DATA_DIR}" --shell /usr/sbin/nologin "\${SERVICE_USER}"
fi

install -d -m 0750 -o "\${SERVICE_USER}" -g "\${SERVICE_GROUP}" "\${DATA_DIR}" "\${LOG_DIR}"
install -d -m 0750 -o root -g "\${SERVICE_GROUP}" "\${CONFIG_DIR}"

if [[ ! -f "\${CONFIG_PATH}" ]]; then
  install -m 0640 -o root -g "\${SERVICE_GROUP}" "\${BUNDLE_DIR}/config/agent.config.template.json" "\${CONFIG_PATH}"
  echo "已写入配置模板：\${CONFIG_PATH}"
  echo "请先填入 tenantId、agentKey、controlPlaneUrl，再启动服务。"
fi

install -m 0644 -o root -g root "\${BUNDLE_DIR}/linux/\${SERVICE_NAME}.service" "\${UNIT_PATH}"
systemctl daemon-reload
systemctl enable "\${SERVICE_NAME}.service"

echo "安装完成，但不会自动启动服务。"
echo "自检命令：${commands.selfCheck}"
echo "健康检查命令：${commands.healthCheck}"
echo "启动命令：${commands.start}"
echo "状态命令：${commands.status}"
echo "回滚/卸载命令：${commands.uninstall}"
`;
}

function renderLinuxUninstallScript(options: FullAgentLinuxInstallOptions): string {
  return `#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME=${shellQuote(options.serviceName)}
UNIT_PATH=${shellQuote(options.unitPath)}
CONFIG_DIR=${shellQuote(options.configDir)}
DATA_DIR=${shellQuote(options.dataDir)}
LOG_DIR=${shellQuote(options.logDir)}

if [[ "\${EUID}" -ne 0 ]]; then
  echo "错误：卸载 systemd 服务需要 root 权限。请使用 sudo bash ./linux/uninstall-systemd.sh" >&2
  exit 1
fi

systemctl disable --now "\${SERVICE_NAME}.service" >/dev/null 2>&1 || true
rm -f "\${UNIT_PATH}"
systemctl daemon-reload
systemctl reset-failed "\${SERVICE_NAME}.service" >/dev/null 2>&1 || true

echo "已卸载 systemd 服务：\${SERVICE_NAME}"
echo "安全起见，默认保留配置、数据和日志："
echo "  配置目录：\${CONFIG_DIR}"
echo "  数据目录：\${DATA_DIR}"
echo "  日志目录：\${LOG_DIR}"
echo "如需彻底清理，请人工确认备份后执行：sudo rm -rf '\${CONFIG_DIR}' '\${DATA_DIR}' '\${LOG_DIR}'"
`;
}

function renderLinuxNginxHelperScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail

NGINX_BIN="\${NGINX_BIN:-/usr/sbin/nginx}"
SYSTEMCTL_BIN="\${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
NGINX_SERVICE="\${NGINX_SERVICE:-nginx}"
ACTION="\${1:-}"

case "\${ACTION}" in
  test)
    exec "\${NGINX_BIN}" -t
    ;;
  reload)
    "\${NGINX_BIN}" -t
    exec "\${SYSTEMCTL_BIN}" reload "\${NGINX_SERVICE}"
    ;;
  *)
    echo "用法：$0 {test|reload}" >&2
    exit 64
    ;;
esac
`;
}

function renderLinuxNginxSudoersExample(options: FullAgentLinuxInstallOptions): string {
  return `# /etc/sudoers.d/gcac-nginx
# 目标：只给 ${options.user} 开放 NGINX 换证需要的最小命令，不开放任意 root shell。
#
# 方案 A：直接放行固定命令。
# 前提：站点元数据里的 testCommand / reloadCommand 必须与这里逐字匹配。
Cmnd_Alias GCAC_NGINX_DIRECT = /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx

# 方案 B：放行固定 helper。helper 本身只能接受 test/reload 两个子命令。
# 先把 linux/gcac-nginx-helper.example.sh 安装为 root:root 0755 的 ${DEFAULT_NGINX_HELPER_PATH}
Cmnd_Alias GCAC_NGINX_HELPER = ${DEFAULT_NGINX_HELPER_PATH} test, ${DEFAULT_NGINX_HELPER_PATH} reload

Defaults:${options.user} !requiretty

# 二选一，不要同时开大口子。
${options.user} ALL=(root) NOPASSWD: GCAC_NGINX_DIRECT
# ${options.user} ALL=(root) NOPASSWD: GCAC_NGINX_HELPER
`;
}

function renderWindowsInstallScript(options: FullAgentWindowsInstallOptions, commands: FullAgentLifecycleCommands, description: string): string {
  return `#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ServiceName = ${psQuote(options.serviceName)},
  [string]$DisplayName = ${psQuote(options.displayName)},
  [string]$InstallRoot = ${psQuote(options.installRoot)},
  [string]$ConfigDir = ${psQuote(options.configDir)},
  [string]$DataDir = ${psQuote(options.dataDir)},
  [string]$LogDir = ${psQuote(options.logDir)}
)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw '安装 Windows Service 需要管理员权限。请以管理员身份运行 PowerShell。'
}

$bundleRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$binaryPath = Join-Path $InstallRoot 'gcac-full-agent.exe'
$configPath = Join-Path $ConfigDir 'agent.config.json'
$configTemplate = Join-Path $bundleRoot 'config\\agent.config.template.json'

if (-not (Test-Path $binaryPath)) {
  throw "Agent 可执行文件不存在：$binaryPath。请先复制 gcac-full-agent.exe 到安装目录。"
}

New-Item -ItemType Directory -Force -Path $ConfigDir, $DataDir, $LogDir | Out-Null
if (-not (Test-Path $configPath)) {
  Copy-Item -Path $configTemplate -Destination $configPath
  Write-Host "已写入配置模板：$configPath"
  Write-Host '请先填入 tenantId、agentKey、controlPlaneUrl，再启动服务。'
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $existing) {
  throw "服务已存在：$ServiceName。请先运行 .\\windows\\uninstall-service.ps1 或选择新服务名。"
}

$binaryName = '"' + $binaryPath + '" run --config "' + $configPath + '"'
New-Service -Name $ServiceName -BinaryPathName $binaryName -DisplayName $DisplayName -Description ${psQuote(description)} -StartupType Automatic | Out-Null

Write-Host '安装完成，但不会自动启动服务。'
Write-Host '自检命令：${commands.selfCheck}'
Write-Host '健康检查命令：${commands.healthCheck}'
Write-Host '启动命令：${commands.start}'
Write-Host '状态命令：${commands.status}'
Write-Host '回滚/卸载命令：${commands.uninstall}'
`;
}

function renderWindowsUninstallScript(options: FullAgentWindowsInstallOptions): string {
  return `#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$ServiceName = ${psQuote(options.serviceName)},
  [string]$ConfigDir = ${psQuote(options.configDir)},
  [string]$DataDir = ${psQuote(options.dataDir)},
  [string]$LogDir = ${psQuote(options.logDir)}
)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw '卸载 Windows Service 需要管理员权限。请以管理员身份运行 PowerShell。'
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
  if ($service.Status -ne 'Stopped') {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }
  sc.exe delete $ServiceName | Out-Null
  Write-Host "已删除 Windows Service：$ServiceName"
} else {
  Write-Host "服务不存在，跳过删除：$ServiceName"
}

Write-Host '安全起见，默认保留配置、数据和日志：'
Write-Host "  配置目录：$ConfigDir"
Write-Host "  数据目录：$DataDir"
Write-Host "  日志目录：$LogDir"
Write-Host "如需彻底清理，请人工确认备份后执行：Remove-Item -Recurse -Force '$ConfigDir', '$DataDir', '$LogDir'"
`;
}

function renderConfigTemplate(options: FullAgentInstallerOptions, linux: FullAgentLinuxInstallOptions, windows: FullAgentWindowsInstallOptions): string {
  const template = {
    schemaVersion: 'full-agent.config.v1',
    tenantId: options.tenantIdPlaceholder ?? 'CHANGE_ME_TENANT_ID',
    agentKey: options.agentKeyPlaceholder ?? 'CHANGE_ME_AGENT_KEY',
    controlPlaneUrl: options.controlPlaneUrl ?? 'https://gcac.example.invalid',
    version: options.version ?? '0.1.0',
    dryRunDefault: false,
    heartbeatIntervalSeconds: 30,
    health: {
      bind: '127.0.0.1',
      port: 8708,
      path: '/healthz',
    },
    paths: {
      linux: {
        configPath: linux.configPath,
        dataDir: linux.dataDir,
        logDir: linux.logDir,
      },
      windows: {
        configPath: windows.configPath,
        dataDir: windows.dataDir,
        logDir: windows.logDir,
      },
    },
    security: {
      requireMtls: true,
      redactLogs: true,
      secretCacheTtlSeconds: 0,
      providerPermissionMode: 'deny-by-default',
    },
  };
  return `${JSON.stringify(template, null, 2)}\n`;
}

function renderReadme(bundle: Omit<FullAgentInstallerBundle, 'artifacts'>): string {
  return `# GCAC Full Agent 安装产物

这组文件是可安装工程骨架：它生成真实 systemd unit、Windows Service 安装/卸载脚本、Agent 配置模板、自检和健康检查命令。生成器只写文件，不启动服务。

## Linux systemd

- 安装脚本：\`linux/install-systemd.sh\`
- 卸载脚本：\`linux/uninstall-systemd.sh\`
- Unit 文件：\`linux/${bundle.linux.options.serviceName}.service\`
- 权限要求：安装和卸载必须使用 root 权限。
- 安装命令：\`${bundle.linux.commands.install}\`
- 自检命令：\`${bundle.linux.commands.selfCheck}\`
- 健康检查命令：\`${bundle.linux.commands.healthCheck}\`
- 启动命令：\`${bundle.linux.commands.start}\`
- 回滚/卸载命令：\`${bundle.linux.commands.rollbackUninstall}\`
- NGINX 权限样例：\`linux/gcac-nginx.sudoers.example\`
- NGINX helper 样例：\`linux/gcac-nginx-helper.example.sh\`

## Windows Service

- 安装脚本：\`windows/install-service.ps1\`
- 卸载脚本：\`windows/uninstall-service.ps1\`
- 权限要求：安装和卸载必须以管理员身份运行 PowerShell。
- 安装命令：\`${bundle.windows.commands.install}\`
- 自检命令：\`${bundle.windows.commands.selfCheck}\`
- 健康检查命令：\`${bundle.windows.commands.healthCheck}\`
- 启动命令：\`${bundle.windows.commands.start}\`
- 回滚/卸载命令：\`${bundle.windows.commands.rollbackUninstall}\`

## 配置模板

- 模板路径：\`config/agent.config.template.json\`
- 首次安装会复制为目标配置文件，但不会替你填入真实租户、Agent Key 或控制面地址。
- 填完配置后先运行自检，确认通过后再手工启动服务。

## Linux NGINX 部署权限模型

- \`gcac-agent\` 默认是普通用户。没有目录写权限时，install / rollback 一定失败；没有非交互提权路径时，\`nginx -t\` / reload 一定失败。
- Agent dry-run 会把命令权限分成 \`direct\`、\`sudo-n\`、\`helper-required\`。其中 \`helper-required\` 的真实含义不是“可以忽略”，而是“当前主机还没有可上线的非交互权限路径”。
- 生产上不要继续把目标指到发行版默认私钥目录，再靠逐文件 ACL 打补丁。长期方案是单独规划一个 NGINX 证书部署目录，让 NGINX 配置引用这组路径。

### 推荐目录模型

- 为证书目标路径单独建目录，例如 \`/var/lib/gcac/nginx-certs/<site>\`
- 目录必须允许 Agent 原子写入，也就是父目录可写、可重命名；推荐：
  - \`install -d -m 2770 -o root -g gcac-agent /var/lib/gcac/nginx-certs\`
  - \`install -d -m 2770 -o root -g gcac-agent /var/lib/gcac/nginx-certs/example.com\`
- 不要把 cert/key 落到 Agent 无法写入的系统目录；否则 dry-run 只能报告“父目录不可写/文件不可写”，install 无法自愈。

### 推荐提权策略

1. 受限 sudo：把 \`testCommand\` / \`reloadCommand\` 固定成少量绝对路径命令，并按 \`linux/gcac-nginx.sudoers.example\` 配 sudoers。
2. 受控 helper：如果你们不想直接开放 \`nginx\` 或 \`systemctl\`，把 \`linux/gcac-nginx-helper.example.sh\` 安装到 \`${DEFAULT_NGINX_HELPER_PATH}\`，再只在 sudoers 中放行这个 helper。
3. 当前安装产物不提供独立 root 守护进程。所谓 helper-required，不是自动魔法；你必须先把 sudoers 或 helper 装好，再让站点元数据里的 \`testCommand\` / \`reloadCommand\` 指向它。

### 上线前必须试跑

- 直接命令策略：
  - \`sudo -n /usr/sbin/nginx -t\`
  - \`sudo -n /usr/bin/systemctl reload nginx\`
- helper 策略：
  - \`sudo -n ${DEFAULT_NGINX_HELPER_PATH} test\`
  - \`sudo -n ${DEFAULT_NGINX_HELPER_PATH} reload\`
- 如果以上命令任一失败，控制面现在最多只能把目标分类成 \`helper-required\` 或命令失败，不能替你消除生产权限问题。

## 注意

- 安装脚本只注册服务并设置开机自启，不会自动执行 start。
- 卸载脚本默认保留配置、数据和日志，避免误删本地审计和回滚证据。
- 如果要彻底清理，必须人工确认备份后删除对应目录。
`;
}

export function generateFullAgentInstallerBundle(options: FullAgentInstallerOptions = {}): FullAgentInstallerBundle {
  const serviceName = options.serviceName ?? DEFAULT_SERVICE_NAME;
  const description = options.description ?? 'GCAC Full Agent local execution service';
  const linux = mergeLinuxOptions(options);
  const windows = mergeWindowsOptions(options);
  const linuxCommands = buildLinuxFullAgentCommands(linux);
  const windowsCommands = buildWindowsFullAgentCommands(windows);
  const bundleWithoutArtifacts = {
    serviceName,
    linux: { options: linux, commands: linuxCommands },
    windows: { options: windows, commands: windowsCommands },
    notes: [
      '生成器不会安装、启动或停止服务，只产出可审查文件。',
      'Linux 安装需要 root；Windows 安装需要管理员 PowerShell。',
      '首次启动前必须填写配置模板并运行 self-check。',
    ],
  };

  const artifacts: FullAgentInstallerArtifact[] = [
    {
      path: `linux/${serviceName}.service`,
      mode: 0o644,
      platform: 'linux-systemd',
      description: 'systemd unit 文件',
      content: renderSystemdUnit(linux, description),
    },
    {
      path: 'linux/install-systemd.sh',
      mode: 0o755,
      platform: 'linux-systemd',
      description: 'systemd 安装脚本，不启动服务',
      content: renderLinuxInstallScript(linux, linuxCommands),
    },
    {
      path: 'linux/uninstall-systemd.sh',
      mode: 0o755,
      platform: 'linux-systemd',
      description: 'systemd 卸载/回滚脚本，默认保留数据',
      content: renderLinuxUninstallScript(linux),
    },
    {
      path: 'linux/gcac-nginx-helper.example.sh',
      mode: 0o755,
      platform: 'linux-systemd',
      description: 'NGINX 受控 helper 样例，只接受固定 test/reload 子命令',
      content: renderLinuxNginxHelperScript(),
    },
    {
      path: 'linux/gcac-nginx.sudoers.example',
      mode: 0o644,
      platform: 'linux-systemd',
      description: 'NGINX 受限 sudo 样例，仅放行固定命令或固定 helper',
      content: renderLinuxNginxSudoersExample(linux),
    },
    {
      path: 'windows/install-service.ps1',
      mode: 0o644,
      platform: 'windows-service',
      description: 'Windows Service 安装脚本，不启动服务',
      content: renderWindowsInstallScript(windows, windowsCommands, description),
    },
    {
      path: 'windows/uninstall-service.ps1',
      mode: 0o644,
      platform: 'windows-service',
      description: 'Windows Service 卸载/回滚脚本，默认保留数据',
      content: renderWindowsUninstallScript(windows),
    },
    {
      path: 'config/agent.config.template.json',
      mode: 0o640,
      platform: 'all',
      description: 'Agent 配置模板',
      content: renderConfigTemplate(options, linux, windows),
    },
    {
      path: 'README.md',
      mode: 0o644,
      platform: 'all',
      description: '安装、权限、健康检查和回滚说明',
      content: renderReadme(bundleWithoutArtifacts),
    },
  ];

  return { ...bundleWithoutArtifacts, artifacts };
}

export async function writeFullAgentInstallerBundle(options: WriteFullAgentInstallerBundleOptions): Promise<WrittenFullAgentInstallerBundle> {
  const bundle = generateFullAgentInstallerBundle(options);
  const written = [];
  for (const artifact of bundle.artifacts) {
    const target = join(options.outputDir, artifact.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, artifact.content, { encoding: 'utf8', mode: artifact.mode });
    await chmod(target, artifact.mode);
    written.push({ path: target, mode: artifact.mode });
  }
  return { outputDir: options.outputDir, artifacts: written, bundle };
}
