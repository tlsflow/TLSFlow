import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { CompatibilityLevel } from '../../../shared/enums/core.enums.js';
import type { Executor, StepExecutionInput, StepExecutionResult } from '../../executions/application/executors.js';

export type WindowsRemoteChannel = 'winrm' | 'smb_wmi' | 'wmi' | 'script_package';
export type WindowsAuthMethod = 'ntlm' | 'kerberos' | 'credssp' | 'basic';
export type WindowsStepKind = 'powershell' | 'file_copy' | 'backup' | 'wmi_query' | 'service_control' | 'cert_store' | 'script_package';
export type WindowsObservabilityLevel = 'full' | 'polling_file' | 'process_started_only' | 'manual';

export interface WindowsConnectionProfile {
  host: string;
  port?: number;
  username: string;
  credentialSecretRef: string;
  domain?: string;
  authMethod?: WindowsAuthMethod;
  osVersion?: string;
  compatibilityLevel?: CompatibilityLevel;
  preferredChannels?: WindowsRemoteChannel[];
  winrm?: {
    transport?: 'https' | 'http';
    port?: number;
    tlsVerify?: boolean;
    caSecretRef?: string;
    allowHttpWithApproval?: boolean;
    allowUntrustedTlsWithApproval?: boolean;
  };
  smb?: {
    shareName?: string;
    tempDirectory?: string;
    useAdminShare?: boolean;
  };
  wmi?: {
    namespace?: string;
    timeoutMs?: number;
  };
}

export interface WindowsCapabilityReport {
  osVersion: string;
  compatibilityLevel: CompatibilityLevel;
  winrm: { available: boolean; https: boolean; http: boolean };
  powershell: { available: boolean; version?: string };
  smb: { available: boolean; adminShare: boolean };
  wmi: { available: boolean; remoteProcess: boolean };
  windows: { cert_store: boolean };
  declarations: WindowsCapabilityDeclaration[];
  compatibilityWarnings: string[];
  suggestions: string[];
}

export interface WindowsCapabilityDeclaration {
  capabilityKey: string;
  value: unknown;
  confidence: number;
  evidence: Record<string, unknown>;
}

export interface WindowsRemoteRequest {
  idempotencyKey: string;
  connection: WindowsConnectionProfile;
  capabilities?: PartialWindowsCapabilities;
  steps: WindowsRemoteStep[];
  timeoutMs?: number;
  dryRun?: boolean;
  scriptPackage?: ScriptPackageFallbackPlan;
}

export interface PartialWindowsCapabilities {
  osVersion?: string;
  compatibilityLevel?: CompatibilityLevel;
  winrm?: Partial<WindowsCapabilityReport['winrm']>;
  powershell?: Partial<WindowsCapabilityReport['powershell']>;
  smb?: Partial<WindowsCapabilityReport['smb']>;
  wmi?: Partial<WindowsCapabilityReport['wmi']>;
  windows?: Partial<WindowsCapabilityReport['windows']>;
  declarations?: WindowsCapabilityDeclaration[];
}

export type WindowsRemoteStep = WinRmStepPlan | SmbStepPlan | WmiStepPlan | ScriptPackageStepPlan;

export interface BaseWindowsStepPlan {
  id: string;
  kind: WindowsStepKind;
  requires?: string[];
  timeoutMs?: number;
}

export interface WinRmStepPlan extends BaseWindowsStepPlan {
  channelPreference?: 'winrm';
  script?: string;
  encodedScriptSecretRef?: string;
  arguments?: Record<string, string | number | boolean>;
}

export interface SmbCopyOperation {
  direction: 'upload' | 'download';
  sourcePath: string;
  destinationPath: string;
  artifactRef?: string;
}

export interface SmbBackupOperation {
  remotePath: string;
  backupRef: string;
  beforeOverwrite?: boolean;
}

export interface SmbStepPlan extends BaseWindowsStepPlan {
  channelPreference?: 'smb_wmi';
  copies?: SmbCopyOperation[];
  backups?: SmbBackupOperation[];
}

export interface WmiStepPlan extends BaseWindowsStepPlan {
  channelPreference?: 'wmi' | 'smb_wmi';
  query?: string;
  command?: string;
  resultPath?: string;
}

export interface ScriptPackageStepPlan extends BaseWindowsStepPlan {
  channelPreference?: 'script_package';
  manifest?: ScriptPackageManifest;
}

