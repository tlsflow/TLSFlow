---
title: CA Operations
description: Review certificate-authority observations, synchronization, and internal CA management
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/ca-operations/CaOperationsView.vue
  - web/src/views/internal-ca/InternalCaView.vue
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-09-04
---

# CA Operations

The CA (Certificate Authority) page shows the status and observed objects of connected certificate authorities. It is for operational review and synchronization, not the everyday certificate deployment path.


## Review CA Objects

1. Open “Certificate Management → CA Operations” and select a CA.
2. Select “Refresh” to load the latest tree and Agent observation summary.
3. Switch object views to review requests, issued certificates, revoked certificates, or templates.
4. Filter by subject, identifier, or status, then select “Query”.
5. Open CA status to review Agent connectivity, latest heartbeat, latest observation time, and record statistics.

Times in the page use the browser’s local time. When an Agent is offline or its observation is old, the list may not reflect the current CA state.

## Refresh and Synchronize

After selecting a CA, “Refresh Agent and Query” asks the managed Agent to observe again and reload records. Depending on CA type and permissions, the action may only query existing data and not trigger an Agent observation.

A refresh or synchronization failure means that this observation did not complete; it does not delete objects in the CA. Open the failure details, fix connectivity, permissions, or Agent status, and retry.


## Manage an Internal CA

Select “Manage Internal CA” to open the internal CA management window. Administrators can maintain trust domains, certificate authorities, certificate Profiles, certificate requests, and trust distributions. Creating or retiring a CA, issuing or revoking certificates, and changing key material are high-risk actions that require a preview and confirmation.

Before retiring a CA or trust domain, check Certificate Assets and ACME Automation for usage relationships, renewal policies, and running tasks. The system rejects high-risk operations that lack confirmation or still have active references.
