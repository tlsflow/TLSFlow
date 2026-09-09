---
title: Security Considerations
description: Key, permission, network, and audit requirements for TLSFlow v1.0.0 production use
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/security
  - backend/src/modules/secrets
  - backend/src/modules/audits
  - docker/docker-compose.yml
testRefs: []
lastVerified: 2026-08-22
---

# Security Considerations

The following rules are for daily administrators and operations personnel, focusing on protecting accounts, credentials, certificates, and remote connections.

## Accounts and Permissions

- Each person uses their own account; do not share administrator accounts.
- Assign the minimum scope required to complete work by role; credential management, plugin enablement, approval, and deployment execution should ideally be handled by different personnel.
- When personnel leave or responsibilities change, first remove roles and group memberships, then disable accounts, and review audit logs to confirm changes are complete.
- Whether menus display cannot represent actual permission checks; verify key operations once with real role accounts.

## Credentials and Certificates

- Passwords, API Tokens, SSH private keys, client certificates, PFX/JKS passwords, and webhook secrets should be uniformly saved to "System Settings → Credentials"; business pages only select credential profiles.
- Do not write confidential values into notes, workflow descriptions, screenshots, chats, or regular logs.
- After credential rotation, notify device, cloud account, and automation task owners that use it, and update references promptly.
- Use short validity periods and one-time passwords for temporary sharing or browser sessions; close immediately after use.

## Network Connections

- Production environments use HTTPS and restrict management page access scope.
- Do not expose internal debug ports or remote control ports directly to the public internet.
- Allow target hosts, webhooks, and DNS services according to network policies; do not disable certificate verification long-term for temporary troubleshooting.

## Auditing and Exception Handling

1. Regularly open "Audit Logs" and execution records to check whether logins, permission changes, credential usage, approvals, deployments, and rollbacks all have responsible parties.
2. When external connections show unknown or timeout, first confirm actual status at the target service before deciding to retry, compensate, or rollback to avoid repeated execution.
3. Back up databases, workflows, plugins, and keys required for recovery, and regularly practice recovery in isolated environments.
4. Restrict backup file access; when backups are leaked, immediately rotate related keys according to credential leak procedures.

> [Screenshot placeholder: System settings page highlighting users, credentials, notifications, licenses, and other security management entries]
