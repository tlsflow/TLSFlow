export class CapabilitiesDomainService {
  // 领域规则由 008 实现。这里不写业务逻辑，避免污染边界。
  describeBoundary(): string {
    return 'capabilities domain boundary reserved for 008';
  }
}
