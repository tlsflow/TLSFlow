export class AssetsDomainService {
  // 领域规则由 007 实现。这里不写业务逻辑，避免污染边界。
  describeBoundary(): string {
    return 'assets domain boundary reserved for 007';
  }
}