export interface ScriptPackageFallbackPlan {
  packageRef?: string;
  manifest: ScriptPackageManifest;
  manualInstructions: string[];
}

export interface ScriptPackageManifest {
  packageId: string;
  files: Array<{ path: string; hash?: string; artifactRef?: string }>;
  entrypoint: string;
  expectedResultPath?: string;
  hashAlgorithm?: 'sha256';
  manifestHash?: string;
}

export interface ChannelSelection {
  channel: WindowsRemoteChannel;
  reason: string;
  limitations: string[];
  requiredCapabilities: string[];
}

export interface WindowsRemoteExecutionResult {
  success: boolean;
  channel: WindowsRemoteChannel;
  plannedActions: string[];
  limitations: string[];
  capabilityDeclarations: WindowsCapabilityDeclaration[];
  compatibilityWarnings: string[];
  scriptPackage?: ScriptPackageFallbackPlan;
  dryRun: boolean;
}

export class WindowsCapabilityProbe {
  probe(profile: WindowsConnectionProfile, observed: PartialWindowsCapabilities = {}): WindowsCapabilityReport {
    const osVersion = observed.osVersion ?? profile.osVersion ?? 'Windows UNKNOWN';
    const compatibilityLevel = observed.compatibilityLevel ?? profile.compatibilityLevel ?? inferCompatibilityLevel(osVersion);
    const legacy = ['L4', 'L5'].includes(compatibilityLevel);
    const modern = ['L1', 'L2', 'L3'].includes(compatibilityLevel);
    const winrmHttps = observed.winrm?.https ?? (modern && profile.winrm?.transport !== 'http');
    const winrmHttp = observed.winrm?.http ?? (compatibilityLevel === 'L3' && profile.winrm?.allowHttpWithApproval === true);
    const winrmAvailable = observed.winrm?.available ?? (winrmHttps || winrmHttp);
    const powershellAvailable = observed.powershell?.available ?? (compatibilityLevel !== 'L5' && compatibilityLevel !== 'L4');
    const smbAvailable = observed.smb?.available ?? true;
    const adminShare = observed.smb?.adminShare ?? (profile.smb?.useAdminShare !== false);
    const wmiAvailable = observed.wmi?.available ?? compatibilityLevel !== 'L5';
    const wmiRemoteProcess = observed.wmi?.remoteProcess ?? wmiAvailable;
    const certStore = observed.windows?.cert_store ?? powershellAvailable;
    const report: WindowsCapabilityReport = {
      osVersion,
      compatibilityLevel,
      winrm: { available: winrmAvailable, https: winrmHttps, http: winrmHttp },
      powershell: { available: powershellAvailable, version: observed.powershell?.version ?? inferPowerShellVersion(compatibilityLevel) },
      smb: { available: smbAvailable, adminShare },
      wmi: { available: wmiAvailable, remoteProcess: wmiRemoteProcess },
      windows: { cert_store: certStore },
      declarations: [],
      compatibilityWarnings: [],
      suggestions: [],
    };
    report.declarations = mergeCapabilityDeclarations(buildDeclarations(profile, report), observed.declarations ?? []);
    report.compatibilityWarnings = buildCompatibilityWarnings(report);
    report.suggestions = buildSuggestions(report);
    return report;
  }
}

export class ChannelSelector {
  select(request: Pick<WindowsRemoteRequest, 'connection' | 'steps' | 'capabilities' | 'scriptPackage'>, report: WindowsCapabilityReport): ChannelSelection {
    const required = requiredCapabilities(request.steps);
    const preferred = request.connection.preferredChannels ?? ['winrm', 'smb_wmi', 'wmi', 'script_package'];
    const candidates = preferred.filter((channel) => channelAllowedBySteps(channel, request.steps));

    for (const channel of candidates) {
      const decision = evaluateChannel(channel, required, report, request.scriptPackage);
      if (decision) return decision;
    }
    return {
      channel: 'script_package',
      reason: '远程通道能力不足，降级为脚本包',
      limitations: ['manual_execution_required', 'no_remote_observability'],
      requiredCapabilities: required,
    };
  }
}

export class WindowsRemoteExecutor implements Executor {
  readonly type = 'windows_remote';
  private readonly executed = new Set<string>();
  private readonly probe = new WindowsCapabilityProbe();
  private readonly selector = new ChannelSelector();

