export class AgentsDomainService {
  // 领域规则由 011 实现。这里不写业务逻辑，避免污染边界。
  describeBoundary(): string {
    return 'agents domain boundary reserved for 011';
  }
}
