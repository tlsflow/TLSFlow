---
title: First Login
description: First login and security initialization after TLSFlow v1.0.0 container startup
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/security
  - backend/src/config
testRefs: []
lastVerified: 2026-09-02
---

# First Login

## Login Address

- Standard deployment: Open `http://<host-address>:<GCAC_PORT>/`, default port is `8085`.
- Single-node deployment: Open `http://<host-address>:8085/`; if you modified the host port with `docker run -p`, access the corresponding port.

When opening the console for the first time, you will enter the system initialization wizard. Follow the on-screen prompts to create an administrator username and password. New deployments do not need to set `GCAC_INITIAL_ADMIN_PASSWORD`; this variable is only for backward compatibility with legacy automated seeds.

After successful login, the browser will save the login state and enter the console homepage.

## Complete Immediately After Login

1. Confirm the current tenant to avoid creating assets in the wrong tenant.
2. Change the `admin` password and create a personal account for daily operations.
3. Assign minimum permissions in "System Settings → Roles" and store managed credentials in "System Settings → Credentials".
4. Confirm authorization status in "System Settings → License".
5. Import a test certificate first, then connect a test device, and complete a deployment verification with rollback capability.
6. Verify in "Audit Logs" that login, password changes, role changes, and test deployments are all recorded.

## First Connection Checklist

Before formal deployment, ensure that network egress for Agent or agentless channels is clearly defined; usernames, passwords, SSH keys, API tokens, and private keys are all saved to "System Settings → Credentials". After connection, first confirm that devices can be queried, then perform read-only discovery, verify site and certificate locations, and only then create deployment plans. Agentless targets use `Standalone + Workflow` or managed target workflow coverage and do not require separate deployment bindings.

## Login Failure Troubleshooting

- Confirm you are accessing the Web port, not the standard edition Backend's `3003` port.
- If still using legacy automated seeds, check if `GCAC_INITIAL_ADMIN_PASSWORD` is correct; modifying environment variables will not automatically reset existing user passwords.
- Check if `GCAC_TOKEN_SECRET` remains unchanged before and after restarts; changing it will invalidate existing login tokens.
- For standard edition, check `docker compose logs backend`; for small edition, check `docker logs tlsflow-small`, and address migration, database, or required secret errors first.
- If the page opens but API requests fail, check the internal proxy configuration and request ID from Web to Backend.

Login tokens (signed credentials for maintaining sessions) and Secret encryption keys must not be included in screenshots, logs, or issue tickets.
