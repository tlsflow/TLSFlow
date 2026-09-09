---
title: Troubleshooting
description: Troubleshoot login, discovery, plugin, and certificate deployment issues by evidence sequence
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/deployment-plans
  - backend/src/modules/executions
  - backend/src/modules/audits
testRefs: []
lastVerified: 2026-08-22
---

# Troubleshooting

When encountering problems, first record facts, then locate in sequence. Do not start by changing configurations, repeatedly clicking, or recreating tasks, as this may mask the real cause.

## Step 1: Record Traceable Information

In tickets or handover records, write down tenant, operator, current page, occurrence time, task ID, and run ID. When taking screenshots, redact passwords, tokens, private keys, and complete webhook addresses.

Screenshot placeholder: Problem page error prompt highlighting request ID, task ID, or plan ID with sensitive information redacted.

## Step 2: Check by Object Category

### Login or Menu Anomalies

- Login failure: Confirm using the account and current initial password assigned by the administrator, check whether the token has expired; do not repeatedly refresh causing more failure records.
- Missing menus or unavailable buttons: Refresh the page to confirm whether it's a temporary loading issue; if still unable to display, contact the administrator for handling.
- Page displays service request failure: Record request ID and error prompt, then refresh once to confirm whether it's a temporary network issue.

### Application Asset or Device Anomalies

- View agent online status, last heartbeat, connection test, and discovery status in device details.
- Check whether the plugin version on the device is in enabled status and confirm the plugin supports the target platform.
- Confirm execution location and target address are correct; network devices or isolated zone targets need to use organization-approved gateway paths.

### Certificate Deployment Anomalies

1. Open execution records to confirm whether failure occurred in target selection, plan creation, pre-check, approval, execution, verification, rollback, or notification stage.
2. Check whether certificate version, target binding, credential authorization, and dry run summary match this task.
3. Cross-reference plan ID and run ID with operation records in "Audit Logs" to confirm operator and time.
4. When external write timeout or displays "result unknown", first read back the actual certificate and service status of the target site; do not automatically replay before confirmation to avoid repeated changes.

Screenshot placeholder: Execution record details showing step status, failure stage, error summary, and plan/run IDs.

## Step 3: Safe Recovery

Only use "Rollback" when the execution plan explicitly provides backup manifest and rollback steps. After rollback completes, re-check target service, TLS certificate, and application accessibility, and archive original failure, rollback results, and remote paths together. Do not overwrite remote files yourself when there is no recovery manifest.

## Common Prompt Quick Reference

- **Address or port error**: Confirm using the console login address and target service address provided by the administrator; do not use other internal addresses as login entries.
- **Plugin unavailable**: Check plugin version status and target compatibility; do not modify system records bypassing the plugin center.
- **Task keeps running**: First view execution steps and device heartbeat; running tasks cannot change status by repeated clicking.
- **Notification failure**: Go to "System Settings → Notifications" to view delivery request ID and failure classification; retry delivery after fixing the channel.
- **Monitoring anomaly**: First refresh and re-detect, compare detection history; a single timeout does not equal continuous failure.

## Prohibited Operations

During troubleshooting, do not bypass the page to directly modify system data or execution records. Drafts can be handled using deletion entries provided by the page; published or executed plans must be retained.
