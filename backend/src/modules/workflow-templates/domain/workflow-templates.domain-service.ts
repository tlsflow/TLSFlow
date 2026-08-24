export class WorkflowTemplatesDomainService {
  // 领域规则由 025 实现。这里不写业务逻辑，避免污染边界。
  describeBoundary(): string {
    return 'workflow-templates domain boundary reserved for 025';
  }
}
