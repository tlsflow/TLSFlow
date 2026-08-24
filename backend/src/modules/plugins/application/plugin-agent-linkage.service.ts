import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { LocalAgentAuthorizationServicesV1 } from '../../agents/security/local-agent-authorization.service.js';
import { PgAgentsRepository } from '../../agents/repository/agents.repository.js';
import { ManagedTargetContextResolver } from '../../assets/application/managed-target-context.resolver.js';
import { PgAssetsRepository } from '../../assets/repository/assets.repository.js';
import { PgDeviceAssetsRepository } from '../../device-assets/repository/device-assets.repository.js';
import { ManagedTargetPluginQueryService } from './managed-target-plugin-query.service.js';
import { UnifiedPluginsApplicationService } from './unified-plugins.application-service.js';
import { PgUnifiedPluginsRepository } from '../repository/unified-plugins.repository.js';

const policyRef = 'certificate-update-policy';
const policyVersion = '1';

export class PluginAgentLinkageService {
  private readonly assets: PgAssetsRepository;
  private readonly plugins: UnifiedPluginsApplicationService;
  private readonly targets: ManagedTargetContextResolver;
  private readonly capabilities: ManagedTargetPluginQueryService;

  constructor(private readonly db: DatabasePort, private readonly localAuthority?: LocalAgentAuthorizationServicesV1) {
    this.assets = new PgAssetsRepository(db);
    this.plugins = new UnifiedPluginsApplicationService(new PgUnifiedPluginsRepository(db));
    this.targets = new ManagedTargetContextResolver(this.assets, new PgAgentsRepository(db), new PgDeviceAssetsRepository(db));
    this.capabilities = new ManagedTargetPluginQueryService(db);
  }

