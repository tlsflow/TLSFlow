---
title: Execution Records
description: View certificate deployment execution status, approval, verification, and rollback results
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

An execution record is the complete result of a submission, deployment, rollback or retry. Use it to confirm how far a task progressed, which targets were affected, and whether the final result was verified. Historical records cannot be edited or deleted.

## Find and read a record

1. Open **Certificate Deployment → Execution Records** and filter by status, deployment plan, application asset, run type or time range.
2. Open a record and review its status, run type, related application and start time before reading the step timeline.
3. Check the approval, execution, verification and rollback stages, including the first failed step and its error summary.
4. Times are shown in your browser's local time. Passwords, private keys and certificate material appear only as redacted references.

Passwords, private keys, and certificate materials in execution records only display masked references. Historical records cannot be edited; retries will generate a new record.

Read statuses as **Queued/Executing → Succeeded, Failed, Cancelled or Pending Confirmation**. Pending Confirmation means the platform has not confirmed the target's final state; it is not the same as failure. Check the target certificate and service state before deciding whether to recover or retry.

## Handle failures or stuck tasks

1. For a failure, start with the first failed step and check the target, certificate version, credential and error code.
2. For an external write timeout or Pending Confirmation, do not retry immediately. Read back the target first to determine whether a change was applied.
3. If recovery is available, confirm the snapshot and scope, then start recovery. Re-check the target certificate and application accessibility afterwards.
4. For a task that is still running, use the page's **Cancel** or **Force End** action. Repeated clicks or deletion do not change a running task safely.
5. A retry creates a new execution record. Keep the original record for audit and comparison.
