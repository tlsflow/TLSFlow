import type { ApprovalService } from '../../modules/approvals/approval.service.js';
import { securityErrors } from '../../shared/security-error.js';
import type { RiskLevel } from '../../shared/security-types.js';

export function assertApprovalIfRequired(
  approvals: ApprovalService,
  operationType: string,
  riskLevel: RiskLevel,
  approvalId: string | undefined,
  parameters: unknown,
): void {
  if (!approvals.requiresApproval(riskLevel, operationType)) {
    return;
  }
  if (!approvalId) {
    throw securityErrors.approvalRequired({ operationType, riskLevel });
  }
  approvals.consume(approvalId, parameters);
}
