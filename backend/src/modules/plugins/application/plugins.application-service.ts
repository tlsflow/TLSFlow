import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { assertPluginGcacCompatibility } from '../../../common/version.js';
import { RedactionService } from '../../audits/redaction.service.js';
import { newId } from '../../../shared/id.js';
import type {
  PluginCapabilityDeclaration,
  PluginEnableInput,
  PluginExecutionRequest,
  PluginExecutionResult,
  PluginInstallStatus,
  PluginPackageRecord,
  PluginPackageUploadInput,
  PluginPermissionApprovalInput,
  PluginPermissionApprovalStatus,
  PluginPermissionSummary,
  PluginSignatureStatus,
  PluginStepDraft,
} from '../dto/plugins.dto.js';
import { validatePluginManifest } from '../schema/plugins.schema.js';
import { PgPluginsRepository, type PluginsRepository } from '../repository/plugins.repository.js';

const trustedMockSignaturePrefix = 'mock-trusted:';
const tenantFallback = '00000000-0000-0000-0000-000000000000';

export class PluginsApplicationService {
  constructor(
    private readonly repository: PluginsRepository = new PgPluginsRepository(),
    private readonly redaction = new RedactionService(),
  ) {}

  getModuleMetadata() {
    return {
      module: 'plugins',
      basePath: '/api/v1/plugins',
      spec: '024',
      status: 'IMPLEMENTED_MOCK_SAFE',
    };
  }

  async uploadPackage(input: PluginPackageUploadInput, tenantId = tenantFallback): Promise<PluginPackageRecord> {
    const manifest = validatePluginManifest(input.manifest);
    assertPluginGcacCompatibility(manifest.pluginId, manifest.minGcacVersion);
    const packageHash = this.calculateHash(input.packageContent);
    if (input.expectedHash && input.expectedHash !== packageHash) {
      throw new AppError('VALIDATION_FAILED', '插件包完整性校验失败', {
        expectedHash: input.expectedHash,
        actualHash: packageHash,
      });
    }

    const signatureStatus = this.verifyMockSignature(input.signature, packageHash);
    if (signatureStatus === 'invalid') {
      throw new AppError('PLUGIN_SIGNATURE_INVALID', '插件签名无效', { packageHash });
    }

    const approvalStatus = this.initialApprovalStatus(manifest.permissions);
    const now = new Date().toISOString();
    const record: PluginPackageRecord = {
      id: newId('pluginpkg'),
      tenantId,
      manifest,
      packageHash,
      expectedHash: input.expectedHash,
      signature: input.signature,
      signatureStatus,
      installStatus: approvalStatus === 'pending' ? 'pending_approval' : 'installed_disabled',
      permissionApprovalStatus: approvalStatus,
      approvedPermissions: approvalStatus === 'not_required' ? manifest.permissions.map((permission) => permission.name) : [],
      storageKey: `memory://${tenantId}/${manifest.pluginId}/${manifest.version}/${packageHash}`,
      uploadedAt: now,
      updatedAt: now,
    };

    return this.repository.savePackage(record);
  }

  async listPackages(tenantId = tenantFallback): Promise<PluginPackageRecord[]> {
    return this.repository.listPackages(tenantId);
  }

  async approvePermissions(input: PluginPermissionApprovalInput): Promise<PluginPackageRecord> {
    const record = await this.requirePackage(input.pluginPackageId);
    const declared = new Set(record.manifest.permissions.map((permission) => permission.name));
    const invalidPermissions = input.approvedPermissions.filter((permission) => !declared.has(permission));
    if (invalidPermissions.length > 0) {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '审批权限不能超过插件声明', { invalidPermissions });
    }

