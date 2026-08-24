export class AuditsDomainService {
  // 领域规则由 005 实现。这里不写业务逻辑，避免污染边界。
  describeBoundary(): string {
    return 'audits domain boundary reserved for 005';
  }
}
