---
title: ACME Automation
description: Configure ACME providers and automatically request and renew certificates
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/acme/AcmeOperationsView.vue
  - web/src/views/acme/AcmeCertificateRequestModal.vue
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-09-04
---

# ACME Automation

ACME (Automatic Certificate Management Environment) automates certificate requests and renewals through a public or enterprise CA. The page summarizes managed certificates, running jobs, failed jobs, and provider status.


## Configure a Provider

1. Open “Certificate Management → ACME Automation” and select “Provider Settings”.
2. Choose a built-in Profile or a custom CA and enter a display name. Enter a Directory URL when required.
3. Select a trust-chain credential when prompted and select “Probe Directory”. The result indicates whether EAB (External Account Binding) is required.
4. When EAB is required, create or select the EAB credential before saving the provider. When a contact email is supplied, the platform associates it with the ACME Account.
5. Return to the provider list, run “Test Connection”, and confirm the provider is available before creating a request.


## Request a Certificate

1. Select “New Request” and enter a certificate name, primary domain, and additional domains.
2. Choose the provider, key type, and challenge method: `HTTP-01`, `DNS-01`, or `TLS-ALPN-01` as supported by the provider.
3. For `DNS-01`, choose the DNS Provider, credential, and propagation wait time.
4. Set automatic renewal and the renewal window, then submit.
5. Review the order and job areas for queued, validation, issuance, deployment, or failure status. A successful issuance adds a new certificate version to Certificate Assets.


## Renew, Retry, or Cancel

- Manually renew a certificate from the certificate list, or edit whether its renewal policy is enabled and how many days before expiry it runs.
- Select “Scan” in renewal jobs to immediately find certificates entering their renewal window.
- Open a failed job, correct the provider, DNS, or credential issue, and select “Retry”.
- Running jobs can be canceled, but deleting a certificate asset does not stop a job. Confirm that no job is running before deleting ACME configuration.

Renewal jobs use the provider and domain configuration captured when they were created. Whether a newly issued version is deployed automatically depends on its associated deployment automation rule.

## Troubleshooting

- Directory probe fails: check the URL, network path, and trust-chain credential.
- EAB validation fails: verify the Key ID, HMAC key, and provider requirements.
- DNS challenge fails: verify the DNS Provider, credential permissions, and propagation wait time.
- A job runs for a long time: review the current order stage and latest error before waiting, retrying, or canceling. Do not create duplicate requests for the same domain.
