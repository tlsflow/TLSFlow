---
title: Audit Logs
description: Query user operations, permissions, and task audit records in TLSFlow v1.0.0
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/audit/AuditsView.vue
  - backend/src/modules/audits
testRefs: []
lastVerified: 2026-08-22
---

# Audit Logs

Audit logs record key platform actions so you can confirm who performed an operation, on which object, when it happened, and whether it succeeded. Use them for daily review, permission tracking, change evidence, and incident handover.

## Find an operation

1. Open **Audit Logs** and review the total, failed, user-operation and successful counts at the top.
2. Search by object name, operator or event summary, then review results in reverse chronological order.
3. Select **View Details** to read the full summary, event type, related object and occurrence time. Times are shown in your browser's local time.
4. For **Failed** or **Rejected** entries, record the operator, object name and associated ID, then continue in Execution Records or the related business page.
5. Select **Refresh** after a deployment, approval or permission change to confirm that the event has been recorded.


## Exporting Operation Evidence

1. Click "Export Operation Evidence" in the upper right corner of the page.
2. Wait for the export result; if a failure prompt appears, record the request ID from the prompt and contact the administrator.
3. Exported content is used for audit records and issue handover. It's recommended to save it together with corresponding deployment plans, execution records, or reports.


## Common Verification Scenarios

- **Login and Sessions**: Verify login success, login failure, and logout times to ensure account usage aligns with on-duty arrangements.
- **Permissions and Approvals**: Verify role adjustments, permission denials, approval creation, approval or rejection to confirm changes were authorized.
- **Certificates and Deployments**: Verify certificate imports, deployment plan creation, deployment execution, and rollback requests to confirm operators match business tickets.
- **Plugins and Workflows**: Verify plugin installation, permission denials, and workflow execution to confirm approved capabilities are being used.
- **Notifications and Automation**: Combine automation runs and notification delivery records to determine whether failures occurred in target selection, deployment execution, or message delivery.

When investigating, cross-reference plan IDs, run IDs from execution records with associated IDs in audit summaries. Don't draw conclusions from a single log entry alone.

## Security and Privacy Notice

Audit records can be viewed and exported but not edited or deleted. Credentials, private keys, tokens and secrets are redacted. Protect exported files and screenshots according to your audit-data policy; they are not credential backups.