  async executeStep(input: StepExecutionInput): Promise<StepExecutionResult> {
    const request = input.step.inputSnapshot.windowsRequest as WindowsRemoteRequest | undefined;
    if (!request) return { success: true, detail: { skipped: true, reason: 'missing windowsRequest' } };
    const result = this.execute(request, input.dryRun);
    return result.success
      ? { success: true, detail: result as unknown as Record<string, unknown> }
      : { success: false, errorCode: 'WINDOWS_REMOTE_PLANNING_FAILED', errorMessage: 'Windows mock 规划失败', detail: result as unknown as Record<string, unknown> };
  }

  execute(request: WindowsRemoteRequest, forceDryRun = false): WindowsRemoteExecutionResult {
    validateRequest(request);
    if (this.executed.has(request.idempotencyKey)) {
      throw new AppError('IDEMPOTENCY_CONFLICT', 'Windows 请求幂等键已执行', { idempotencyKey: request.idempotencyKey });
    }
    const dryRun = forceDryRun || request.dryRun === true;
    const report = this.probe.probe(request.connection, request.capabilities ?? {});
    const selection = this.selector.select(request, report);
    const scriptPackage = selection.channel === 'script_package' ? buildScriptPackageFallback(request) : undefined;
    const plannedActions = [
      `channel:${selection.channel}`,
      ...request.steps.flatMap((step) => plannedActionsForStep(step, selection.channel)),
      ...smbBackupActions(request.steps),
      ...(scriptPackage ? [`script_package:${scriptPackage.manifest.packageId}:${scriptPackage.manifest.manifestHash}`] : []),
    ];
    if (!dryRun) this.executed.add(request.idempotencyKey);
    return {
      success: true,
      channel: selection.channel,
      plannedActions,
      limitations: selection.limitations,
      capabilityDeclarations: report.declarations,
      compatibilityWarnings: report.compatibilityWarnings,
      scriptPackage,
      dryRun,
    };
  }

  probeCapabilities(profile: WindowsConnectionProfile, observed: PartialWindowsCapabilities = {}): WindowsCapabilityReport {
    validateConnection(profile);
    return this.probe.probe(profile, observed);
  }
}

function validateRequest(request: WindowsRemoteRequest): void {
  if (!request.idempotencyKey.trim()) throw new AppError('VALIDATION_FAILED', 'idempotencyKey 必填');
  validateConnection(request.connection);
  if (request.timeoutMs !== undefined && (request.timeoutMs < 1 || request.timeoutMs > 300_000)) throw new AppError('VALIDATION_FAILED', 'timeoutMs 必须在 1-300000 之间');
  if (request.steps.length === 0) throw new AppError('VALIDATION_FAILED', 'Windows 请求至少需要一个步骤');
  for (const step of request.steps) validateStep(step);
  if (request.scriptPackage) validateScriptPackage(request.scriptPackage.manifest);
}

function validateConnection(connection: WindowsConnectionProfile): void {
  if (!connection.host.trim()) throw new AppError('VALIDATION_FAILED', 'host 必填');
  if (!connection.username.trim()) throw new AppError('VALIDATION_FAILED', 'username 必填');
  if (!isSecretRef(connection.credentialSecretRef)) throw new AppError('VALIDATION_FAILED', 'Windows 凭据必须使用 SecretRef', { field: 'credentialSecretRef' });
  if (connection.winrm?.transport === 'http' && connection.winrm.allowHttpWithApproval !== true) {
    throw new AppError('VALIDATION_FAILED', 'WinRM HTTP 属于高风险通道，必须显式提供审批策略');
  }
  if (connection.winrm?.tlsVerify === false && connection.winrm.allowUntrustedTlsWithApproval !== true) {
    throw new AppError('VALIDATION_FAILED', '跳过 WinRM TLS 校验必须显式提供审批策略');
  }
  if (connection.winrm?.caSecretRef && !isSecretRef(connection.winrm.caSecretRef)) throw new AppError('VALIDATION_FAILED', 'WinRM CA 必须使用 SecretRef');
  if (connection.smb?.tempDirectory) normalizeWindowsPath(connection.smb.tempDirectory);
  if (connection.wmi?.timeoutMs !== undefined && (connection.wmi.timeoutMs < 1 || connection.wmi.timeoutMs > 300_000)) throw new AppError('VALIDATION_FAILED', 'WMI timeoutMs 必须在 1-300000 之间');
}

