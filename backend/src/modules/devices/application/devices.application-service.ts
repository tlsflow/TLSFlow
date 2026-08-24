import { AppError } from '../../../common/errors/app-error.js';
import type { ManagedDeviceDetailDto, ManagedDeviceListQuery, ManagedDevicePageDto } from '../dto/devices.dto.js';
import type { DeviceOnboardingPlatformDescriptor } from '../dto/devices.dto.js';
import { DevicePlatformRegistry } from '../domain/device-platform.registry.js';
import type { AgentsApplicationService } from '../../agents/application/agents.application-service.js';
import type { AgentDetailProjection } from '../../agents/dto/agents.dto.js';
import { DeviceAssetsDomainService } from '../../device-assets/domain/device-assets.domain-service.js';
import { PgDeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import type { DatabasePort } from '../../../database/database-port.js';
import { PgliteDatabase } from '../../../database/pglite-database.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import { PluginPackageResourcesService } from '../../plugins/application/plugin-package-resources.service.js';
import { PluginBindingsApplicationService } from '../../plugins/application/plugin-bindings.application-service.js';
import { PluginBindingsRepository } from '../../plugins/repository/plugin-bindings.repository.js';
import type { PluginFormSchemaV1 } from '../../plugins/forms/plugin-form.dto.js';
import type { PluginWorkflowPublisherService } from '../../plugins/application/plugin-workflow-publisher.service.js';
import type { WorkflowTemplatesApplicationService } from '../../workflow-templates/application/workflow-templates.application-service.js';
import type { CreateManagedDeviceOnboardingDto } from '../dto/devices.dto.js';
import { PgDevicesRepository, type DevicesRepository } from '../repository/devices.repository.js';
import { pluginRuntimeGuard, type PluginRuntimeGuardService } from '../../plugins/runtime/plugin-runtime-guard.service.js';
import { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import { RuntimeCredentialResolver } from '../../credentials/application/runtime-credential-resolver.js';
import { CredentialsRepository } from '../../credentials/repository/credentials.repository.js';
import { structuredLogger } from '../../../common/logging/structured-logger.js';

export class DevicesApplicationService {
  constructor(
    private readonly repository: DevicesRepository = new PgDevicesRepository(),
    private readonly platformRegistry = new DevicePlatformRegistry(),
    private readonly agents?: AgentsApplicationService,
    private readonly db: DatabasePort = new PgliteDatabase(),
    private readonly unifiedPlugins?: UnifiedPluginsApplicationService,
    private readonly packageResources = new PluginPackageResourcesService(),
    private readonly pluginBindings?: PluginBindingsApplicationService,
    private readonly pluginWorkflows?: PluginWorkflowPublisherService,
    private readonly workflows?: WorkflowTemplatesApplicationService,
    private readonly runtimeGuard: PluginRuntimeGuardService = pluginRuntimeGuard,
    private readonly discoveryProjector?: StandardDeviceDiscoveryProjector,
  ) {}

  list(tenantId: string, query: ManagedDeviceListQuery): Promise<ManagedDevicePageDto> {
    return this.repository.list(tenantId, query);
  }

  async get(tenantId: string, deviceId: string, locale = 'zh-CN'): Promise<ManagedDeviceDetailDto> {
    const device = await this.repository.get(tenantId, deviceId);
    if (!device) throw new AppError('RESOURCE_NOT_FOUND', '设备不存在', { deviceId });
    if (device.extension.type === 'AGENT' && device.extension.agentId && this.agents) {
      return enrichAgentDetail(device, await this.agents.getAgentDetail(tenantId, device.extension.agentId));
    }
    if (device.extension.type !== 'PLUGIN' || !device.extension.pluginVersionId || !device.extension.pluginBindingId || !this.unifiedPlugins) return device;
    const [plugin, ui, assignmentRows] = await Promise.all([
      this.unifiedPlugins.getVersion(device.extension.pluginVersionId),
      this.unifiedPlugins.getUiResources(device.extension.pluginVersionId, locale),
      this.db.query<{ capability_key: string }>(
        `select capability_key from plugin_capability_assignments
         where tenant_id=$1 and owner_type='DEVICE' and owner_id=$2 and plugin_binding_id=$3 and status='ACTIVE'
         order by capability_key`,
        [tenantId, device.id, device.extension.pluginBindingId],
      ),
    ]);
    if (plugin.tenantId !== tenantId) throw new AppError('RESOURCE_NOT_FOUND', '设备插件不存在', { deviceId });
    const capabilities = assignmentRows.rows.map((row) => row.capability_key);
    const presentation = ui.presentations.device;
    return {
      ...device,
      allowedActions: [...new Set([...device.allowedActions, ...capabilities])],
      capabilities,
      pluginUi: {
        pluginVersionId: plugin.id,
        pluginBindingId: device.extension.pluginBindingId,
        pluginId: plugin.pluginId,
        version: plugin.version,
        source: plugin.source,
        capabilities,
        presentation: presentation ? {
          ...presentation,
          actions: presentation.actions.filter((action) => capabilities.includes(action.capabilityKey)),
        } as unknown as Record<string, unknown> : undefined,
        messages: ui.locale?.messages ?? {},
      },
    };
  }

  listOnboardingPlatforms(): DeviceOnboardingPlatformDescriptor[] {
    return this.platformRegistry.list();
  }

  async onboard(tenantId: string, input: CreateManagedDeviceOnboardingDto, actorId: string, requestId: string) {
    if (input.platformKey !== 'plugin') {
      const platform = this.platformRegistry.requireSupported(input.platformKey);
      if (!this.agents) throw new AppError('CAPABILITY_MISSING', 'Agent 安装服务未注册');
      const baseUrl = input.baseUrl?.trim();
      if (!baseUrl) throw new AppError('VALIDATION_FAILED', 'Agent 安装需要 baseUrl', { field: 'baseUrl' });
      const options = {};
      const installSession = platform.handlerKey === 'WINDOWS_GO'
        ? await this.agents.createWindowsPowerShellInstallSession(tenantId, options, requestId, baseUrl)
        : platform.handlerKey === 'WINDOWS_COMPATIBILITY'
          ? await this.agents.createWindowsCompatibilityInstallSession(tenantId, options, requestId, baseUrl)
          : await this.agents.createLinuxGoInstallSession(tenantId, options, requestId, baseUrl);
      return { ...installSession, onboardingKind: 'AGENT_INSTALL' as const, installSession };
    }
    return this.onboardPluginDevice(tenantId, input, actorId);
  }

  async executeCapability(tenantId: string, deviceId: string, capabilityKey: string) {
    if (!this.pluginBindings || !this.pluginWorkflows || !this.workflows) throw new AppError('CAPABILITY_MISSING', '插件工作流执行服务未注册');
    if (!['device.connection.test', 'device.identity.detect', 'device.discover', 'certificate.discover'].includes(capabilityKey)) {
      throw new AppError('VALIDATION_FAILED', '该设备动作必须通过部署计划执行', { capabilityKey });
    }
    const device = await this.get(tenantId, deviceId);
    if (capabilityKey !== 'device.connection.test'
      && (device.livenessSignals?.length ?? 0) > 0
      && device.livenessStatus !== 'ONLINE') {
      throw new AppError('EXECUTION_TARGET_UNAVAILABLE', device.livenessStatus === 'OFFLINE' ? '设备已离线，不能执行该操作' : '设备存活状态尚未确认，不能执行该操作', {
        deviceId,
        capabilityKey,
        livenessStatus: device.livenessStatus,
        reasonCode: device.livenessReasonCode,
      });
    }
    if (device.extension.type !== 'PLUGIN' || !device.extension.pluginBindingId) throw new AppError('CAPABILITY_MISSING', '设备未绑定统一插件');
    const assignment = await this.pluginBindings.resolveAssignment(tenantId, capabilityKey, { deviceId: device.id });
    if (!assignment || assignment.pluginBindingId !== device.extension.pluginBindingId) {
      throw new AppError('CAPABILITY_MISSING', '设备未分配该插件能力', { capabilityKey });
    }
    const [binding, workflow] = await Promise.all([
      this.pluginBindings.getTenantBinding(tenantId, assignment.pluginBindingId),
      this.pluginWorkflows.require(assignment.pluginVersionId, capabilityKey),
    ]);
    const credentials = await new RuntimeCredentialResolver(new CredentialsRepository(this.db))
      .resolveBindings(tenantId, binding.credentialBindings);
    const result = await this.runtimeGuard.execute({
      tenantId, pluginVersionId: assignment.pluginVersionId, capabilityKey,
      gatewayId: typeof binding.connectionBindings.gatewayId === 'string' ? binding.connectionBindings.gatewayId : undefined,
    }, () => this.workflows!.execute({
      templateVersionId: workflow.workflowVersionId,
      mode: 'real_test',
      userVariables: { ...binding.variableBindings, ...credentials },
    }));
    if (result.status !== 'success') {
      const failedStep = findFailedWorkflowStep(result.stepResults);
      structuredLogger.error('设备插件能力执行失败', {
        deviceId: device.id,
        deviceAssetId: device.extension.deviceAssetId,
        pluginVersionId: assignment.pluginVersionId,
        pluginBindingId: assignment.pluginBindingId,
        capabilityKey,
        workflowRunId: result.id,
        workflowStatus: result.status,
        failedStepName: failedStep?.name,
        failedStepType: failedStep?.type,
        failedStepStage: failedStep?.stage,
        errorCode: failedStep?.errorCode,
        errorMessage: failedStep?.errorMessage,
      }, {
        tenantId,
        module: 'devices',
        resourceType: 'managedDevice',
        resourceId: device.id,
      });
      throw new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '设备插件能力执行失败', {
        capabilityKey,
        workflowRunId: result.id,
        status: result.status,
        failedStepName: failedStep?.name,
        errorCode: failedStep?.errorCode,
      });
    }
    if (!['device.discover', 'certificate.discover'].includes(capabilityKey)) return result;
    if (!this.discoveryProjector) throw new AppError('CAPABILITY_MISSING', '标准设备发现投影器未注册');
    try {
      const discovery = findWorkflowExtractedValue(result.stepResults, 'discovery');
      if (!discovery) {
        throw new AppError('PLUGIN_DISCOVERY_SCHEMA_INVALID', '设备发现工作流未输出标准 discovery 结果', {
          capabilityKey,
          workflowRunId: result.id,
        });
      }
      const projection = await this.discoveryProjector.project({
        tenantId,
        deviceAssetId: device.extension.deviceAssetId,
        hostId: device.id,
        pluginVersionId: assignment.pluginVersionId,
        pluginBindingId: assignment.pluginBindingId,
      }, discovery);
      return { ...result, projection };
    } catch (error) {
      const errorDetails = error instanceof AppError ? {
        errorCode: error.errorCode,
        errorMessage: error.message,
        errorDetails: error.details,
      } : {
        errorType: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : '未知错误',
      };
      structuredLogger.error('设备发现结果投影失败', {
        ...errorDetails,
        deviceId: device.id,
        deviceAssetId: device.extension.deviceAssetId,
        pluginVersionId: assignment.pluginVersionId,
        pluginBindingId: assignment.pluginBindingId,
        capabilityKey,
        workflowRunId: result.id,
      }, {
        tenantId,
        module: 'devices',
        resourceType: 'managedDevice',
        resourceId: device.id,
      });
      throw error;
    }
  }

  private async onboardPluginDevice(tenantId: string, input: CreateManagedDeviceOnboardingDto, actorId: string) {
    if (!this.unifiedPlugins) throw new AppError('CAPABILITY_MISSING', '统一插件服务未注册');
    const pluginVersionId = required(input.pluginVersionId, 'pluginVersionId');
    const plugin = await this.unifiedPlugins.getVersion(pluginVersionId);
    if (plugin.tenantId !== tenantId || plugin.status !== 'ENABLED') {
      throw new AppError('RESOURCE_NOT_FOUND', '可用插件版本不存在', { pluginVersionId });
    }
    if (plugin.runtime !== 'WORKFLOW_DSL' || !['MANAGED', 'BOTH'].includes(plugin.scope)) {
      throw new AppError('VALIDATION_FAILED', '插件不支持受控设备模式', { pluginVersionId, runtime: plugin.runtime, scope: plugin.scope });
    }
    const capabilityKeys = plugin.manifest.capabilities.map((item) => item.key);
    if (!capabilityKeys.includes('device.connection.test') || !capabilityKeys.includes('device.discover')) {
      throw new AppError('CAPABILITY_MISSING', '设备插件必须声明连接测试和发现能力', { pluginVersionId });
    }
    const form = this.packageResources.validate(plugin.manifest, plugin.resources).forms.device;
    if (!form || !['MANAGED', 'BOTH'].includes(form.mode)) {
      throw new AppError('VALIDATION_FAILED', '设备插件缺少 Managed 设备表单', { pluginVersionId });
    }
    const mapped = mapPluginDeviceForm(form, input.formValues ?? {});
    const domain = new DeviceAssetsDomainService();
    const onboarding = await this.db.transaction(async (tx) => {
      const deviceRepository = new PgDeviceAssetsRepository(tx);
      const bindingService = new PluginBindingsApplicationService(new PluginBindingsRepository(tx));
      const device = await deviceRepository.createInTransaction(tx, tenantId, domain.normalizeCreate({
        displayName: mapped.displayName,
        managementAddress: mapped.address,
        managementPort: mapped.port,
        deviceFamily: plugin.pluginId,
        authMode: mapped.authMode,
        tlsVerify: mapped.tlsVerify,
        caSecretId: mapped.caSecretRef,
        gatewayId: mapped.gatewayId,
      }));
      const binding = await bindingService.createBinding(tenantId, {
        pluginVersionId,
        mode: 'MANAGED',
        variableBindings: mapped.variables,
        credentialBindings: mapped.credentials,
        secretBindings: mapped.secrets,
        certificateArtifactBindings: {},
        connectionBindings: mapped.connections,
        managedContext: { hostId: device.hostId },
      });
      await tx.query(
        `update pg_device_assets set plugin_version_id=$1, plugin_binding_id=$2, product_family=$3, metadata=$4::jsonb, updated_at=$5
         where tenant_id=$6 and service_asset_id=$7`,
        [pluginVersionId, binding.id, plugin.pluginId, JSON.stringify({ onboardedBy: actorId }), new Date().toISOString(), tenantId, device.id],
      );
      const assignments = [];
      for (const capability of plugin.manifest.capabilities) {
        assignments.push(await bindingService.assignCapability(tenantId, {
          ownerType: 'DEVICE', ownerId: device.hostId, capabilityKey: capability.key,
          pluginVersionId, pluginBindingId: binding.id, precedence: 'DEVICE_DEFAULT',
        }));
      }
      return { onboardingKind: 'PLUGIN_MANAGED' as const, device, binding, assignments };
    });
    try {
      await this.executeCapability(tenantId, onboarding.device.hostId, 'device.connection.test');
      if (capabilityKeys.includes('device.identity.detect')) {
        await this.executeCapability(tenantId, onboarding.device.hostId, 'device.identity.detect');
      }
      const discovery = await this.executeCapability(tenantId, onboarding.device.hostId, 'device.discover');
      return { ...onboarding, discovery };
    } catch (error) {
      const errorCode = error instanceof AppError ? error.errorCode : 'SYSTEM_INTERNAL_ERROR';
      const failedAt = new Date().toISOString();
      await this.db.transaction(async (tx) => {
        await tx.query(
          `update pg_device_assets set last_error_code=$1, updated_at=$2, version=version+1
           where tenant_id=$3 and service_asset_id=$4`,
          [errorCode, failedAt, tenantId, onboarding.device.id],
        );
        await tx.query(
          `update pg_service_assets
           set status='UNKNOWN', metadata=metadata || $1::jsonb, updated_at=$2, version=version+1
           where tenant_id=$3 and id=$4`,
          [JSON.stringify({ onboardingState: 'FAILED', onboardingErrorCode: errorCode, onboardingFailedAt: failedAt }), failedAt, tenantId, onboarding.device.id],
        );
      });
      throw error;
    }
  }
}

function findWorkflowExtractedValue(
  steps: Array<{ extracted: Record<string, unknown>; children?: Array<{ extracted: Record<string, unknown>; children?: unknown[] }> }>,
  key: string,
): unknown {
  for (const step of [...steps].reverse()) {
    if (step.extracted[key] !== undefined) return step.extracted[key];
    const childValue = findWorkflowExtractedValue((step.children ?? []) as typeof steps, key);
    if (childValue !== undefined) return childValue;
  }
  return undefined;
}

function findFailedWorkflowStep<T extends { status: string; children?: T[] }>(steps: T[]): T | undefined {
  for (const step of steps) {
    const failedChild = findFailedWorkflowStep(step.children ?? []);
    if (failedChild) return failedChild;
    if (step.status === 'failed') return step;
  }
  return undefined;
}

interface MappedPluginDeviceForm {
  displayName: string;
  address: string;
  port: number;
  authMode: string;
  tlsVerify: boolean;
  gatewayId?: string;
  caSecretRef?: string;
  connections: Record<string, unknown>;
  variables: Record<string, unknown>;
  credentials: Record<string, { credentialId: string }>;
  secrets: Record<string, string>;
}

function mapPluginDeviceForm(form: PluginFormSchemaV1, values: Record<string, unknown>): MappedPluginDeviceForm {
  const connections: Record<string, unknown> = {};
  const variables: Record<string, unknown> = {};
  const credentials: Record<string, { credentialId: string }> = {};
  const secrets: Record<string, string> = {};
  const standardValues = new Map<string, unknown>();
  for (const field of form.sections.flatMap((section) => section.fields)) {
    const value = values[field.key] ?? field.defaultValue;
    if (field.required && isEmpty(value)) throw new AppError('VALIDATION_FAILED', '插件表单必填字段不能为空', { field: field.key });
    if (value === undefined || value === null || value === '') continue;
    if (field.type !== 'credential_ref' && field.type !== 'secret_ref') variables[field.key] = value;
    if (field.type === 'credential_ref') {
      if (typeof value !== 'string') throw new AppError('VALIDATION_FAILED', 'credentialId 必须是字符串', { field: field.key });
      credentials[field.key] = { credentialId: value };
    }
    if (!field.standardField) continue;
    standardValues.set(field.standardField, value);
    if (field.type === 'credential_ref') {
      continue;
    } else if (field.type === 'secret_ref') {
      if (typeof value !== 'string') throw new AppError('VALIDATION_FAILED', 'SecretRef 必须是字符串', { field: field.key });
      secrets[field.standardField] = value;
    } else if (field.standardField.startsWith('connection.') || field.standardField.startsWith('tls.') || field.standardField.startsWith('authentication.')) {
      connections[field.standardField] = value;
    }
  }
  const address = requiredString(standardValues.get('connection.address'), 'connection.address');
  const displayName = requiredString(standardValues.get('device.displayName'), 'device.displayName');
  const port = Number(standardValues.get('connection.port') ?? 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError('VALIDATION_FAILED', '设备管理端口无效', { field: 'connection.port' });
  variables.deviceHost = address;
  variables.managementPort = port;
  variables.tlsVerify = standardValues.get('tls.verifyPeer') !== false;
  return {
    displayName,
    address,
    port,
    authMode: String(standardValues.get('authentication.mode') ?? 'PLUGIN'),
    tlsVerify: standardValues.get('tls.verifyPeer') !== false,
    gatewayId: optionalString(standardValues.get('connection.gatewayId')),
    caSecretRef: optionalString(standardValues.get('tls.caSecretRef')),
    connections,
    variables,
    credentials,
    secrets,
  };
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function enrichAgentDetail(device: ManagedDeviceDetailDto, projection: AgentDetailProjection): ManagedDeviceDetailDto {
  const { agent, latestHeartbeat, health, taskQueue, upgradeSuggestion } = projection;
  const descriptor = agent.descriptor;
  const capabilitySites = buildAgentCapabilitySites(projection);
  const agentSection = {
    key: 'agent',
    fields: [
      { key: 'agentId', value: agent.id, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentKey', value: agent.agentKey, valueType: 'TEXT' as const, copyable: true },
      { key: 'hostname', value: descriptor.hostname, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentVersion', value: descriptor.version, valueType: 'TEXT' as const },
      { key: 'osType', value: descriptor.osType, valueType: 'TEXT' as const },
      { key: 'osVersion', value: descriptor.osVersion ?? null, valueType: 'TEXT' as const },
      { key: 'architecture', value: descriptor.arch ?? null, valueType: 'TEXT' as const },
      { key: 'ipAddress', value: descriptor.ipAddress ?? null, valueType: 'TEXT' as const, copyable: true },
      { key: 'agentRole', value: agent.role ?? null, valueType: 'TEXT' as const },
      { key: 'agentStatus', value: agent.status, valueType: 'STATUS' as const },
      { key: 'registeredAt', value: agent.registeredAt, valueType: 'DATETIME' as const },
      { key: 'lastHeartbeatAt', value: latestHeartbeat?.receivedAt ?? health.lastHeartbeatAt ?? null, valueType: 'DATETIME' as const },
    ],
  };
  const runtimeSection = {
    key: 'runtime',
    fields: [
      { key: 'healthStatus', value: health.status, valueType: 'STATUS' as const },
      { key: 'offline', value: health.offline, valueType: 'BOOLEAN' as const },
      { key: 'pendingTaskCount', value: taskQueue.counts.queued, valueType: 'NUMBER' as const },
      { key: 'runningTaskCount', value: taskQueue.counts.leased + taskQueue.counts.acked, valueType: 'NUMBER' as const },
      { key: 'upgradeStatus', value: upgradeSuggestion.suggestion.status, valueType: 'STATUS' as const },
      { key: 'targetVersion', value: upgradeSuggestion.suggestion.targetVersion ?? null, valueType: 'TEXT' as const },
    ],
  };
  const runtimeLogs = projection.runtimeLogs.map((log) => ({
    id: log.id,
    eventType: `agent.${log.category}`,
    result: log.level,
    summary: log.summary,
    occurredAt: log.emittedAt,
    actorId: agent.id,
    metadata: { category: log.category, level: log.level, requestId: log.requestId, redacted: log.redacted },
  }));
  const errorLogs = projection.recentErrors.map((log) => ({
    id: log.id,
    eventType: 'agent.task.error',
    result: log.level,
    summary: log.message,
    occurredAt: log.emittedAt,
    actorId: agent.id,
    metadata: { taskId: log.taskId, requestId: log.requestId, redacted: log.redacted },
  }));
  return {
    ...device,
    overview: {
      ...device.overview,
      deviceType: 'AGENT',
      managementMode: 'AGENT',
      status: device.health,
      updatedAt: agent.updatedAt,
    },
    informationSections: [device.informationSections[0] ?? { key: 'common', fields: [] }, agentSection, runtimeSection],
    sites: mergeAgentSites(device.sites, capabilitySites),
    logs: [...runtimeLogs, ...errorLogs].sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    extension: { type: 'AGENT', agentId: agent.id, agentType: agent.role },
    extensionSummary: {
      ...device.extensionSummary,
      agentId: agent.id,
      descriptor,
    },
  };
}

function buildAgentCapabilitySites(projection: AgentDetailProjection): ManagedDeviceDetailDto['sites'] {
  const capabilities = projection.capabilitySnapshot?.capabilities ?? projection.capabilities.declarations;
  const values = new Map(capabilities.map((item) => [item.capabilityKey, item.value]));
  const sites: ManagedDeviceDetailDto['sites'] = [];
  appendIisSites(sites, values.get('windows.iis.sites') ?? recordValue(values.get('windows.iis.detail'), 'Sites'));
  appendLinuxSites(sites, 'NGINX', values.get('linux.nginx.detail'));
  appendLinuxSites(sites, 'APACHE', values.get('linux.apache.detail'));
  appendTomcatSites(sites, values.get('linux.tomcat.detail'));
  return sites;
}

function appendIisSites(sites: ManagedDeviceDetailDto['sites'], raw: unknown): void {
  for (const site of objectList(raw)) {
    const name = textValue(site, 'Name') || textValue(site, 'name');
    if (!name) continue;
    const bindings = objectList(site.Bindings ?? site.bindings).map((binding, index) => ({
      id: `agent-site-binding:iis:${name}:${index}`,
      bindingKey: textValue(binding, 'BindingInformation') || textValue(binding, 'bindingInformation') || `iis:${name}:${index}`,
      bindingType: 'IIS_BINDING',
      hostName: textValue(binding, 'HostHeader') || textValue(binding, 'hostHeader') || undefined,
      status: textValue(site, 'State') || textValue(site, 'state') || 'UNKNOWN',
      certificate: capabilityCertificate(binding),
      replacement: { allowed: false, reasonCode: 'AGENT_DISCOVERY_ONLY' },
    }));
    const firstBinding = objectList(site.Bindings ?? site.bindings)[0];
    sites.push({
      id: `agent-site:iis:${name}`,
      siteAssetId: `agent-site:iis:${name}`,
      kind: 'IIS',
      name,
      status: textValue(site, 'State') || textValue(site, 'state') || undefined,
      endpoint: firstBinding ? {
        address: textValue(firstBinding, 'IPAddress') || textValue(firstBinding, 'ipAddress') || undefined,
        hostName: textValue(firstBinding, 'HostHeader') || textValue(firstBinding, 'hostHeader') || undefined,
        port: numberValue(firstBinding, 'Port') ?? numberValue(firstBinding, 'port'),
        protocol: textValue(firstBinding, 'Protocol') || textValue(firstBinding, 'protocol') || undefined,
      } : undefined,
      configPath: textValue(site, 'PhysicalPath') || textValue(site, 'physicalPath') || undefined,
      bindings,
      metadata: { source: 'agent_capability_snapshot', appPool: textValue(site, 'AppPool') || textValue(site, 'appPool') },
    });
  }
}

function appendLinuxSites(sites: ManagedDeviceDetailDto['sites'], kind: 'NGINX' | 'APACHE', raw: unknown): void {
  const detail = asRecord(raw);
  const capabilitySites = objectList(detail.Sites ?? detail.sites);
  for (const [siteIndex, site] of capabilitySites.entries()) {
    const name = textValue(site, 'Name') || textValue(site, 'name') || textValue(site, 'ServerNames') || textValue(site, 'serverNames') || `${kind} site ${sites.length + 1}`;
    const rawBindings = site.Bindings ?? site.bindings ?? site.Listen ?? site.listen;
    const bindings = objectList(rawBindings).map((binding, index) => ({
      id: `agent-site-binding:${kind.toLowerCase()}:${name}:${index}`,
      bindingKey: textValue(binding, 'BindingInformation') || textValue(binding, 'bindingInformation') || `${kind.toLowerCase()}:${name}:${index}`,
      bindingType: 'LISTEN',
      hostName: textValue(binding, 'Address') || textValue(binding, 'address') || undefined,
      status: 'UNKNOWN',
      certificate: capabilityCertificate(binding),
      replacement: { allowed: false, reasonCode: 'AGENT_DISCOVERY_ONLY' },
    }));
    const firstBinding = objectList(rawBindings)[0];
    sites.push({
      id: `agent-site:${kind.toLowerCase()}:${siteIndex}:${name}`,
      siteAssetId: `agent-site:${kind.toLowerCase()}:${siteIndex}:${name}`,
      kind,
      name,
      endpoint: firstBinding ? {
        address: textValue(firstBinding, 'Address') || textValue(firstBinding, 'address') || undefined,
        port: numberValue(firstBinding, 'Port') ?? numberValue(firstBinding, 'port'),
        protocol: textValue(firstBinding, 'Protocol') || textValue(firstBinding, 'protocol') || undefined,
      } : undefined,
      configPath: textValue(site, 'SitePath') || textValue(site, 'sitePath') || undefined,
      bindings,
      metadata: { source: 'agent_capability_snapshot' },
    });
  }
}

function appendTomcatSites(sites: ManagedDeviceDetailDto['sites'], raw: unknown): void {
  const detail = asRecord(raw);
  for (const connector of objectList(detail.Connectors ?? detail.connectors)) {
    const port = numberValue(connector, 'Port') ?? numberValue(connector, 'port');
    const protocol = textValue(connector, 'Protocol') || textValue(connector, 'protocol') || 'HTTP';
    const name = textValue(connector, 'Name') || textValue(connector, 'name') || `Tomcat ${protocol}:${port ?? sites.length + 1}`;
    const address = textValue(connector, 'Address') || textValue(connector, 'address') || undefined;
    const bindingKey = `${address ?? '*'}:${port ?? 0}:${protocol}`;
    sites.push({
      id: `agent-site:tomcat:${name}`,
      siteAssetId: `agent-site:tomcat:${name}`,
      kind: 'TOMCAT',
      name,
      endpoint: { address, port, protocol },
      configPath: textValue(detail, 'ConfigPath') || textValue(detail, 'configPath') || undefined,
      bindings: [{
        id: `agent-site-binding:tomcat:${bindingKey}`,
        bindingKey,
        bindingType: 'CONNECTOR',
        hostName: address,
        status: 'UNKNOWN',
        certificate: capabilityCertificate(connector),
        replacement: { allowed: false, reasonCode: 'AGENT_DISCOVERY_ONLY' },
      }],
      metadata: { source: 'agent_capability_snapshot' },
    });
  }
}

function capabilityCertificate(binding: Record<string, unknown>): ManagedDeviceDetailDto['sites'][number]['bindings'][number]['certificate'] {
  const certificate = asRecord(binding.Certificate ?? binding.certificate);
  const fingerprint = textValue(certificate, 'FingerprintSHA256')
    || textValue(certificate, 'fingerprintSha256')
    || textValue(certificate, 'Thumbprint')
    || textValue(certificate, 'thumbprint')
    || textValue(binding, 'CertificateThumbprint')
    || textValue(binding, 'certificateThumbprint');
  const subject = textValue(certificate, 'Subject') || textValue(certificate, 'subject');
  const name = textValue(binding, 'CertificateName') || textValue(binding, 'certificateName');
  if (!fingerprint && !subject && !name) return undefined;
  return {
    name: name || undefined,
    subject: subject || undefined,
    issuer: textValue(certificate, 'Issuer') || textValue(certificate, 'issuer') || undefined,
    notBefore: textValue(certificate, 'NotBefore') || textValue(certificate, 'notBefore') || undefined,
    notAfter: textValue(certificate, 'NotAfter') || textValue(certificate, 'notAfter') || undefined,
    fingerprintSha256: fingerprint || undefined,
  };
}

function mergeAgentSites(existing: ManagedDeviceDetailDto['sites'], discovered: ManagedDeviceDetailDto['sites']): ManagedDeviceDetailDto['sites'] {
  const result = [...existing];
  for (const site of discovered) {
    if (!result.some((item) => siteIdentity(item) === siteIdentity(site))) result.push(site);
  }
  return result;
}

function siteIdentity(site: ManagedDeviceDetailDto['sites'][number]): string {
  return [site.kind, site.name, site.configPath, site.endpoint?.address, site.endpoint?.hostName, site.endpoint?.port, site.endpoint?.protocol]
    .map((value) => String(value ?? '').toLowerCase())
    .join('|');
}

function recordValue(value: unknown, key: string): unknown {
  return asRecord(value)[key];
}

function objectList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return value === undefined || value === null ? '' : String(value).trim();
}

function numberValue(record: Record<string, unknown>, key: string): number | undefined {
  const value = Number(record[key]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function required(value: string | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new AppError('VALIDATION_FAILED', `${field} 不能为空`, { field });
  return normalized;
}
