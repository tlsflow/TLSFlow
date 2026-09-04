---
title: Security Considerations
description: Protect accounts, Secrets, certificates and remote connections during daily TLSFlow use
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
lastVerified: 2026-09-04
---

# Security Considerations

Use this checklist during everyday work to reduce risk when signing in, connecting targets, deploying certificates and handling incidents. It complements, but does not replace, your organization's security policy, key-custody rules or incident plan.

## Accounts and permissions

- Each person must use an individual account. Do not share administrator accounts; audit records need an identifiable owner.
- Grant the minimum permissions required for each role. Separate user administration, role management, credential access, plugin enablement, approval and deployment execution where practical.
- When a person leaves or changes responsibilities, remove roles and group memberships first, then disable the account. Confirm the change in **Audit Logs**.
- A visible menu is not proof of authorization. Test key operations with real role accounts, including viewing certificates, editing assets, approving deployments and exporting audit evidence.

## Secrets and certificates

- Store passwords, API Tokens, SSH private keys, client certificates, PFX/JKS passwords and webhook keys in **System Settings → Credentials**. Business pages should reference credential profiles instead of containing secret values.
- Never put Secrets in notes, workflow descriptions, screenshots, chats or ordinary logs. Sensitive values should remain redacted in the UI.
- After rotating a credential, notify owners of the devices, cloud accounts and automations that use it. Update every reference and test the connection.
- Use short-lived or one-time credentials for temporary sharing and revoke them immediately after use. Do not send long-lived passwords through chat tools.

## Network and remote connections

- Use HTTPS in production and restrict access to the management page and API.
- Do not expose Backend, Browser Runtime, TLS Inspector or internal debug ports directly to the public internet.
- Allow target hosts, webhooks and DNS services according to your network policy. Record temporary exceptions; never leave certificate verification disabled.
- When a connection fails, confirm the target's actual state before retrying, compensating or rolling back to avoid duplicate execution.

## Audit, backup and incident handling

1. Review **Audit Logs** and Execution Records regularly. Logins, permission changes, credential use, approvals, deployments and rollbacks should all have accountable owners.
2. Back up the database, workflows, plugins and encryption keys required for recovery. Exercise restoration in an isolated environment and restrict backup-file access.
3. If a Secret, backup or exported file is exposed, rotate related keys immediately according to your incident procedure and preserve the audit evidence.
4. For a deployment failure or external timeout, record the tenant, plan ID, run ID and local time. Cross-check Execution Records, Monitoring and Audit Logs before taking corrective action.
