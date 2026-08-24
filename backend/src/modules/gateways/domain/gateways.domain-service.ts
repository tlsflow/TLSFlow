import { AppError } from '../../../common/errors/app-error.js';
import { GatewayFailoverService, ReachabilityService, ZoneRouter } from '../../gateway-agents/index.js';
import type { GatewaysRepository } from '../repository/gateways.repository.js';
import type { ProbeGatewayInput, RegisterGatewayInput, RouteGatewayInput, UpdateGatewayStatusInput } from '../dto/gateways.dto.js';

export class GatewaysDomainService {
  constructor(private readonly repository: GatewaysRepository) {}

  async register(tenantId: string, input: RegisterGatewayInput) {
    return this.repository.registerGateway(tenantId, input);
  }

  async status(tenantId: string, input: UpdateGatewayStatusInput) {
    const action = input.action ?? 'status';
    if (action === 'register') {
      if (!input.agentId || !input.version || !input.zoneIds || !input.adapters) {
        throw new AppError('VALIDATION_FAILED', '注册 Gateway 需要 agentId/version/zoneIds/adapters');
      }
      return this.register(tenantId, {
        agentId: input.agentId,
        zoneIds: input.zoneIds,
        version: input.version,
        adapters: input.adapters,
        capabilities: input.capabilities,
        currentLoad: input.currentLoad,
        maxConcurrentTasks: input.maxConcurrentTasks,
        successRate: input.successRate,
      });
    }

    const gatewayId = await this.resolveGatewayId(tenantId, input);
    if (action === 'disable') return this.repository.updateGatewayStatus(tenantId, gatewayId, { status: 'disabled' });
    if (action === 'revoke') return this.repository.updateGatewayStatus(tenantId, gatewayId, { status: 'revoked' });

    return this.repository.updateGatewayStatus(tenantId, gatewayId, {
      status: input.status ?? (action === 'heartbeat' ? 'online' : undefined),
      version: input.version,
      zoneIds: input.zoneIds,
      adapters: input.adapters,
      capabilities: input.capabilities,
      currentLoad: input.currentLoad,
      maxConcurrentTasks: input.maxConcurrentTasks,
      successRate: input.successRate,
    });
  }

  async route(tenantId: string, input: RouteGatewayInput) {
    const { zones, gateways } = await this.repository.toZoneRouterInputs(tenantId);
    const persistedReachability = await this.repository.listReachability(tenantId, undefined, input.targetId);
    const reachability = new ReachabilityService();
    for (const record of persistedReachability) {
      const ttlSeconds = Math.max(1, Math.ceil((new Date(record.expiresAt).getTime() - new Date(record.checkedAt).getTime()) / 1000));
      reachability.upsert({
        gatewayId: record.gatewayId,
        targetId: record.targetId,
        protocol: record.protocol,
        port: record.port,
        status: record.status,
        latencyMs: record.latencyMs,
        ttlSeconds,
        now: new Date(record.checkedAt),
      });
    }
    return new ZoneRouter(zones, gateways, reachability, new GatewayFailoverService()).route(input);
  }

  async probe(tenantId: string, input: ProbeGatewayInput) {
    const gateway = await this.repository.getGateway(tenantId, input.gatewayId);
    if (!gateway) throw new AppError('RESOURCE_NOT_FOUND', 'Gateway 不存在', { gatewayId: input.gatewayId });
    if (input.zoneId && !gateway.zoneIds.includes(input.zoneId)) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 不属于目标 Zone', { gatewayId: input.gatewayId, zoneId: input.zoneId });
    }
    const protocol = normalizeProbeProtocol(input.protocol);
    if (!gateway.adapters.includes(protocol)) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 不支持该探测通道', { gatewayId: input.gatewayId, protocol });
    }
    return this.repository.upsertReachability(tenantId, {
      gatewayId: input.gatewayId,
      targetId: input.targetId,
      protocol,
      port: input.port,
      status: input.status ?? 'reachable',
      latencyMs: input.latencyMs,
      ttlSeconds: input.ttlSeconds ?? 300,
    });
  }

  private async resolveGatewayId(tenantId: string, input: UpdateGatewayStatusInput): Promise<string> {
    if (input.gatewayId) return input.gatewayId;
    if (input.agentId) {
      const gateway = await this.repository.findGatewayByAgentId(tenantId, input.agentId);
      if (gateway) return gateway.id;
    }
    throw new AppError('VALIDATION_FAILED', 'gatewayId 或 agentId 不能为空', { field: 'gatewayId' });
  }
}

function normalizeProbeProtocol(protocol: ProbeGatewayInput['protocol']): ProbeGatewayInput['protocol'] {
  const normalized = String(protocol).trim().toLowerCase();
  if (['http', 'https', 'curl', 'probe.http'].includes(normalized)) return 'probe.http';
  if (['tcp', 'tls', 'probe.tcp'].includes(normalized)) return 'probe.tcp';
  if (['agent', 'probe.agent'].includes(normalized)) return 'probe.agent';
  throw new AppError('VALIDATION_FAILED', 'Gateway probe 只允许 probe.tcp、probe.http、probe.agent；CURL 只能归一为 probe.http', { protocol });
}
