---
title: Certificates and CA
description: Operations for certificate assets, versions, formats, artifacts, and CAs
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/003-证书资产与CA生命周期管理
codeRefs:
  - backend/src/modules/certificates
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-08-02
---

# Certificates and CA

## Certificate asset operations

1. Create the certificate asset and confirm tenant ownership.
2. Import or issue an immutable certificate version.
3. Review `notBefore`, `notAfter`, Subject, SAN, and the SHA-256 fingerprint.
4. Generate a standard Artifact for the deployment target; do not copy private-key content into an application asset.
5. Bind the certificate version to an application asset or deployment input.

## CA operations

CAs, trust domains, and issuing nodes have independent lifecycles. Before disabling or retiring a CA, find certificate versions and bindings that still use it.

## Common errors

- Do not identify certificates by name alone; prefer the real SHA-256 fingerprint.
- Do not treat expiration as activation; preserve and display both dates.
- Do not put a PFX password in an ordinary variable or log; use a Credential/Secret reference.
