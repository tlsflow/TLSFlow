---
title: Credentials
description: Create, rotate, and securely use TLSFlow credentials
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/CredentialsView.vue
  - backend/src/modules/credentials
  - backend/src/modules/secrets
testRefs: []
lastVerified: 2026-09-02
---

# Credentials

Credentials are secure login materials shared by devices, cloud accounts, plugins, and workflows. The system encrypts and saves secret values; lists and history records do not display passwords, tokens, or private key plaintext.

## Create New Credential

1. Go to "System Settings → Credentials" and click "Create Credential".
2. Fill in the name and select the credential type: Username and Password, SSH Private Key, Bearer Token, API Key, Client Certificate, DNS/Cloud Service Credential, or Browser Temporary Session.
3. Select the scope (Global, Team, Region, Host, or Plugin). If you need to restrict the scope, fill in the scope identifier.
4. Fill in the username, password, token, or certificate content according to the page prompts. For API Key, also fill in the Header/Query name used when sending.
5. Set the validity period; fill in 0 or leave blank to indicate long-term validity. Click "Save" and return to the list to confirm the status is normal.

> [Placeholder screenshot: Create credential window, highlighting basic information, scope, and secret information areas]

After saving, select this credential in the "Credential Reference" dropdown for devices, cloud accounts, or workflows; do not paste secret values directly into regular text boxes or variables.

## Browser Temporary Credential

For credentials that must be obtained after web login, find the browser temporary session in the list and click "Browser Retrieve":

1. Fill in or confirm the authentication URL, select the retrieval plugin, and set the session validity period.
2. Set a temporary link password (at least 8 characters) and click "Generate Browser Session".
3. Open the generated browser link and complete the login in the isolated window; only share the link and password with the actual operator.
4. Return to the window and click "Retrieve Credential", wait for the page to display retrieval success, then save. When the session is closed, expired, or fails, click "New Session" to re-operate.

> [Placeholder screenshot: Browser temporary credential window, highlighting authentication URL, validity period, temporary link password, and "Retrieve Credential" button]

## Edit, Rotate, and Delete

- When editing, only enter new values in the secret value slots that need to be replaced; leave blank to continue using the original value. After saving, current references will use the new value.
- Before deleting, open the credential details to view "Impact Scope". If still referenced by devices, workflows, plugins, ACME certificates, or cloud accounts, you must remove references first; the page will not allow direct deletion.
- When credentials expire or show "Pending", correct and save first, confirm the status recovers, then re-run related tasks. Completed deployment records will retain the credential snapshot used at that time and will not be overwritten by rotation.

Credentials are highly sensitive information; do not transmit plaintext through screenshots, chat tools, or logs; after rotation is complete, synchronize updates to handover records for responsible personnel.
