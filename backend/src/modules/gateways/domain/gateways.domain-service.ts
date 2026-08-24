import { AppError } from '../../../common/errors/app-error.js';
import { GatewayFailoverService, type GatewayAdapterType, type ReachabilityRecord, ReachabilityService, ZoneRouter } from '../../gateway-agents/index.js';
import type { GatewaysRepository } from '../repository/gateways.repository.js';
import type { ProbeGatewayInput, RegisterGatewayInput, RouteGatewayInput, UpdateGatewayStatusInput } from '../dto/gateways.dto.js';

export class GatewaysDomainService {
  constructor(private readonly repository: GatewaysRepository) {}

  register(tenantId: string, input: RegisterGatewayInput) {
    return this.repository.registerGateway(tenantId, input);
  }

  status(tenantId: string, input: UpdateGatewayStatusInput) {
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

    const gatewayId = this.resolveGatewayId(tenantId, input);
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

  route(tenantId: string, input: RouteGatewayInput) {
    const { zones, gateways } = this.repository.toZoneRouterInputs(tenantId);
    const reachability = new RepositoryReachabilityView(this.repository, tenantId);
    return new ZoneRouter(zones, gateways, reachability, new GatewayFailoverService()).route(input);
  }

  probe(tenantId: string, input: ProbeGatewayInput) {
    const gateway = this.repository.getGateway(tenantId, input.gatewayId);
    if (!gateway) throw new AppError('RESOURCE_NOT_FOUND', 'Gateway 不存在', { gatewayId: input.gatewayId });
    if (input.zoneId && !gateway.zoneIds.includes(input.zoneId)) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 不属于目标 Zone', { gatewayId: input.gatewayId, zoneId: input.zoneId });
    }
    if (!gateway.adapters.includes(input.protocol)) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 不支持该 Adapter', { gatewayId: input.gatewayId, protocol: input.protocol });
    }
    return this.repository.upsertReachability(tenantId, {
      gatewayId: input.gatewayId,
      targetId: input.targetId,
      protocol: input.protocol,
      port: input.port,
      status: input.status ?? 'reachable',
      latencyMs: input.latencyMs,
      ttlSeconds: input.ttlSeconds ?? 300,
    });
  }

  private resolveGatewayId(tenantId: string, input: UpdateGatewayStatusInput): string {
    if (input.gatewayId) return input.gatewayId;
    if (input.agentId) {
      const gateway = this.repository.findGatewayByAgentId(tenantId, input.agentId);
      if (gateway) return gateway.id;
    }
    throw new AppError('VALIDATION_FAILED', 'gatewayId 或 agentId 不能为空', { field: 'gatewayId' });
  }
}

class RepositoryReachabilityView extends ReachabilityService {
  constructor(private readonly repositoryView: GatewaysRepository, private readonly tenantId: string) {
    super();
  }

  override find(gatewayId: string, targetId: string, protocol: GatewayAdapterType, now = new Date()): ReachabilityRecord | undefined {
    return this.repositoryView.findReachability(this.tenantId, gatewayId, targetId, protocol, now);
  }

  override findAny(gatewayId: string, targetId: string, protocols: GatewayAdapterType[], now = new Date()): ReachabilityRecord | undefined {
    return protocols.map((protocol) => this.find(gatewayId, targetId, protocol, now)).find((record) => record !== undefined);
  }

  override isExpired(record: ReachabilityRecord, now = new Date()): boolean {
    return new Date(record.expiresAt).getTime() <= now.getTime();
  }
}
