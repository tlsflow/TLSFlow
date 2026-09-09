import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedAgentPlanPolicyAuthorityPortV1 } from '../../plugins/application/unified-agent-plan-authorization.port.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import { canonicalPluginIds } from '../../plugins/canonical-plugin-id/canonical-plugin-id.registry.js';
import type { AgentRegistration } from '../schema/agents.schema.js';

export interface AgentDiscoveryRequestFactory {
  createForAgent(input: {
    tenantId: string;
    agent: AgentRegistration;
    requestedBy: string;
    requestId: string;
    /** 是否同时刷新 Web 库存；证书根信任检查只需要通用事实。 */
    refreshWebInventory?: boolean;
  }): Promise<AgentDirectDiscoveryRequest>;
}

export interface AgentDirectDiscoveryRequest {
  requestId: string;
  payload: Record<string, unknown>;
}

/**
 * 手动 Web 重新发现直接调用 Agent Core 的管理端点。
 *
 * 发现是只读且短时的操作，不应先写入 Agent 队列再等待反向轮询。授权载荷
 * 仍使用 Agent v2 合同，Agent 只接受签名有效且范围为 application.discover
 * 的 agent.fact.collect 请求。
 */
export function createAgentDiscoveryTaskFactory(dependencies: {
  plugins: UnifiedPluginsApplicationService;
  policyAuthority: UnifiedAgentPlanPolicyAuthorityPortV1;
}): AgentDiscoveryRequestFactory {
  return {
    createForAgent: (input) => createDiscoveryRequest(dependencies, input),
  };
}

async function createDiscoveryRequest(
  dependencies: Parameters<typeof createAgentDiscoveryTaskFactory>[0],
  input: Parameters<AgentDiscoveryRequestFactory['createForAgent']>[0],
): Promise<AgentDirectDiscoveryRequest> {
  const anchor = selectAuthorizationAnchor(await dependencies.plugins.listAccessibleVersions(input.tenantId));
  if (!anchor) throw new AppError('CAPABILITY_MISSING', '没有启用且支持 Agent 发现授权的 Canonical 插件版本');

  const paths = discoveryPathsFor(input.agent);
  const refreshWebInventory = input.refreshWebInventory ?? true;
  const planDigest = digest({
    actionType: 'agent.fact.collect',
    agentId: input.agent.id,
    tenantId: input.tenantId,
    pluginId: anchor.pluginId,
    pluginVersionId: anchor.id,
    capability: 'application.discover',
    paths,
    refreshWebInventory,
  });
  dependencies.policyAuthority.assertReady();
  // 直连发现不经过 DeploymentPlan 编译链。生产 Authority 可用时，先由其为固定的
  // 只读发现范围建立精确规则；本地 Authority 不实现该入口，仍按原有逻辑签发。
  if (typeof dependencies.policyAuthority.provisionDiscoveryAuthorization === 'function') {
    await dependencies.policyAuthority.provisionDiscoveryAuthorization({
      tenantId: input.tenantId,
      agentId: input.agent.id,
      pluginId: anchor.pluginId,
      pluginVersionId: anchor.id,
      planDigest,
      allowedPaths: paths,
    });
  }
  const authorization = await dependencies.policyAuthority.issueAuthorization({
    agentId: input.agent.id,
    tenantId: input.tenantId,
    pluginId: anchor.pluginId,
    pluginVersionId: anchor.id,
    capability: 'application.discover',
    actions: ['filesystem.read', 'process.list', 'service.list'],
    allowedPaths: paths,
    allowedServices: [],
    artifactDigests: [],
    policyRef: 'gcac.agent.discovery',
    policyVersion: '1',
    planDigest,
    lifetimeSeconds: 300,
  });
  if (!authorization.token || authorization.decision.allowed !== true) {
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Web 发现授权未签发', {
      reason: authorization.decision.reason ?? 'Policy Authority 未返回允许的发现决策',
    });
  }

  return {
    requestId: input.requestId,
    payload: {
      actionType: 'agent.fact.collect',
      actionSchemaVersion: '1.0',
      requestId: input.requestId,
      agentId: input.agent.id,
      tenantId: input.tenantId,
      pluginId: anchor.pluginId,
      // Agent v2 字段历史上命名为 pluginVersion，但其安全合同绑定的是版本 ID。
      pluginVersion: anchor.id,
      capability: 'application.discover',
      actions: authorization.token.actions,
      paths: authorization.token.allowedPaths,
      services: authorization.token.allowedServices,
      artifactDigests: authorization.token.artifactDigests,
      planDigest,
      token: authorization.token,
      policyDecision: authorization.decision,
      refreshWebInventory,
      requestedBy: input.requestedBy,
    },
  };
}

function selectAuthorizationAnchor(versions: UnifiedPluginVersionRecord[]): UnifiedPluginVersionRecord | undefined {
  const candidates = versions
    .filter(isTrustedBuiltinDiscoveryPlugin)
    .filter((version) => version.manifest.capabilities.some((capability) => capability.key === 'application.discover' && capability.executionLocations.includes('AGENT')))
    .sort((left, right) => {
      return left.pluginId.localeCompare(right.pluginId) || right.version.localeCompare(left.version);
    });
  return candidates[0];
}

function discoveryPathsFor(agent: AgentRegistration): string[] {
	// 路径白名单不是发现入口。Agent 只读由实际进程、服务和命令行推导出的
	// 精确文件，因此合同中不再夹带产品安装目录或全局扫描根。
	void agent;
	return [];
}

function isTrustedBuiltinDiscoveryPlugin(version: UnifiedPluginVersionRecord): boolean {
  return version.status === 'ENABLED'
    && version.source === 'BUILTIN'
    && version.trust === 'OFFICIAL_SIGNED'
    && canonicalPluginIds.includes(version.pluginId as (typeof canonicalPluginIds)[number])
    && version.manifest.pluginId === version.pluginId
    && version.manifest.source === 'BUILTIN'
    && version.manifest.trust === 'OFFICIAL_SIGNED'
    && version.manifest.capabilities.some((capability) => capability.key === 'application.discover' && capability.executionLocations.includes('AGENT'));
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}