  async getStatus(tenantId: string, applicationAssetId: string): Promise<LinkageStatus> {
    const asset = await this.assets.getServiceAssetDetail(tenantId, applicationAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', 'Application 不存在', { applicationAssetId });
    const targetId = asset.targetBinding?.managedTargetId;
    if (!targetId) return emptyStatus(applicationAssetId, '应用资产尚未绑定 ManagedTarget');
    const context = await this.targets.resolve(tenantId, targetId);
    const effective = await this.capabilities.getEffectiveCapability({ tenantId, managedTargetId: targetId, applicationAssetId, capabilityKey: 'certificate.deploy' });
    const agent = context.agent;
    const plugin = await this.plugins.getVersion(effective.plugin.pluginVersionId);
    const plan = readPlan(plugin, 'certificate.deploy');
    const actions = [...new Set((plan.operations ?? []).map((item) => String(item.operationType)).filter(Boolean))];
    const coverage = agent && this.localAuthority
      ? this.localAuthority.executionPolicy.inspect({ tenantId, agentId: agent.id, pluginId: effective.plugin.pluginId, pluginVersionId: effective.plugin.pluginVersionId, capability: 'certificate.deploy', policyRef, policyVersion })
      : { configured: false, matchedIdentity: false, reason: this.localAuthority ? 'Agent 不可用' : '当前环境未启用本机 Authority' };
    const missingActions = coverage.binding ? actions.filter((action) => !coverage.binding!.actions.includes(action)) : actions;
    const healthy = Boolean(agent && effective.compatible && coverage.matchedIdentity && missingActions.length === 0);
    return {
      applicationAssetId,
      status: healthy ? 'HEALTHY' : coverage.matchedIdentity ? 'POLICY_ACTIONS_MISSING' : 'POLICY_MISSING',
      severity: healthy ? 'INFO' : 'ERROR',
      repairable: Boolean(agent && this.localAuthority && (!coverage.matchedIdentity || missingActions.length > 0)),
      checkedAt: new Date().toISOString(),
      agent: agent ? { id: agent.id, version: agent.descriptor.version, status: agent.status } : undefined,
      plugin: { id: effective.plugin.pluginId, versionId: effective.plugin.pluginVersionId, version: effective.plugin.version, bindingId: effective.binding.pluginBindingId },
      policy: { policyRef, policyVersion, configured: coverage.configured, matchedIdentity: coverage.matchedIdentity, requiredActions: actions, missingActions },
      issues: [
        ...(!agent ? [{ code: 'AGENT_UNAVAILABLE', message: 'ManagedTarget 没有可用 Agent' }] : []),
        ...(!effective.compatible ? [{ code: 'PLUGIN_INCOMPATIBLE', message: '当前插件版本与 ManagedTarget 不兼容' }] : []),
        ...(!coverage.matchedIdentity ? [{ code: 'POLICY_MISSING', message: coverage.reason ?? '本机执行策略未覆盖当前插件版本' }] : []),
        ...(missingActions.length > 0 ? [{ code: 'POLICY_ACTIONS_MISSING', message: '本机执行策略未覆盖 Agent Plan 操作', expected: actions, actual: coverage.binding?.actions ?? [] }] : []),
      ],
      repairActions: [{ type: 'SYNC_LOCAL_POLICY', available: Boolean(agent && this.localAuthority && (!coverage.matchedIdentity || missingActions.length > 0)) }, { type: 'RECHECK', available: true }],
    };
  }

  async repair(tenantId: string, applicationAssetId: string) {
    const before = await this.getStatus(tenantId, applicationAssetId);
    if (before.status === 'HEALTHY') return { before, applied: [], after: before };
    if (!this.localAuthority) throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '生产环境必须由 Policy Authority 修复本机策略联动', { fallback: false });
    if (!before.agent || !before.plugin) throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '缺少 Agent 或插件上下文，无法精确修复策略', { fallback: false });
    const versions = await this.plugins.listVersions(tenantId);
    const candidates = versions.filter((item) => item.pluginId === before.plugin!.id && item.id !== before.plugin!.versionId);
    let source: string | undefined;
    for (const candidate of candidates) {
      const coverage = this.localAuthority.executionPolicy.inspect({ tenantId, agentId: before.agent.id, pluginId: before.plugin.id, pluginVersionId: candidate.id, capability: 'certificate.deploy', policyRef, policyVersion });
      if (coverage.matchedIdentity) { source = candidate.id; break; }
    }
    if (!source) throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', '没有可复制的旧插件精确策略绑定，不能自动放宽权限', { fallback: false });
    const applied = this.localAuthority.executionPolicy.copyBinding({ tenantId, agentId: before.agent.id, pluginId: before.plugin.id, sourcePluginVersionId: source, targetPluginVersionId: before.plugin.versionId, capability: 'certificate.deploy' });
    const after = await this.getStatus(tenantId, applicationAssetId);
    return { before, applied: [{ type: 'SYNC_LOCAL_POLICY', sourcePluginVersionId: source, targetPluginVersionId: before.plugin.versionId, matchedIdentity: applied.matchedIdentity }], after };
  }
}

function readPlan(plugin: Awaited<ReturnType<UnifiedPluginsApplicationService['getVersion']>>, capability: string): { operations?: Array<{ operationType?: string }> } {
  const path = plugin.manifest.resources.agentPlans?.[capability];
  if (!path || !plugin.resources[path]) return {};
  try { return JSON.parse(plugin.resources[path]) as { operations?: Array<{ operationType?: string }> }; } catch { return {}; }
}

export interface LinkageStatus {
  applicationAssetId: string;
  status: string;
  severity: string;
  repairable: boolean;
  checkedAt: string;
  agent?: { id: string; version: string; status: string };
  plugin?: { id: string; versionId: string; version: string; bindingId: string };
  policy?: { policyRef: string; policyVersion: string; configured: boolean; matchedIdentity: boolean; requiredActions: string[]; missingActions: string[] };
  issues: Array<{ code: string; message: string; expected?: unknown; actual?: unknown }>;
  repairActions: Array<{ type: string; available: boolean }>;
}

function emptyStatus(applicationAssetId: string, message: string): LinkageStatus {
  return { applicationAssetId, status: 'REPAIR_REQUIRED', severity: 'ERROR', repairable: false, checkedAt: new Date().toISOString(), issues: [{ code: 'MANAGED_TARGET_MISSING', message }], repairActions: [{ type: 'RECHECK', available: true }] };
}
