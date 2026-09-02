---
title: Certificate Assets
description: Import, view, and maintain certificate versions in certificate management
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/certificates/CertificatesView.vue
  - backend/src/modules/certificates
testRefs: []
lastVerified: 2026-09-02
---

# Certificate Assets

Certificate assets store certificate materials for a domain (or group of domains). Each import or automatic issuance adds a new version; old versions are retained for verification and rollback.

> [Screenshot placeholder: Certificate asset list showing domain, status, expiration time, source, and version count]

## Import Certificate (Manual Upload)

1. Go to "Certificate Management → Certificate Assets" and click "Import Certificate".
2. In the source selection, choose "Manual Import". If using ACME, please choose the ACME application entry instead.
3. Upload or paste server certificate, matching private key, and (if any) intermediate certificate chain.
4. Click "Import", wait for the page to prompt completion, do not submit repeatedly.
5. On the result page, verify main domain, alternative domains, issuer, effective time, expiration time, and status.
6. Return to the list, open new version details, and confirm the fingerprint matches the original certificate.

> [Screenshot placeholder: Certificate source selection window highlighting "Manual Import" and "ACME Application"]
>
> [Screenshot placeholder: Manual import form highlighting server certificate, private key, and intermediate certificate chain input areas]

If the certificate is from ACME or enterprise CA, it will also automatically appear in this list after successful issuance. Automatically issued certificates also need to check domain and expiration time.

## View Versions, Details, and Usage Relationships

1. In the list, click the domain card or click "Details".
2. In the version window, view historical versions by keyword, status, and expiration time.
3. Click a specific version to view domain, validity period, issuer, fingerprint, and certificate chain.
4. Open "Usage Relationships" to confirm which applications, automation tasks, or deployment plans are referencing it.

> [Screenshot placeholder: Certificate version window showing version filtering, status, and expiration time]
>
> [Screenshot placeholder: Certificate details showing domain, fingerprint, certificate chain, and usage relationships]

Certificates with the same name are not necessarily the same material. Before updating or redeploying, confirm with all three: domain set, expiration time, and SHA-256 fingerprint.

## Delete Expired or Mistakenly Imported Versions

1. Open certificate details and first confirm the target version is not referenced by application assets, automation, or pending plans.
2. Click "Delete" for that version, read the risk warning, then confirm again.
3. After deletion is complete, refresh the list to confirm remaining versions can still be viewed normally.

Deleting a certificate version will not delete historical files already written to servers; if server file cleanup is needed, execute the corresponding deployment or maintenance process separately.

## Pre-Deployment Checklist

- Status is valid and expiration time covers the planned usage period.
- Main domain and alternative domains include actual business access addresses.
- Private key matches leaf certificate, certificate chain is complete and in correct order.
- When deploying to different systems, corresponding formats have been prepared in "Certificate Format Configuration".
- Version selected in application asset matches the version confirmed on this page.

> [Screenshot placeholder: Fingerprint, domain, and validity period fields in certificate version details]

Tip: PFX/P12 and JKS require private key and password; P7B/P7C/SPC only contain certificate and chain, not private key. When importing these files, please provide the matching private key separately.
