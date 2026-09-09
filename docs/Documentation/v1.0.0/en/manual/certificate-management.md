---
title: Certificate Management
description: Understand the Certificate Management menu and choose the right preparation path
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
testRefs: []
lastVerified: 2026-09-04
---

# Certificate Management

“Certificate Management” is where you prepare certificates, maintain issuance sources, and define the output formats required for deployment. These pages prepare materials; they do not write a certificate to a server by themselves.

| Page | Use it to |
| --- | --- |
| Certificate Assets | Import certificates, review versions, fingerprints, and usage relationships |
| ACME Automation | Configure ACME providers, request certificates, and manage renewals |
| CA Operations | Review CA observations, synchronization records, and CA status |
| Certificate Format Configuration | Prepare deployment output in PEM, PFX, JKS, P7B, or DER |


## Recommended Workflow

1. Import an existing certificate in “Certificate Assets”, or create a request in “ACME Automation”.
2. If an enterprise CA is involved, confirm its status and synchronization result in “CA Operations”.
3. In the certificate version details, create the output format required by the target and confirm that password credentials are available.
4. Go to “Asset Center → Application Assets” and bind the certificate version to the business and executable target.
5. Review the page messages in “Certificate Deployment” and submit the deployment; when approval is enabled, execute only after approval.
6. Confirm target read-back in “Execution Records”, then use Monitoring and Audit Logs for operational verification.

Each step has its own completion signal: a successful import does not mean deployable, a submitted plan does not mean the service has switched, and an uploaded file does not prove that the target is serving the new certificate.

## Which Page Should I Use?

- Already have a certificate file: start with “Certificate Assets”.
- Need automatic issuance or renewal: start with “ACME Automation”.
- Need AD CS or internal CA observations and objects: open “CA Operations”.
- Need a target-specific file format: open “Format Configuration” from certificate version details.

Format configuration describes how deployment material is generated. Target selection, page validation, approvals, and installation remain part of the Certificate Deployment flow.

## Keep in Mind

- A domain can have multiple versions. Always verify domain, validity, and SHA-256 fingerprint before deployment.
- Private-key exports read saved security credentials. Never share private keys or passwords in tickets, chats, or screenshots.
- Check usage relationships and pending tasks before disabling a provider or CA, or deleting a certificate.
- Times in the UI use the browser’s local time; “Expiring Soon” and “Expired” require prompt attention.
