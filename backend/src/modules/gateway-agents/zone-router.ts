import type {
  GatewayAgentProfile,
  GatewayCandidate,
  GatewayStatus,
  Zone,
  ZoneMaintenanceWindow,
  ZoneRouteRequest,
  ZoneRouteResult,
} from './gateway-agent.types.js';
import { assertGatewayRouteChannel } from './gateway-agent.types.js';
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
    const protocols = request.protocols.map((protocol, index) => assertGatewayRouteChannel(protocol, `protocols[${index}]`));
    const now = request.now ?? new Date();
    const zone = this.zones.find((item) => item.id === request.zoneId);
    if (!zone?.enabled) return this.blocked('zone_disabled');

    if (request.lockedTargetIds?.includes(request.targetId)) return this.blocked('target_locked');
    if (request.action && !this.isActionAllowed(zone.policy.allowedActions, request.action)) return this.blocked('action_not_allowed');
    if (!this.isInsideMaintenanceWindow(zone.policy.maintenanceWindow, now)) return this.blocked('maintenance_window_closed');

    const gatewayPool = this.gateways.filter((gateway) => gateway.zoneIds.includes(request.zoneId));
    if (gatewayPool.length === 0) return this.blocked('no_gateway');
    if (zone.policy.maxConcurrentTasks !== undefined) {
      const currentZoneLoad = gatewayPool.reduce((sum, gateway) => sum + gateway.currentLoad, 0);
      if (currentZoneLoad >= zone.policy.maxConcurrentTasks) return this.blocked('zone_concurrency_limit');
    }

    if (zone.policy.requireApproval && this.needsApproval(request)) {
      return {
        status: 'approvalRequired',
        candidateGateways: [],
        missingCapabilities: [],
        fallbackSuggestions: [],
        approvalReason: 'zone_requires_approval',
      };
    }

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

      const adapterAllowed = protocols.some((protocol) => gateway.adapters.includes(protocol));
      if (!adapterAllowed) continue;
      sawGatewayWithCapability = true;

      const zoneAdapterAllowed =
        !zone.policy.allowedAdapters || protocols.some((protocol) => zone.policy.allowedAdapters?.includes(protocol));
      if (!zoneAdapterAllowed) continue;

      const record = this.reachability.findAny(gateway.id, request.targetId, protocols, now);
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
        status: 'selected',
        selectedGateway: ranked[0].gateway,
        candidateGateways: ranked,
        missingCapabilities: [],
        fallbackSuggestions: [],
      };
    }

    const blockedReason = sawExpired ? 'reachability_expired' : sawGatewayWithCapability ? 'unreachable' : 'capability_missing';
    return {
      status: 'blocked',
      candidateGateways: [],
      missingCapabilities: [...missingCapabilities],
      fallbackSuggestions: this.failover.fallbackFor(blockedReason),
      blockedReason,
    };
  }

  private blocked(blockedReason: NonNullable<ZoneRouteResult['blockedReason']>): ZoneRouteResult {
    return {
      status: 'blocked',
      candidateGateways: [],
      missingCapabilities: [],
      fallbackSuggestions: this.failover.fallbackFor(blockedReason),
      blockedReason,
    };
  }

  private isActionAllowed(allowedActions: string[] | undefined, action: string): boolean {
    return !allowedActions || allowedActions.includes(action);
  }

  private needsApproval(request: ZoneRouteRequest): boolean {
    if (request.destructive) return true;
    if (!request.action) return false;
    return ['write', 'install', 'upgrade', 'delete', 'remove', 'exec', 'upload'].includes(request.action);
  }

  private isInsideMaintenanceWindow(window: ZoneMaintenanceWindow | undefined, now: Date): boolean {
    if (!window) return true;

    const parts = this.getWindowTimeParts(now, window.timeZone);
    if (window.daysOfWeek && !window.daysOfWeek.includes(parts.weekday)) return false;

    const currentMinute = parts.hour * 60 + parts.minute;
    const startMinute = this.parseClockMinute(window.start);
    const endMinute = this.parseClockMinute(window.end);

    if (startMinute === endMinute) return true;
    if (startMinute < endMinute) return currentMinute >= startMinute && currentMinute < endMinute;
    return currentMinute >= startMinute || currentMinute < endMinute;
  }

  private getWindowTimeParts(now: Date, timeZone = 'UTC'): { weekday: number; hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? '0';
    return {
      weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday')),
      hour: Number(value('hour')),
      minute: Number(value('minute')),
    };
  }

  private parseClockMinute(value: string): number {
    const [hour, minute] = value.split(':').map((part) => Number(part));
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error(`维护窗口时间格式错误: ${value}`);
    }
    return hour * 60 + minute;
  }
}
