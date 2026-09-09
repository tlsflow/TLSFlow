---
title: Tenant and RBAC
description: Manage tenant architecture, administrators and role-based access scopes
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/TenantArchitectureView.vue
  - backend/src/modules/security
  - backend/src/modules/rbac
testRefs: []
lastVerified: 2026-09-04
---

# Tenant and RBAC

A tenant isolates people, devices, certificates and application assets. RBAC (role-based access control) determines which members can view, edit, approve or execute an operation. Define organizational boundaries first, then assign roles and members.

## Plan access

- Use tenants to separate companies, teams or environments that must not share resources.
- Use roles to describe responsibilities, such as read-only viewer, certificate manager, deployment approver and audit viewer.
- Use groups to grant the same role to a team instead of maintaining users one by one.
- Where practical, separate high-risk capabilities such as credentials, plugins, approvals and deployment execution.

## View and change tenant architecture

Open **System Settings → Tenant Architecture** to see whether the current setup is single-tenant or hierarchical. Before enabling hierarchical mode, review the existing data and resolve every blocker, then select **Enable** during a maintenance window. To return to single-tenant mode, use **Rollback** and retain the approval record.


## Create company nodes and administrators

In hierarchical mode:

1. In **Create Company Node**, enter the name, code and parent node, then select **Create**.
2. In **Add Administrator**, choose the company node, enter the user subject ID and select **Add**.
3. Verify the node status, current tenant and administrators in the tree. Select **Revoke Administrator** to correct an assignment.
4. Select **Suspend** when a node must be paused, and **Resume** after the recovery conditions are met. The node status affects members and resources below it.

## Assign and verify roles

1. Create or adjust roles in **System Settings → Roles**, then assign them to users or groups in **System Settings → Users**.
2. Have affected personnel sign in again so new memberships take effect.
3. Test key operations with real role accounts, including viewing certificates, editing assets, approving deployments and viewing audit logs.
4. Confirm role, group, tenant-administrator and node-status changes in **Audit Logs**.

One person may have multiple roles; the system calculates the effective permissions together. Do not infer authorization from menu visibility alone.