function validateStep(step: WindowsRemoteStep): void {
  if (!step.id.trim()) throw new AppError('VALIDATION_FAILED', 'Windows step id 必填');
  if (step.timeoutMs !== undefined && (step.timeoutMs < 1 || step.timeoutMs > 300_000)) throw new AppError('VALIDATION_FAILED', 'step timeoutMs 必须在 1-300000 之间');
  scanSecretLike(step);
  if ('script' in step && step.script) validatePowerShellScript(step.script);
  if ('copies' in step) {
    for (const copy of step.copies ?? []) {
      normalizeWindowsPath(copy.sourcePath);
      normalizeWindowsPath(copy.destinationPath);
    }
  }
  if ('backups' in step) {
    for (const backup of step.backups ?? []) {
      normalizeWindowsPath(backup.remotePath);
      if (!backup.backupRef.trim()) throw new AppError('VALIDATION_FAILED', 'SMB backupRef 必填');
    }
  }
  if ('resultPath' in step && step.resultPath) normalizeWindowsPath(step.resultPath);
  if ('command' in step && step.command) validateWmiCommand(step.command);
  if ('query' in step && step.query && !/^select\s+/i.test(step.query.trim())) throw new AppError('VALIDATION_FAILED', 'WMI 查询只允许 SELECT');
  if ('manifest' in step && step.manifest) validateScriptPackage(step.manifest);
}

function validatePowerShellScript(script: string): void {
  if (/(Remove-Item\s+-Recurse\s+-Force\s+(C:\\|[A-Z]:\\)|Format-Volume|Stop-Computer|Restart-Computer)/i.test(script)) {
    throw new AppError('VALIDATION_FAILED', '危险 PowerShell 脚本被拒绝');
  }
}

function validateWmiCommand(command: string): void {
  if (/(format\s+|shutdown|restart-computer|del\s+\/[sq]\s+[a-z]:\\|rmdir\s+\/[sq]\s+[a-z]:\\)/i.test(command)) {
    throw new AppError('VALIDATION_FAILED', '危险 WMI 命令被拒绝');
  }
}

function validateScriptPackage(manifest: ScriptPackageManifest): void {
  if (!manifest.packageId.trim()) throw new AppError('VALIDATION_FAILED', '脚本包 packageId 必填');
  normalizeWindowsPath(manifest.entrypoint);
  for (const file of manifest.files) normalizeWindowsPath(file.path);
  if (manifest.expectedResultPath) normalizeWindowsPath(manifest.expectedResultPath);
}

function isSecretRef(value: string | undefined): boolean {
  return /^secret:\/\/.+/.test(value ?? '');
}

function normalizeWindowsPath(path: string): string {
  const trimmed = path.trim();
  const isDrivePath = /^[a-z]:\\[^:*?"<>|\r\n]+$/i.test(trimmed);
  const isUncPath = /^\\\\[^\\/:*?"<>|\r\n]+\\[^\\/:*?"<>|\r\n]+\\?[^:*?"<>|\r\n]*$/i.test(trimmed);
  const isArtifactPath = /^(artifact|backup|script-package):\/\/[^\r\n]+$/i.test(trimmed);
  if (!trimmed || trimmed.includes('..') || /[\0\r\n]/.test(trimmed) || (!isDrivePath && !isUncPath && !isArtifactPath)) {
    throw new AppError('VALIDATION_FAILED', 'Windows 路径不合法', { path });
  }
  return trimmed;
}

function scanSecretLike(value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|password\s*[:=]|token\s*[:=]|api[_-]?key\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9._-]{10,}/i.test(text)) {
    throw new AppError('VALIDATION_FAILED', 'Windows 请求包含疑似明文敏感信息');
  }
}

function inferCompatibilityLevel(osVersion: string): CompatibilityLevel {
  if (/2003/i.test(osVersion)) return 'L5';
  if (/2008(?!\s*R2)/i.test(osVersion)) return 'L4';
  if (/2008\s*R2/i.test(osVersion)) return 'L3';
  if (/2012/i.test(osVersion)) return 'L3';
  return 'L2';
}

function inferPowerShellVersion(level: CompatibilityLevel): string | undefined {
  if (level === 'L5') return undefined;
  if (level === 'L4') return '2.0';
  if (level === 'L3') return '3.0';
  return '5.1+';
}

