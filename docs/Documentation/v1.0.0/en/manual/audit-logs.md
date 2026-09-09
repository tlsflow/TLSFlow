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

Audit logs answer "who did what operation on which object at what time, and what was the result." Records are suitable for daily review, permission tracking, and issue handover.

## Viewing Audit Records

1. Navigate to "Audit Logs". The page header displays total record count, failed/rejected count, and user operation count to help identify recent anomalies.
2. In the record list, view the latest events in reverse chronological order. Each record shows result status, human-readable operation title, event type, summary, and occurrence time.
3. Click "Refresh" to reload the latest records. After completing deployments, approvals, or permission changes, refresh before verification.
4. Focus on "Failed" and "Rejected" statuses, and record object names, operators, and associated IDs from event summaries to facilitate contacting responsible parties or viewing execution details.

Screenshot placeholder: Audit logs page showing top three statistic cards, success/failure status tags, operation summaries, and local time.

## Exporting Operation Evidence

1. Click "Export Operation Evidence" in the upper right corner of the page.
2. Wait for the export result; if a failure prompt appears, record the request ID from the prompt and contact the administrator.
3. Exported content is used for audit records and issue handover. It's recommended to save it together with corresponding deployment plans, execution records, or reports.

Screenshot placeholder: "Export Operation Evidence" button in upper right corner of audit logs page and failure prompt location.

## Common Verification Scenarios

- **Login and Sessions**: Verify login success, login failure, and logout times to ensure account usage aligns with on-duty arrangements.
- **Permissions and Approvals**: Verify role adjustments, permission denials, approval creation, approval or rejection to confirm changes were authorized.
- **Certificates and Deployments**: Verify certificate imports, deployment plan creation, deployment execution, and rollback requests to confirm operators match business tickets.
- **Plugins and Workflows**: Verify plugin installation, permission denials, and workflow execution to confirm approved capabilities are being used.
- **Notifications and Automation**: Combine automation runs and notification delivery records to determine whether failures occurred in target selection, deployment execution, or message delivery.

When investigating, cross-reference plan IDs, run IDs from execution records with associated IDs in audit summaries. Don't draw conclusions from a single log entry alone.

## Security and Privacy Notice

Audit records only provide viewing evidence and do not offer editing or deletion options. Credentials, private keys, tokens, and secrets only display redacted information. Do not treat audit screenshots as credential backups.
