export class ExecutionsDomainService {
  // 领域规则由 010 实现。这里不写业务逻辑，避免污染边界。
  describeBoundary(): string {
    return 'executions domain boundary reserved for 010';
  }
}
