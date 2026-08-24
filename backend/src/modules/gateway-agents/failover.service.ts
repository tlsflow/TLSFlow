import type { GatewayCandidate, ZoneRouteResult } from './gateway-agent.types.js';

export class GatewayFailoverService {
  rankCandidates(candidates: GatewayCandidate[]): GatewayCandidate[] {
    return [...candidates].sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.gateway.currentLoad !== right.gateway.currentLoad) return left.gateway.currentLoad - right.gateway.currentLoad;
      return left.gateway.id.localeCompare(right.gateway.id);
    });
  }

  fallbackFor(_reason: ZoneRouteResult['blockedReason']): ZoneRouteResult['fallbackSuggestions'] {
    // 路由失败只能阻断当前计划，不能偷偷切换到脚本包或人工执行路径。
    return [];
  }
}
