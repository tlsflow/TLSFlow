export class PluginsDomainService {
  // 领域规则由 024 实现。这里不写业务逻辑，避免污染边界。
  describeBoundary(): string {
    return 'plugins domain boundary reserved for 024';
  }
}
