import type {
  GatewayAgentProfile,
  GatewayCandidate,
  GatewayStatus,
  Zone,
  ZoneRouteRequest,
  ZoneRouteResult,
} from './gateway-agent.types.js';
import { GatewayFailoverService } from './failover.service.js';
import { ReachabilityService } from './reachability.service.js';

const routableStatuses: GatewayStatus[] = ['online'];

export class ZoneRouter {
  constructor(
    private readonly zones: Zone[],
    private readonly gateways: GatewayAgentProfile[],
    private readonly reachability: ReachabilityService,
    private readonly failover = new GatewayFailoverService(),
  ) {}

  route(request: ZoneRouteRequest): ZoneRouteResult {
    const now = request.now ?? new Date();
    const zone = this.zones.find((item) => item.id === request.zoneId);
    if (!zone?.enabled) return this.blocked('zone_disabled');

    const gatewayPool = this.gateways.filter((gateway) => gateway.zoneIds.includes(request.zoneId));
    if (gatewayPool.length === 0) return this.blocked('no_gateway');

    const candidates: GatewayCandidate[] = [];
    const missingCapabilities = new Set<string>();
    let sawExpired = false;
    let sawGatewayWithCapability = false;

    for (const gateway of gatewayPool) {
      if (!routableStatuses.includes(gateway.status)) continue;
      if (gateway.zoneIds.length === 0) continue;
      if (gateway.currentLoad >= gateway.maxConcurrentTasks) continue;

      const missing = (request.requiredCapabilities ?? []).filter((capability) => !gateway.capabilities.includes(capability));
      missing.forEach((capability) => missingCapabilities.add(capability));
      if (missing.length > 0) continue;

      const adapterAllowed = request.protocols.some((protocol) => gateway.adapters.includes(protocol));
      if (!adapterAllowed) continue;
      sawGatewayWithCapability = true;

      const zoneAdapterAllowed =
        !zone.policy.allowedAdapters || request.protocols.some((protocol) => zone.policy.allowedAdapters?.includes(protocol));
      if (!zoneAdapterAllowed) continue;

      const record = this.reachability.findAny(gateway.id, request.targetId, request.protocols, now);
      if (!record) continue;
      if (record.status === 'expired') {
        sawExpired = true;
        continue;
      }
      if (record.status !== 'reachable') continue;
      if (request.destructive && this.reachability.isExpired(record, now)) {
        sawExpired = true;
        continue;
      }

      const loadPenalty = gateway.maxConcurrentTasks === 0 ? 1 : gateway.currentLoad / gateway.maxConcurrentTasks;
      const latencyPenalty = Math.min((record.latencyMs ?? 100) / 1000, 1);
      const score = gateway.successRate * 100 + (zone.policy.priority ?? 0) - loadPenalty * 30 - latencyPenalty * 10;
      candidates.push({
        gateway,
        reachability: record,
        score,
        reasons: ['zone_matched', 'capability_matched', 'reachable', 'load_acceptable'],
      });
    }

    const ranked = this.failover.rankCandidates(candidates);
    if (ranked.length > 0) {
      return {
        selectedGateway: ranked[0].gateway,
        candidateGateways: ranked,
        missingCapabilities: [],
        fallbackSuggestions: [],
      };
    }

    const blockedReason = sawExpired ? 'reachability_expired' : sawGatewayWithCapability ? 'unreachable' : 'capability_missing';
    return {
      candidateGateways: [],
      missingCapabilities: [...missingCapabilities],
      fallbackSuggestions: this.failover.fallbackFor(blockedReason),
      blockedReason,
    };
  }

  private blocked(blockedReason: NonNullable<ZoneRouteResult['blockedReason']>): ZoneRouteResult {
    return {
      candidateGateways: [],
      missingCapabilities: [],
      fallbackSuggestions: this.failover.fallbackFor(blockedReason),
      blockedReason,
    };
  }
}
