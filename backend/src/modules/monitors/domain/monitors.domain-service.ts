export class MonitorsDomainService {
  // 领域规则由 027 实现。这里不写业务逻辑，避免污染边界。
  describeBoundary(): string {
    return 'monitors domain boundary reserved for 027';
  }
}
