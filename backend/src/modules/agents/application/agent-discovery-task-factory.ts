import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedAgentPlanPolicyAuthorityPortV1 } from '../../plugins/application/unified-agent-plan-authorization.port.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import type { AgentRegistration, AgentTaskEnvelope } from '../schema/agents.schema.js';
import type { AgentsRepository } from '../repository/agents.repository.js';
import { newId } from '../../../shared/id.js';

const WEB_PLUGIN_IDS = new Set(['web.nginx', 'web.apache', 'app.tomcat', 'web.iis']);
const DISCOVERY_PATHS = Object.freeze(['/etc', '/opt', '/usr/local', '/usr/share/nginx', '/srv', '/var/lib', '/var/www']);

export interface AgentDiscoveryTaskFactory {
  createForAgent(input: {
    tenantId: string;
    agent: AgentRegistration;
    requestedBy: string;
    requestId: string;
  }): Promise<AgentTaskEnvelope[]>;
}

/**
 * 手动 Web 重新发现只触发 Agent Core 的完整能力库存上报。
 *
 * 原先按 Nginx、Apache、Tomcat、IIS 分别启动 Plugin Runner，会与周期性
 * web.inventory 上报形成两个事实源；前者按监听端口拆站点且不带证书文件。
 * Plugin ID 仍仅作为 Policy Authority 的真实授权锚点，绝不再附加
 * pluginFactBinding，因此任务结果不会回流旧 Plugin Runner 投影路径。
 */
export function createAgentDiscoveryTaskFactory(dependencies: {
  repository: AgentsRepository;
  plugins: UnifiedPluginsApplicationService;
  policyAuthority: UnifiedAgentPlanPolicyAuthorityPortV1;
}): AgentDiscoveryTaskFactory {
  return {
    createForAgent: (input) => createDiscoveryTask(dependencies, input),
  };
}

async function createDiscoveryTask(
  dependencies: Parameters<typeof createAgentDiscoveryTaskFactory>[0],
  input: Parameters<AgentDiscoveryTaskFactory['createForAgent']>[0],
): Promise<AgentTaskEnvelope[]> {
  const anchor = selectAuthorizationAnchor(await dependencies.plugins.listAccessibleVersions(input.tenantId));
  if (!anchor) throw new AppError('CAPABILITY_MISSING', '没有启用且支持 Agent 发现授权的 Web 插件版本');

  const paths = discoveryPathsFor(input.agent);
  const planDigest = digest({
    actionType: 'agent.fact.collect',
    agentId: input.agent.id,
    tenantId: input.tenantId,
    pluginId: anchor.pluginId,
    pluginVersionId: anchor.id,
    capability: 'application.discover',
    paths,
    refreshWebInventory: true,
  });
  const executionRunId = `agent-web-inventory:${input.agent.id}:${input.requestId}`;
  const executionStepId = `agent-web-inventory:${input.agent.id}`;
  dependencies.policyAuthority.assertReady();
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
    throw new AppError('AGENT_AUTHORIZATION_UNAVAILABLE', 'Web 发现授权未签发');
  }

  const idempotencyKey = `agent.web-inventory:${input.agent.id}:${input.requestId}`;
  const existing = await dependencies.repository.findTaskByIdempotencyKey(input.tenantId, input.agent.id, idempotencyKey);
  if (existing) return [existing];

  const now = new Date().toISOString();
  const task = await dependencies.repository.createTask({
    id: newId('agtask'),
    tenantId: input.tenantId,
    agentId: input.agent.id,
    executionRunId,
    executionStepId,
    idempotencyKey,
    payload: {
      actionType: 'agent.fact.collect',
      actionSchemaVersion: '1.0',
      requestId: input.requestId,
      agentId: input.agent.id,
      tenantId: input.tenantId,
      pluginId: anchor.pluginId,
      // Agent v2 字段历史上命名为 pluginVersion，但其安全合同绑定的是版本 ID。
      pluginVersion: anchor.id,
      pluginVersionId: anchor.id,
      capability: 'application.discover',
      actions: authorization.token.actions,
      paths: authorization.token.allowedPaths,
      services: authorization.token.allowedServices,
      artifactDigests: authorization.token.artifactDigests,
      planDigest,
      token: authorization.token,
      policyDecision: authorization.decision,
      refreshWebInventory: true,
      requestedBy: input.requestedBy,
    },
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    requestId: input.requestId,
  });
  return [task];
}

function selectAuthorizationAnchor(versions: UnifiedPluginVersionRecord[]): UnifiedPluginVersionRecord | undefined {
  const candidates = versions
    .filter((version) => version.status === 'ENABLED' && WEB_PLUGIN_IDS.has(version.pluginId))
    .filter((version) => version.manifest.capabilities.some((capability) => capability.key === 'application.discover' && capability.executionLocations.includes('AGENT')))
    .sort((left, right) => {
      const preferred = Number(right.pluginId === 'web.nginx') - Number(left.pluginId === 'web.nginx');
      return preferred || left.pluginId.localeCompare(right.pluginId) || right.version.localeCompare(left.version);
    });
  return candidates[0];
}

function discoveryPathsFor(agent: AgentRegistration): string[] {
  return agent.descriptor.osType.toLowerCase().includes('windows')
    ? ['C:/Windows/System32/inetsrv/config/applicationHost.config', 'C:/nginx', 'C:/Apache24', 'C:/Tomcat', 'C:/ProgramData', 'C:/Program Files', 'C:/Program Files (x86)']
    : [...DISCOVERY_PATHS];
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
