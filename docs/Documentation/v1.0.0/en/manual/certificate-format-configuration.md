---
title: Certificate Format Configuration
description: Configure output formats and key materials required for certificate deployment
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/bindings/BindingsView.vue
  - backend/src/modules/bindings
testRefs: []
lastVerified: 2026-09-02
---

# Certificate Format Configuration

Format configuration is a preset for "what files to generate during deployment", not the certificate itself, and will not trigger deployment alone. The page supports common formats such as PEM, PFX, JKS, P7B, and allows saving multiple configuration sets for different systems.

> [Screenshot placeholder: Certificate format configuration list showing configuration name, system platform, output format, and status]

## Create Format Configuration

1. Go to "Certificate Management → Certificate Format Configuration" and click "New".
2. Select system platform and runtime environment (such as Linux, Windows, or Java). Click "Apply Template" to bring in common settings.
3. Fill in configuration name and select output format: PEM, PFX, JKS, P7B, CER, CRT, or custom format.
4. Set file extension, certificate chain order, certificate content encoding, and alias as needed.
5. When PFX/JKS requires password, select existing security credentials, or enter in the password input box and let the system save it as credentials.
6. Click "Save" and return to the list to confirm the configuration is available.

> [Screenshot placeholder: New format configuration window highlighting platform, runtime environment, apply template, and output format]
>
> [Screenshot placeholder: Format parameter area highlighting extension, chain order, alias, and password source]

## Using in Application Assets

1. Open "Asset Center → Application Assets" and create or edit an application asset.
2. Select configuration in the certificate format or deployment input area.
3. Check the file name, extension, certificate chain, and required credentials in the preview.
4. Save the application asset and confirm in deployment pre-check that target files can be generated.

Format configuration only takes effect when actually selected in application asset or workflow; saving configuration alone will not generate files.

## What Each Format Requires

| Format | Applicable Scenario | Notes |
| --- | --- | --- |
| PEM | Nginx, Apache, common Linux services | Typically requires leaf certificate, private key, and certificate chain in order |
| PFX/P12 | Windows, some gateways and middleware | Requires private key, password, and certificate alias |
| JKS | Java application servers | Requires private key, password, and certificate alias |
| P7B/P7C/SPC | Scenarios requiring only certificate chain | Does not contain private key, cannot complete HTTPS deployment alone |

Editing configuration affects subsequently created deployment plans; executions that have already started or completed still proceed according to the configuration saved at that time. Before deletion, please first confirm that no application assets are using it; the system will prevent accidental deletion of configurations in use.

Output format boundaries are as follows: PEM consists of certificate, private key, and ordered chain; PFX/P12 and JKS also require password and alias; P7B/P7C/SPC only carry certificate chain and cannot replace private key. Passwords can only come from saved security credentials; the system will validate before generation, and incorrect passwords will not generate deployable artifacts.
