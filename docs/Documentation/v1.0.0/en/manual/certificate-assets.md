---
title: Certificate Assets
description: Import certificate materials, verify versions, and manage usage relationships
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/certificates/CertificatesView.vue
  - web/src/views/certificates/CertificateImportView.vue
  - web/src/views/certificates/CertificateDetailView.vue
  - backend/src/modules/certificates
testRefs: []
lastVerified: 2026-09-04
---

# Certificate Assets

Certificate Assets is where the platform stores certificate versions and their related materials. A domain can have multiple versions. Importing or issuing a new certificate creates another version while retaining previous versions for verification, deployment, and rollback.

This page manages certificate materials only. To install a certificate on a server, continue with “Asset Center → Application Assets” and “Certificate Deployment”.


## Import a Certificate

The import page is a four-step wizard: choose a source, choose a format and input method, provide materials, then validate and import. The platform saves a version only after validation passes.

1. Open “Certificate Management → Certificate Assets” and select “Import Certificate”.
2. On the source page, select “Manual Import”. To request a certificate through ACME, select “ACME Application” and follow that flow.
3. Choose an import format:
   - `PEM + KEY`: provide the certificate and matching private key. You can paste text or upload files.
   - `PFX / PKCS#12`: upload a `.pfx` or `.p12` file and enter its password. PFX imports always use file input.
4. Select “Next”. After confirming that all materials are present, select “Validate”. The platform checks domains, validity, the certificate chain, and private-key matching.
5. Read the validation report. The “Import” action becomes available only when there are no blocking issues.
6. After import, open the new version and verify the primary domain, SANs, issuer, validity period, and SHA-256 fingerprint.

An uploaded file is not necessarily a deployable certificate. An incomplete chain, mismatched private key, or expired certificate is reported explicitly; correct the material and validate again.

## View Versions and Usage

1. Select a domain in the list to open its versions.
2. Filter versions by keyword, status, or expiration. Times are shown in the browser’s local time.
3. Open version details to review domains, serial number, issuer, chain, private-key status, and fingerprint.
4. Open “Usage Relationships” to see whether the version is referenced by an application asset, automation rule, or pending plan.

Certificates with the same name are not necessarily the same material. Before deployment or replacement, verify the domain set, expiration, and SHA-256 fingerprint together.

## Delete a Version

Check “Usage Relationships” first. A version referenced by an application asset, automation task, or pending plan cannot be deleted directly.

After confirming that there are no active references, choose “Delete” in version details and confirm the warning. Deleting the platform record does not remove files already written to a target server; handle server cleanup through the relevant maintenance or deployment process.

## Pre-Deployment Checklist

- The version is valid and covers the planned usage period.
- The primary domain and SANs match the actual service addresses.
- The private key matches the leaf certificate, and the chain is valid and correctly ordered.
- The target output format is prepared in the version’s “Format Configuration”.
- The application asset and deployment plan reference the version you just verified.
