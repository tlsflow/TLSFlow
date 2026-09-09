---
title: Tenant and RBAC
description: Initialize tenants, users, and role-based access control
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/security
  - backend/src/modules/rbac
  - backend/src/persistence/entities/tenant.entity.ts
testRefs: []
lastVerified: 2026-08-22
---

# Tenant and RBAC

Tenants are isolated spaces for personnel, devices, certificates, and application assets; roles determine what members can view, modify, approve, or execute. Plan tenants and roles first, then invite personnel into daily operations.

## Initializing a Tenant

1. Log in using the initial administrator and confirm the tenant name at the top is correct.
2. Open "System Settings → Roles" and create roles by position, such as read-only viewer, certificate manager, deployment approver, and audit viewer.
3. Open "System Settings → Users", create local accounts or bind identity source accounts, and assign role positions to each person.
4. When authorization by team is needed, first create teams in "Users → Groups", then add teams to corresponding roles.
5. Log in again using a regular role account to verify that the menus it sees and operations it can execute meet expectations.

> [Screenshot placeholder: System settings entry page highlighting "Users", "Groups", "Roles", and tenant management entries]

## Managing Tenant Hierarchy

View in "System Settings → Tenant Architecture" whether the current setup is single-tenant or hierarchical mode. Before switching, first run page checks, address blocking items one by one, then confirm during maintenance window. In hierarchical mode, you can add company nodes, designate administrators, and suspend or resume nodes; these operations simultaneously affect personnel and resources under that node and should retain approval records before operation.

## Checks After Permission Changes

- The same person can have multiple roles; permission scope is executed according to the system's final calculation.
- After roles, group memberships, or account status changes, have relevant personnel log in again.
- Go to "Audit Logs" to confirm permission changes are recorded, and review certificate viewing, application management, deployment approval, and log viewing with actual business accounts.
- Certificate private materials, credential management, plugin enablement, approval, and deployment execution should ideally belong to different roles to avoid a single account having all high-risk operations.
