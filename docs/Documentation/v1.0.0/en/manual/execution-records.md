---
title: Execution Records
description: View certificate deployment execution status, pre-check, approval, verification, and rollback results
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/executions/ExecutionsView.vue
  - backend/src/modules/executions
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-09-02
---

# Execution Records

1. Go to "Certificate Deployment → Execution Records" and filter by status, application asset, task number, or time.
2. Open a record to view pre-check results, approval status, output summary for each step, and target verification results.
3. For "Pending Approval" records, complete approval first; for "Failed" records, check the first failed step and error message.
4. When the target supports rollback, execute rollback after confirming the recovery snapshot and current target status; rollback results still require readback verification.
5. When a task is stuck, use cancel or force cancel; do not delete the record directly.

Passwords, private keys, and certificate materials in execution records only display masked references. Historical records cannot be edited; retries will generate a new record.

Record status should be understood as "Pre-check → Pending Approval → Executing → Verification → Success/Failed/Status Pending". "Status Pending" means the final result of the target has not been confirmed by the platform and does not equal failure; first log into the target system or check service status, then decide on compensation or rollback. After a successful rollback, you still need to reopen the application or check the certificate to confirm that user access is actually normal.

## Page Screenshot Placeholders

> [Placeholder screenshot: Execution records list, showing status filter, application asset, and time conditions]
>
> [Placeholder screenshot: Execution details, showing step progress, failure reasons, and target verification results]
