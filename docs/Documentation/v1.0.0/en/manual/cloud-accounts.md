---
title: Cloud Service Asset Onboarding
description: Configure cloud service connections and run cloud asset discovery through unified asset entry
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/assets/AssetsView.vue
  - web/src/views/devices/DeviceOnboardingWizard.vue
  - backend/src/modules/providers
testRefs: []
lastVerified: 2026-09-02
---

# Cloud Service Asset Onboarding

Cloud service instances explicitly belong to unified assets, with the root object being `ServiceAsset(assetKind=CLOUD_SERVICE)`, and their executable resources abstracted as standard `ManagedTarget`, not belonging to devices or Hosts. Users reuse `DeviceOnboardingWizard.vue` from the "Add Asset" in `/assets`, submit to `POST /api/v1/devices/onboarding` after selecting the plugin-declared form, and the backend completes connection test and resource discovery; does not enter certificate selection, deployment, or rollback stages. Sensitive content such as access keys should be established first in "System Settings → Credentials".

## Add Cloud Service Asset

1. Go to "Asset Center", click "Add Asset", and select cloud service plugin from the platform list.
2. Fill in display name and plugin credential fields; credentials only save CredentialRef.
3. After submission, the compatible device onboarding API routes to cloud service onboarding service, creates `ServiceAsset(assetKind=CLOUD_SERVICE)`, and executes connection test and resource discovery.
4. Discovery results are written to `FrameworkInstance`, `SiteAsset`, and explicitly declared `ManagedTarget` owned by that ServiceAsset. Alibaba Cloud CDN displays by Framework grouped by China Mainland and International; Framework name only shows coverage scope, not account or asset name.
5. After discovery is complete, results can be viewed in Asset Center; this process does not select certificates and does not create deployment plans.

> [Screenshot placeholder: Unified cloud service asset wizard highlighting Provider selection, display name, credential profile, next, and save buttons]

## Edit, View, and Delete

- The add asset process executes connection test and discovery; testing is read-only and will not write to cloud platform.
- Click asset record to view products, Framework, Site, and discovery time from the most recent discovery (displayed in local time).
- Created cloud service assets cannot change plugin provider; credential references and display names are maintained by the unified asset management interface; asset detail page does not provide certificate deployment edit form.
- Before deletion, confirm that no other assets or automation tasks depend on that ServiceAsset. Enter confirmation text as required by the page before deletion; asset records cannot be recovered after deletion.

Currently, the first formal acceptance object is Alibaba Cloud CDN; directories or Fixtures of other Providers do not represent official support. Alibaba Cloud CDN uses the same ServiceAsset credentials and the same API to discover China Mainland and International domains, and displays Framework in discovery results according to actual returned coverage scope. Framework name always displays "International" or "China Mainland"; account name only belongs to ServiceAsset display name. Alibaba Cloud plugin is only responsible for connection test and resource discovery, not certificate deployment, verification, or rollback. When exceptions occur, first check whether credentials are enabled, then contact cloud service administrator. Do not expose access keys in screenshots, notes, or chat.

Cloud account actions use plugin versions fixed and auditable at onboarding time; version upgrades and rebinding require passing account binding and capability verification again. Other Providers are not considered officially supported until completing real connection, discovery, and audit acceptance. To confirm real cloud platform connection success, please conduct separate acceptance in an environment configured with valid cloud credentials and external network access.