function buildDeclarations(profile: WindowsConnectionProfile, report: WindowsCapabilityReport): WindowsCapabilityDeclaration[] {
  const evidence = { host: profile.host, osVersion: report.osVersion, compatibilityLevel: report.compatibilityLevel };
  return [
    declaration('winrm.available', report.winrm.available, evidence),
    declaration('winrm.https', report.winrm.https, evidence),
    declaration('winrm.http', report.winrm.http, evidence),
    declaration('powershell.available', report.powershell.available, evidence),
    declaration('powershell.version', report.powershell.version ?? 'unknown', evidence),
    declaration('smb.available', report.smb.available, evidence),
    declaration('smb.admin_share', report.smb.adminShare, evidence),
    declaration('wmi.available', report.wmi.available, evidence),
    declaration('wmi.remote_process', report.wmi.remoteProcess, evidence),
    declaration('windows.cert_store', report.windows.cert_store, evidence),
    declaration('risk.legacyWindows', ['L4', 'L5'].includes(report.compatibilityLevel), evidence),
  ];
}

function declaration(capabilityKey: string, value: unknown, evidence: Record<string, unknown>): WindowsCapabilityDeclaration {
  return { capabilityKey, value, confidence: 0.8, evidence };
}

function mergeCapabilityDeclarations(
  builtIn: WindowsCapabilityDeclaration[],
  contributed: WindowsCapabilityDeclaration[],
): WindowsCapabilityDeclaration[] {
  const byKey = new Map(builtIn.map((item) => [item.capabilityKey, item]));
  for (const item of contributed) {
    const capabilityKey = item.capabilityKey.trim();
    if (!capabilityKey) throw new AppError('VALIDATION_FAILED', '能力声明 capabilityKey 必填');
    if (byKey.has(capabilityKey)) {
      throw new AppError('VALIDATION_FAILED', '插件能力声明不得覆盖宿主探测事实', { capabilityKey });
    }
    byKey.set(capabilityKey, { ...item, capabilityKey });
  }
  return [...byKey.values()].sort((left, right) => left.capabilityKey.localeCompare(right.capabilityKey));
}

function buildCompatibilityWarnings(report: WindowsCapabilityReport): string[] {
  const warnings: string[] = [];
  if (report.winrm.http) warnings.push('WinRM HTTP 需要审批和高风险审计');
  if (!report.winrm.available && report.wmi.available) warnings.push('WinRM 不可用，将只能使用 SMB/WMI 受限降级');
  if (report.compatibilityLevel === 'L4') warnings.push('旧 Windows 只提供 L4 受限支持，建议脚本包或 Gateway');
  if (report.compatibilityLevel === 'L5') warnings.push('Windows Server 2003 类目标不承诺自动化闭环');
  if (report.wmi.available) warnings.push('WMI 输出采集和退出码不可等价于 WinRM');
  return warnings;
}

function buildSuggestions(report: WindowsCapabilityReport): string[] {
  if (report.winrm.https && report.powershell.available) return ['use_winrm'];
  if (report.smb.available && report.wmi.available) return ['use_smb_wmi', 'consider_gateway'];
  return ['generate_script_package', 'use_gateway'];
}

function requiredCapabilities(steps: WindowsRemoteStep[]): string[] {
  return [...new Set(steps.flatMap((step) => {
    const explicit = step.requires ?? [];
    const inferred: string[] = [];
    if (step.kind === 'powershell' || step.kind === 'service_control') inferred.push('winrm', 'powershell');
    if (step.kind === 'file_copy' || step.kind === 'backup') inferred.push('smb');
    if (step.kind === 'wmi_query') inferred.push('wmi');
    if (step.kind === 'cert_store') inferred.push('cert_store');
    return [...explicit, ...inferred];
  }))];
}

function channelAllowedBySteps(channel: WindowsRemoteChannel, steps: WindowsRemoteStep[]): boolean {
  return steps.every((step) => !step.channelPreference || step.channelPreference === channel || (step.channelPreference === 'smb_wmi' && channel === 'wmi'));
}

