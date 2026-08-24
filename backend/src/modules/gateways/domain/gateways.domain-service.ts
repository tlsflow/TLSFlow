import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import { assertGatewayRelayRouteChannel, GatewayFailoverService, ReachabilityService, ZoneRouter, type ZoneRouteResult } from '../../gateway-agents/index.js';
import type { GatewaysRepository } from '../repository/gateways.repository.js';
import type { ProbeGatewayInput, RegisterGatewayInput, RouteGatewayInput, UpdateGatewayStatusInput } from '../dto/gateways.dto.js';

const RELAY_AUTHORIZATION_TTL_SECONDS = 60;
const RELAY_CAPABILITY = 'gateway.relay.tcp';

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
    const protocols = input.protocols.map((protocol, index) => assertGatewayRelayRouteChannel(protocol, `protocols[${index}]`));
    const requiredCapabilities = normalizeRelayCapabilities(input.requiredCapabilities);
    const endpoint = await this.repository.findTargetEndpoint(tenantId, input.targetId);
    if (!endpoint) return blockedRoute('target_not_registered');

    const targetHost = normalizeTargetHost(input.targetHost ?? endpoint.host);
    const registeredHost = normalizeTargetHost(endpoint.host);
    const targetPort = input.targetPort ?? endpoint.port;
    if (targetHost !== registeredHost || targetPort !== endpoint.port) return blockedRoute('target_endpoint_mismatch');
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) return blockedRoute('port_not_allowed');
    if (endpoint.zoneId && endpoint.zoneId !== input.zoneId) return blockedRoute('target_not_allowed');

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
    const result = new ZoneRouter(zones, gateways, reachability, new GatewayFailoverService()).route({
      ...input,
      targetHost,
      targetPort,
      protocols,
      requiredCapabilities,
    });
    if (result.status !== 'selected' || !result.selectedGateway) return result;

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + RELAY_AUTHORIZATION_TTL_SECONDS * 1000);
    return {
      ...result,
      relayAuthorization: {
        routeRef: newId('relayroute'),
        tenantId,
        callerId: input.callerId?.trim() || 'system_gateway_route',
        zoneId: input.zoneId,
        gatewayId: result.selectedGateway.id,
        targetId: input.targetId,
        host: targetHost,
        port: targetPort,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async probe(tenantId: string, input: ProbeGatewayInput) {
    const gateway = await this.repository.getGateway(tenantId, input.gatewayId);
    if (!gateway) throw new AppError('RESOURCE_NOT_FOUND', 'Gateway 不存在', { gatewayId: input.gatewayId });
    if (input.zoneId && !gateway.zoneIds.includes(input.zoneId)) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 不属于目标 Zone', { gatewayId: input.gatewayId, zoneId: input.zoneId });
    }
    const protocol = normalizeProbeProtocol(input.protocol);
    if (!gateway.adapters.includes(protocol)) {
      throw new AppError('VALIDATION_FAILED', 'Gateway 不支持 relay.tcp 可达性记录', { gatewayId: input.gatewayId, protocol });
    }
    const endpoint = await this.repository.findTargetEndpoint(tenantId, input.targetId);
    if (!endpoint) throw new AppError('RESOURCE_NOT_FOUND', '目标端点未登记，不能记录 Gateway 可达性', { targetId: input.targetId });
    if (input.zoneId && endpoint.zoneId && input.zoneId !== endpoint.zoneId) {
      throw new AppError('AUTH_FORBIDDEN', '目标端点不属于指定 Zone', { targetId: input.targetId, zoneId: input.zoneId });
    }
    if (input.port !== undefined && input.port !== endpoint.port) {
      throw new AppError('VALIDATION_FAILED', '可达性端口与目标登记端口不一致', { targetId: input.targetId, expectedPort: endpoint.port, port: input.port });
    }
    return this.repository.upsertReachability(tenantId, {
      gatewayId: input.gatewayId,
      targetId: input.targetId,
      protocol,
      port: endpoint.port,
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
  if (normalized === 'relay.tcp') return 'relay.tcp';
  throw new AppError('VALIDATION_FAILED', 'Gateway 可达性记录只允许 relay.tcp，Gateway 不执行业务探测', { protocol, reason: 'GATEWAY_RELAY_ONLY' });
}

function normalizeRelayCapabilities(values: string[] | undefined): string[] {
  const capabilities = values?.map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [RELAY_CAPABILITY];
  if (capabilities.some((value) => value !== RELAY_CAPABILITY)) {
    throw new AppError('VALIDATION_FAILED', 'Gateway 路由只允许 gateway.relay.tcp 能力，旧业务能力已退役', {
      reason: 'GATEWAY_RELAY_ONLY',
      capabilities,
    });
  }
  return [RELAY_CAPABILITY];
}

function normalizeTargetHost(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/u, '');
  if (!normalized || /[\\/\s\u0000%]/u.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', '目标 host 不合法', { field: 'targetHost' });
  }
  return normalized;
}

function blockedRoute(blockedReason: NonNullable<ZoneRouteResult['blockedReason']>): ZoneRouteResult {
  return {
    status: 'blocked',
    candidateGateways: [],
    missingCapabilities: [],
    fallbackSuggestions: [],
    blockedReason,
  };
}
