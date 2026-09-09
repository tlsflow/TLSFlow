---
title: System Settings
description: System settings primary menu and secondary page operation map
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/router/menu.ts
  - web/src/edition/licensing.ts
testRefs: []
lastVerified: 2026-09-02
---

# System Settings

"System Settings" is the administrator's workbench, with common entries including:

- **Users**: Create local accounts, bind identity source accounts, and maintain user groups.
- **Roles**: Divide permission scopes by position and assign to users or groups.
- **Credentials**: Centrally save login materials needed for devices, cloud accounts, and workflows.
- **Notifications**: Manage sending channels for task results and alerts.
- **Deployment Task Parameters**: Deployment performs required validation automatically; there is no separate check action.
- **License**: View authorization status, quotas, and enabled features, import offline authorization files.
- **Version Information**: View current product version.

## Recommended Configuration Sequence

1. First establish position permissions in "Roles", then go to "Users" to create personnel and assign roles.
2. Enter and verify security materials required for connections in "Credentials".
3. Configure notification channels according to notification responsible persons.
4. In "License", confirm authorization is valid, version is compatible, and quotas are sufficient.

Select a card to open its page. Card visibility depends on the current account's permissions; if you can open a page but cannot save, contact an administrator with the required write permission.
