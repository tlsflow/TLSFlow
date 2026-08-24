import type { FallbackSuggestion, GatewayCandidate, ZoneRouteResult } from './gateway-agent.types.js';

export class GatewayFailoverService {
  rankCandidates(candidates: GatewayCandidate[]): GatewayCandidate[] {
    return [...candidates].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.gateway.currentLoad !== right.gateway.currentLoad) return left.gateway.currentLoad - right.gateway.currentLoad;
      return left.gateway.id.localeCompare(right.gateway.id);
    });
  }

  fallbackFor(reason: ZoneRouteResult['blockedReason']): FallbackSuggestion[] {
    if (reason === 'no_gateway') return ['gateway_required', 'script_package', 'manual'];
    if (reason === 'unreachable' || reason === 'reachability_expired') return ['script_package', 'manual'];
    if (reason === 'capability_missing') return ['gateway_required', 'manual'];
    return ['manual'];
  }
}
