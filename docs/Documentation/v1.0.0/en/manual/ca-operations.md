---
title: CA Operations
description: View CA hierarchy, synchronization objects, and internal CA management entry
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/ca-operations/CaOperationsView.vue
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-09-02
---

# CA Operations

The CA (Certificate Authority) page is used to view certificate issuance sources, synchronize objects in CA, and enter the internal CA management entry. The left side shows the CA tree, and the right side shows the object list and synchronization status.

1. Go to "Certificate Management → CA Operations" and click "Refresh" to load the CA tree.
2. Select a CA on the left, and switch object types such as "Requests, Issued, Revoked, Templates" on the right.
3. Use the search box to filter records by name, number, or status, then click "Query".
4. When data needs updating, click "Sync", select object scope and sync mode, then confirm.
5. In synchronization records, view "Queued, Executing, Success, Failed" status; when failed, open details to view reason.

> [Screenshot placeholder: CA Operations page showing left CA tree, object type switching, and query area]
>
> [Screenshot placeholder: Sync confirmation window showing sync scope and sync mode]

Clicking "Manage Internal CA" opens the internal CA management window. Operations involving issuance, revocation, or key changes will require reconfirmation; synchronization failure only means this update is incomplete, not that data in the CA was deleted.

Before disabling or retiring a CA, go to "Certificate Assets" to check usage relationships and confirm there are no certificates being deployed or awaiting renewal. High-risk operations without confirmation information will be rejected by the system.

> [Screenshot placeholder: Sync record details showing start time, object scope, status, and failure reason]