function evaluateChannel(channel: WindowsRemoteChannel, required: string[], report: WindowsCapabilityReport, scriptPackage?: ScriptPackageFallbackPlan): ChannelSelection | undefined {
  if (channel === 'winrm') {
    if (report.winrm.available && report.powershell.available && required.every((item) => !['smb', 'wmi'].includes(item) && capabilitySatisfied(item, report))) {
      return { channel, reason: report.winrm.https ? 'WinRM HTTPS 满足步骤需求' : 'WinRM HTTP 受控模式满足步骤需求', limitations: report.winrm.http ? ['high_risk_winrm_http'] : [], requiredCapabilities: required };
    }
    return undefined;
  }
  if (channel === 'smb_wmi') {
    if (report.smb.available && report.wmi.available && report.wmi.remoteProcess && required.every((item) => capabilitySatisfied(item, report))) {
      return { channel, reason: 'WinRM 不可用或步骤需要文件复制，使用 SMB+WMI 降级', limitations: ['polling_file_observability', 'wmi_exit_code_limited'], requiredCapabilities: required };
    }
    return undefined;
  }
  if (channel === 'wmi') {
    if (report.wmi.available && required.every((item) => !['smb', 'cert_store'].includes(item) && capabilitySatisfied(item, report))) {
      return { channel, reason: '仅 WMI 查询或受控命令可用', limitations: ['process_started_only', 'no_file_transfer'], requiredCapabilities: required };
    }
    return undefined;
  }
  if (scriptPackage || report.compatibilityLevel === 'L4' || report.compatibilityLevel === 'L5') {
    return { channel, reason: '旧 Windows 或远程能力不足，使用脚本包', limitations: ['manual_execution_required', 'no_remote_observability'], requiredCapabilities: required };
  }
  return undefined;
}

function capabilitySatisfied(capability: string, report: WindowsCapabilityReport): boolean {
  if (capability === 'winrm') return report.winrm.available;
  if (capability === 'powershell') return report.powershell.available;
  if (capability === 'smb') return report.smb.available;
  if (capability === 'wmi') return report.wmi.available;
  if (capability === 'cert_store') return report.windows.cert_store;
  return report.declarations.some((item) => item.capabilityKey === capability && item.value === true);
}

function plannedActionsForStep(step: WindowsRemoteStep, channel: WindowsRemoteChannel): string[] {
  if (channel === 'script_package') return [`package_step:${step.id}:${step.kind}`];
  if ('script' in step && step.script) return [`powershell:${step.id}:${hashText(step.script)}`];
  if ('encodedScriptSecretRef' in step && step.encodedScriptSecretRef) return [`powershell_secret:${step.id}:${step.encodedScriptSecretRef}`];
  if ('copies' in step && step.copies?.length) return step.copies.map((copy) => `smb:${copy.direction}:${copy.sourcePath}->${copy.destinationPath}`);
  if ('query' in step && step.query) return [`wmi_query:${step.id}:${hashText(step.query)}`];
  if ('command' in step && step.command) return [`wmi_command:${step.id}:${hashText(step.command)}`];
  return [`step:${step.id}:${step.kind}`];
}

function smbBackupActions(steps: WindowsRemoteStep[]): string[] {
  return steps.flatMap((step) => ('backups' in step ? (step.backups ?? []).map((backup) => `smb_backup:${backup.remotePath}:${backup.backupRef}`) : []));
}

function buildScriptPackageFallback(request: WindowsRemoteRequest): ScriptPackageFallbackPlan {
  if (request.scriptPackage) return { ...request.scriptPackage, manifest: withManifestHash(request.scriptPackage.manifest) };
  const manifest = withManifestHash({
    packageId: `win-${request.idempotencyKey}`,
    files: [{ path: 'script-package://payload/install.ps1', hash: 'sha256:placeholder', artifactRef: 'artifact://windows-script-placeholder' }],
    entrypoint: 'script-package://payload/install.ps1',
    expectedResultPath: 'script-package://result/result.json',
    hashAlgorithm: 'sha256',
  });
  return {
    packageRef: `script-package://${manifest.packageId}`,
    manifest,
    manualInstructions: ['在目标 Windows 主机以管理员身份执行 entrypoint', '执行后上传 expectedResultPath 指向的结果文件'],
  };
}

function withManifestHash(manifest: ScriptPackageManifest): ScriptPackageManifest {
  const material = JSON.stringify({ ...manifest, manifestHash: undefined });
  return { ...manifest, hashAlgorithm: manifest.hashAlgorithm ?? 'sha256', manifestHash: manifest.manifestHash ?? `sha256:${hashText(material)}` };
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