    return this.updatePackage(record, {
      permissionApprovalStatus: 'approved',
      approvedPermissions: [...new Set(input.approvedPermissions)],
      installStatus: 'installed_disabled',
    });
  }

  async enablePlugin(input: PluginEnableInput): Promise<PluginPackageRecord> {
    const record = await this.requirePackage(input.pluginPackageId);
    assertPluginGcacCompatibility(record.manifest.pluginId, record.manifest.minGcacVersion);
    const summary = await this.getPermissionSummary(record.id);
    if (!summary.canEnable) {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '插件存在未审批高风险权限，不能启用', summary);
    }
    if (record.signatureStatus === 'invalid') {
      throw new AppError('PLUGIN_SIGNATURE_INVALID', '插件签名无效，不能启用', { pluginPackageId: record.id });
    }
    return this.updatePackage(record, { installStatus: 'enabled' });
  }

  async disablePlugin(input: PluginEnableInput): Promise<PluginPackageRecord> {
    const record = await this.requirePackage(input.pluginPackageId);
    return this.updatePackage(record, { installStatus: 'disabled' });
  }

  async execute(request: PluginExecutionRequest): Promise<PluginExecutionResult> {
    const record = await this.requirePackage(request.pluginPackageId);
    assertPluginGcacCompatibility(record.manifest.pluginId, record.manifest.minGcacVersion);
    if (record.installStatus !== 'enabled') {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '插件未启用，不能执行', {
        pluginPackageId: record.id,
        installStatus: record.installStatus,
      });
    }

    const action = record.manifest.actions.find((item) => item.name === request.action);
    if (!action) {
      throw new AppError('VALIDATION_FAILED', '插件动作不存在', { action: request.action });
    }

    this.assertPermissionsApproved(record, action.requiredPermissions ?? []);
    this.assertSecretScope(request.secretRefs ?? [], request.allowedSecretRefs ?? [], action.requiredSecretScopes ?? []);

    const runtime = record.manifest.runtime;
    const startedAt = new Date().toISOString();
    const timeoutSeconds = request.timeoutSeconds ?? runtime.timeoutSeconds;
    const baseResult = {
      executionId: newId('pluginexec'),
      pluginPackageId: record.id,
      action: request.action,
      runtimeType: runtime.type,
      startedAt,
      runtimeDescriptor: runtime,
    };

    if (timeoutSeconds <= 0 || timeoutSeconds > runtime.timeoutSeconds) {
      const finishedAt = new Date().toISOString();
      const result: PluginExecutionResult = {
        ...baseResult,
        status: 'timeout',
        exitCode: null,
        stdout: '',
        stderr: 'mock runtime timeout',
        finishedAt,
        redactionMatches: 0,
        errorCode: 'EXECUTION_TIMEOUT',
      };
      return this.repository.saveExecution(result);
    }

    if (runtime.type !== 'process') {
      const result = this.createUnsupportedRuntimeResult(baseResult, runtime.type);
      return this.repository.saveExecution(result);
    }

    this.assertCommandAllowed(request.command, runtime.allowedCommands ?? [runtime.entry, action.command].filter(Boolean) as string[]);

    const redactedStdout = this.redactText(request.mockStdout ?? JSON.stringify({ ok: true, action: request.action }));
    const redactedStderr = this.redactText(request.mockStderr ?? '');
    const result: PluginExecutionResult = {
      ...baseResult,
      status: 'success',
      exitCode: 0,
      stdout: redactedStdout.value,
      stderr: redactedStderr.value,
      finishedAt: new Date().toISOString(),
      redactionMatches: redactedStdout.matches + redactedStderr.matches,
    };
    return this.repository.saveExecution(result);
  }

  async listExecutions(pluginPackageId?: string): Promise<PluginExecutionResult[]> {
    return this.repository.listExecutions(pluginPackageId);
  }

  async getPermissionSummary(pluginPackageId: string): Promise<PluginPermissionSummary> {
    const record = await this.requirePackage(pluginPackageId);
    const highRiskPermissions = record.manifest.permissions
      .filter((permission) => permission.risk === 'high')
      .map((permission) => permission.name);
    const approved = new Set(record.approvedPermissions);
    const hasUnapprovedHighRisk = highRiskPermissions.some((permission) => !approved.has(permission));
    return {
      pluginPackageId,
      approvalStatus: record.permissionApprovalStatus,
      highRiskPermissions,
      declaredPermissions: record.manifest.permissions,
      canEnable: !hasUnapprovedHighRisk && record.permissionApprovalStatus !== 'rejected',
    };
  }

  async getStepDraft(pluginPackageId: string, actionName: string): Promise<PluginStepDraft> {
    const record = await this.requirePackage(pluginPackageId);
    const action = record.manifest.actions.find((item) => item.name === actionName);
    if (!action) {
      throw new AppError('VALIDATION_FAILED', '插件动作不存在', { action: actionName });
    }
    return {
      stepType: 'plugin',
      pluginPackageId,
      action: action.name,
      requiredPermissions: action.requiredPermissions ?? [],
      requiredSecretScopes: action.requiredSecretScopes ?? [],
      runtimeType: record.manifest.runtime.type,
      timeoutSeconds: record.manifest.runtime.timeoutSeconds,
    };
  }

  async publishCapabilities(pluginPackageId: string): Promise<PluginCapabilityDeclaration[]> {
    const record = await this.requirePackage(pluginPackageId);
    if (record.installStatus !== 'enabled') {
      return [];
    }
    return record.manifest.capabilities;
  }

  calculateHash(content: string): string {
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
  }

  private verifyMockSignature(signature: string | undefined, packageHash: string): PluginSignatureStatus {
    if (!signature) {
      return 'missing';
    }
    if (signature === `${trustedMockSignaturePrefix}${packageHash}`) {
      return 'trusted';
    }
    if (signature.startsWith('mock-untrusted:')) {
      return 'untrusted';
    }
    return 'invalid';
  }

  private initialApprovalStatus(permissions: PluginPackageRecord['manifest']['permissions']): PluginPermissionApprovalStatus {
    return permissions.some((permission) => permission.risk === 'high') ? 'pending' : 'not_required';
  }

  private async requirePackage(pluginPackageId: string): Promise<PluginPackageRecord> {
    const record = await this.repository.findPackage(pluginPackageId);
    if (!record) {
      throw new AppError('RESOURCE_NOT_FOUND', '插件包不存在', { pluginPackageId });
    }
    return record;
  }

  private updatePackage(record: PluginPackageRecord, patch: Partial<Pick<
    PluginPackageRecord,
    'installStatus' | 'permissionApprovalStatus' | 'approvedPermissions'
  >>): Promise<PluginPackageRecord> {
    const next: PluginPackageRecord = {
      ...record,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return this.repository.savePackage(next);
  }

  private assertPermissionsApproved(record: PluginPackageRecord, requiredPermissions: string[]): void {
    const approved = new Set(record.approvedPermissions);
    const missing = requiredPermissions.filter((permission) => !approved.has(permission));
    if (missing.length > 0) {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '插件动作权限未审批', { missing });
    }
  }

  private assertSecretScope(secretRefs: string[], allowedSecretRefs: string[], requiredSecretScopes: string[]): void {
    if (secretRefs.length === 0) {
      return;
    }
    if (!requiredSecretScopes.includes('action.bound')) {
      throw new AppError('SECRET_REF_INVALID', '插件动作未声明 Secret 作用域', { secretRefs });
    }
    const allowed = new Set(allowedSecretRefs);
    const denied = secretRefs.filter((secretRef) => !allowed.has(secretRef));
    if (denied.length > 0) {
      throw new AppError('SECRET_REF_INVALID', '插件请求了未授权 Secret', { denied });
    }
  }

  private assertCommandAllowed(command: string, allowedCommands: string[]): void {
    const allowed = new Set(allowedCommands.filter(Boolean));
    if (!allowed.has(command)) {
      throw new AppError('PLUGIN_PERMISSION_DENIED', '插件命令不在 allowlist 内', {
        command,
        allowedCommands: [...allowed],
      });
    }
  }

  private redactText(text: string): { value: string; matches: number } {
    const result = this.redaction.redact(text);
    return { value: result.value, matches: result.matches.length };
  }

  private createUnsupportedRuntimeResult(
    base: Pick<PluginExecutionResult, 'executionId' | 'pluginPackageId' | 'action' | 'runtimeType' | 'startedAt' | 'runtimeDescriptor'>,
    runtimeType: PluginExecutionResult['runtimeType'],
  ): PluginExecutionResult {
    return {
      ...base,
      runtimeType,
      status: 'failed',
      exitCode: null,
      stdout: '',
      stderr: `${runtimeType} runtime 仅预留 descriptor，mock-safe 阶段不执行`,
      finishedAt: new Date().toISOString(),
      redactionMatches: 0,
      errorCode: 'PLUGIN_RUNTIME_UNSUPPORTED',
    };
  }
}
