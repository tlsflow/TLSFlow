---
title: Users
description: Create, authorize, and disable users and groups in the current tenant
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/UsersView.vue
  - backend/src/modules/security
testRefs: []
lastVerified: 2026-09-04
---

# Users

Use **System Settings → Users** to manage people and groups that can sign in to the current tenant. The page shows account source, status, email, roles, and tenant. Roles themselves are defined on the **Roles** page.

## Create a local user

1. Select the **Users** tab and click **Create User**.
2. Set the creation method to **Local User**, then enter the username, display name, email, and initial password.
3. Assign a role that matches the person's responsibilities. When the scope is not yet clear, start with a read-only role and adjust it after confirming the work scope.
4. Click **Create User** and confirm the account status in the list. Send the initial sign-in details through a secure channel and require the person to change the password after the first login.


## Add a user from an identity source

When an administrator has configured an identity source, such as an enterprise directory, select **Identity Source User** in the creation dialog:

1. Select the identity source and enter the directory username.
2. Click **Retrieve User** and verify the returned name and email to make sure it is the correct person.
3. Select a role and save. The person will sign in with the identity-source account, and TLSFlow will retain the association.

If the user cannot be retrieved, check the identity-source status and username spelling, then contact the identity-source administrator. Do not create a duplicate local account to bypass the lookup.

## Manage user groups

On the **Groups** tab, click **Add Group**:

- **Local Group:** Enter a group name and code.
- **Identity Source Group:** Select the identity source, enter the directory group name, retrieve it, verify the returned details, and save.

You can grant a role to the group on the **Roles** page. This is useful for maintaining permissions for a team.


## Edit, disable, or delete

- Select **Edit** in a user row to change the display name, email, role, or status. **Disabled** prevents new logins while retaining historical operation records, which is appropriate when someone leaves or is inactive for a long period.
- Before deleting, confirm that the user has no pending approvals, deployment responsibilities, or handover tasks. Deletion requires entering `DELETE` again; multiple users can be selected for batch deletion.
- The built-in administrator account cannot be selected for deletion. Use it for initialization and emergency administration, not for daily deployment work.

When responsibilities change, use this order: adjust roles or group membership, disable the account, then review **Audit Logs**. Deletion is irreversible; prefer disabling the account when possible.
