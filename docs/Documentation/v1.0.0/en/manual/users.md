---
title: Users
description: Create and maintain TLSFlow tenant users
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/UsersView.vue
  - backend/src/modules/security
testRefs: []
lastVerified: 2026-08-22
---

# Users

The "Users" page is used to maintain personnel accounts that can log into the current tenant and view account source, status, tenant affiliation, and roles.

## Creating Local Users

1. Navigate to "System Settings → Users", confirm the "Users" tab is selected, and click "Create User".
2. In "Creation Method", select "Local User".
3. Fill in username, display name, email, and initial password; display name is used for identifying personnel on pages and in operation records.
4. In the "Role" dropdown, select the role corresponding to their responsibilities. When temporarily uncertain about permissions, first select read-only role and adjust later.
5. Click "Create User", return to the list, and confirm status is "Enabled". Deliver username and initial password to the individual through secure channels and remind them to change password after first login.

> [Screenshot placeholder: User list page highlighting "Create User" button, user/group tabs, and main information columns]

## Adding Users from Identity Sources

If administrators have already configured identity sources (such as enterprise directory), you can select "Identity Source User" in the creation dialog:

1. Select identity source and enter directory username.
2. Click "Retrieve User", verify returned name, email, and other information to confirm correct person.
3. Select role and save. The system will retain this person's association with the identity source; subsequent logins use enterprise directory accounts.

When user cannot be retrieved, first confirm identity source is available and username spelling is correct, then contact identity source administrator; do not create duplicate local accounts to bypass retrieval.

## Managing User Groups

Switch to "Groups" tab to view user groups. After clicking "Add Group", you can select "Local Group" to fill in group name and code, or select "Identity Source Group" and retrieve directory groups. Groups can receive permissions in bulk on the "Roles" page, suitable for managing access scope by team.

> [Screenshot placeholder: Add group dialog highlighting local group/identity source group selection and "Retrieve Group" button]

## Editing, Disabling, and Deleting

- Click "Edit" in user row to modify display name, email, role, and status. Changing status to "Disabled" will prevent new logins but retain historical operation records, suitable for resignation or long-term suspension scenarios.
- Before deletion, first confirm the user has no pending approvals, deployment responsibilities, or other handover matters. Deletion will remove account-associated local credentials and role assignments; deletion operation requires re-entering `DELETE` for confirmation.
- Multiple users can be checked and batch deleted. Built-in administrator account cannot be checked for deletion; please only use it for management work, not as daily deployment account.

When personnel responsibilities change, it's recommended to first adjust roles and group memberships, then disable accounts, and finally go to "Audit Logs" to confirm changes have been recorded.
