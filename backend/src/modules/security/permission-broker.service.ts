import { assertApprovalIfRequired } from '../../common/guards/approval.guard.js';
import type { RequestContext, ResourceDescriptor, RiskLevel, SecuritySubject } from '../../shared/security-types.js';
import type { RBACService } from '../rbac/rbac.service.js';
import type { ApprovalService } from '../approvals/approval.service.js';
import type { ExecutionGrantService } from '../executions/execution-grant.service.js';
import type { PluginPermissionManifest, PluginPermissionService } from '../plugins/plugin-permission.service.js';
import { parseSecretRef } from '../secrets/secret-ref.js';

export interface GrantForExecutorInput {
  subject: SecuritySubject;
  action: string;
  resource: ResourceDescriptor;
  operationType?: string;
  riskLevel?: RiskLevel;
  approvalId?: string;
  approvalParameters?: unknown;
  runId: string;
  stepId: string;
  executorType: string;
  allowedSecretRefs: string[];
  expiresAt: string;
  context?: RequestContext;
}

export interface GrantForPluginInput extends GrantForExecutorInput {
  manifest: PluginPermissionManifest;
}

export class PermissionBroker {
  constructor(
    private readonly rbac: RBACService,
    private readonly approvals: ApprovalService,
    private readonly grants: ExecutionGrantService,
    private readonly pluginPermissions: PluginPermissionService,
  ) {}

  createExecutorGrant(input: GrantForExecutorInput) {
    this.rbac.assertCan(input.subject, input.action, input.resource, input.context ?? {});
    // 授权 Grant 是执行器拿 Secret 和动作权限的最后闸门。
    // 高风险操作不能只靠调用方“自觉”先过 ApprovalGuard；Broker 必须自己失败关闭。
    assertApprovalIfRequired(
      this.approvals,
      input.operationType ?? input.action,
      input.riskLevel ?? 'low',
      input.approvalId,
      input.approvalParameters ?? this.defaultApprovalParameters(input),
    );
    return this.grants.create({
      runId: input.runId,
      stepId: input.stepId,
      executorType: input.executorType,
      allowedSecretRefs: input.allowedSecretRefs,
      allowedActions: [input.action],
      expiresAt: input.expiresAt,
    });
  }

  createPluginGrant(input: GrantForPluginInput) {
    for (const secretRef of input.allowedSecretRefs) {
      const parsed = parseSecretRef(secretRef);
      this.pluginPermissions.assertDeclaredPermission(input.manifest, input.action, parsed.type);
    }
    return this.createExecutorGrant(input);
  }

  private defaultApprovalParameters(input: GrantForExecutorInput): unknown {
    return {
      action: input.action,
      resource: input.resource,
      runId: input.runId,
      stepId: input.stepId,
      executorType: input.executorType,
      allowedSecretRefs: input.allowedSecretRefs,
    };
  }
}
