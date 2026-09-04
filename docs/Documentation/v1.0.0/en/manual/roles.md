---
title: Roles
description: Configure minimum privilege roles for TLSFlow users
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/RolesView.vue
  - backend/src/modules/rbac
testRefs: []
lastVerified: 2026-08-22
---

# Roles

Roles grant a set of business permissions to a job function. Using roles makes access easier to review and reduces accidental high-risk permissions.

## Creating Roles and Granting Permissions

1. Open **System Settings → Roles**, select **Create Role**, and enter a name and responsibility description such as "Certificate Operator" or "Audit Viewer".
2. In the "Authorizable Objects" tree, expand categories that need to be managed, select certificates, applications, logs, or system settings; after expanding categories, you can select all records or only specific records.
3. Select "Business Permission Level": general operators use "User", personnel responsible for review and management use "Manager".
4. Select permission effect. For normal authorization, select "Allow"; only use "Deny" when explicitly needing to exclude a certain scope.
5. Click "Create Role". After saving, click "Details" for this role to confirm object scope and permissions display correctly.


## Adding Permissions to Existing Roles

1. In the role list, find the target role and click "Authorize".
2. Refresh the object list, expand the object tree, and check the new scope.
3. Select permission level and effect, then click "Grant Permission".
4. Return to role "Details" to verify the "Current Role Permissions" list and confirm scope does not exceed responsibilities.

## Assigning Members

1. Click "Assign Members" in the role row.
2. In "Member Type", select "User" or "Group". Disabled users will not appear in the assignable list.
3. Check one or more members, confirm the "Selected Members" summary is correct, then click "Assign Members".
4. Review results in the "Assigned Members" list in role details.

Before deleting a role, first migrate members to other roles and confirm the role has no permission scopes still in use. Built-in roles cannot be deleted; role permission changes affect subsequent operations, and completed historical records will not be rewritten.
