---
title: Credentials
description: Securely create, use, and rotate credentials for devices and services
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/CredentialsView.vue
  - backend/src/modules/credentials
  - backend/src/modules/secrets
testRefs: []
lastVerified: 2026-09-04
---

# Credentials

Credentials are the login materials TLSFlow stores for devices, plugins, workflows, ACME certificates, and cloud services. TLSFlow stores only encrypted secret values; passwords, private keys, and tokens are not shown in lists, details, or audit records.

Open **System Settings → Credentials**.


## Create a Credential

1. Open **System Settings → Credentials** and click **Create credential**.
2. Enter a recognizable name and select a type: Password, Username and password, SSH private key, Bearer token, API key, Client certificate, DNS provider, Cloud provider, or Temporary browser session.
3. Select a scope. Global credentials can be used within the tenant according to permissions; Team, Zone, Host, and Plugin scopes limit visibility. A non-global scope requires a scope ID.
4. Enter the username, password, private key, token, or certificate requested by the form. For an API key, also specify its delivery location (Header, Query, or Cookie) and name.
5. Set the validity period. Leave it blank or enter 0 for long-term validity. Temporary browser sessions also accept separate day, hour, and minute values.
6. Click **Save** and confirm that the credential is active in the list.


After saving, select this record wherever the device, cloud service, or workflow asks for a credential reference. Never paste a password or token into a regular text field, workflow variable, screenshot, or log.

### Cloud provider credentials

When you select **Cloud provider**, the page loads the fields declared by the enabled plugin, such as access or signing keys. Fill in only the fields shown. If no provider or fields are available, ask an administrator to enable the correct plugin version. A cloud service asset must reference an enabled credential for the matching provider.

### DNS provider credentials

For **DNS provider**, select the DNS service and enter the configuration requested by that service. These credentials are primarily used for ACME DNS-01 validation and should not be reused as ordinary device passwords.

## Temporary Browser Credentials

Use a temporary browser session when a service requires web login to obtain a cookie, token, or other session value:

1. Find a credential whose type is **Temporary browser session** and click **Browser retrieve**.
2. Confirm the authentication URL, select the retrieval plugin, and set a session lifetime from 60 to 3,600 seconds.
3. Set an 8- to 128-character temporary link password, or click **Generate randomly**. Share the URL and password only with the person performing the login.
4. Open the generated browser link and sign in in the isolated window. Do not use this window for unrelated accounts.
5. Return to TLSFlow. When the session is ready, click **Retrieve credential**. Close the session after the success message appears.
6. If the session expires, closes, or fails, click **New session**. Do not continue using the old link.


Only the published plugin workflow can perform the declared extraction and verification actions. TLSFlow does not expose the Browser Runtime port directly to users.

## Edit, Rotate, and Disable

- Review **Impact** before editing. Saving a new secret causes current references to use the new value immediately.
- Leave secret fields blank to keep the existing encrypted value; enter only the values that need to change.
- If a credential expires, is marked **Pending**, or fails a health check, correct and save it before rerunning connection or deployment tasks.
- To temporarily prevent use, click **Disable** in the editor. Click **Enable** to restore use. Disabling does not delete the stored secret.
- Completed execution records retain the credential version used at the time and are not rewritten by later rotation.

## Credential Health Checks

Health checks confirm whether a credential can authenticate against an associated device. They are disabled by default and are not a substitute for deployment verification.

1. Open the credential health details to review associated devices, the latest check time, and the result.
2. Click **Manual check** to submit a check immediately. The check uses one online device that supports credential testing.
3. To check periodically, enable **Periodic credential health check** while editing the credential and select an eligible device. In **Configure**, set the tenant-wide interval (720 minutes by default; 1 to 43,200 minutes allowed).
4. Interpret the result: **Valid** means authentication succeeded; **Unreachable** indicates a network or device issue; **Error** indicates a credential or plugin problem; **Unused** means no check has run.


## Delete a Credential

Open the delete dialog and review the impact list. TLSFlow blocks deletion while the credential is referenced by a device, workflow, plugin, ACME certificate, cloud service asset, or browser session. Remove or replace those references first. Deleting an unreferenced credential also removes its unused encrypted data and cannot be undone.

## Security Practices

- Create separate credentials for different environments and purposes; avoid sharing one high-privilege credential across systems.
- Use least privilege and the shortest practical validity period. After rotation, notify the responsible operators and confirm a connection test.
- Send temporary passwords and cloud access keys only through controlled channels. Never place them in screenshots, chat history, workflow templates, or logs.
- If a credential may have been exposed, disable and rotate it immediately, then review its impact list and related execution records.
