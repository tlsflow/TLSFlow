---
title: Plugin package contract
description: The package, manifest, resource, and version contract for GCAC plugins
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/004.1-插件包契约、权限与生命周期治理
codeRefs:
  - backend/src/modules/plugins/schema
  - backend/src/modules/plugins/application
testRefs:
  - backend/src/modules/plugins/builtin-unified-plugin-loader.test.ts
  - backend/src/modules/plugins/plugin-workflow-publisher.test.ts
lastVerified: 2026-08-06
---

# Plugin package contract

A plugin package is an immutable capability declaration. Its manifest, resources, content hash, version, permissions, and runtime kind must be validated before publication.

## Required boundaries

- Use the current manifest Schema and stable plugin identity.
- Declare resources, capabilities, input slots, permissions, network access, and compatibility explicitly.
- Use only `agent_plan`, `declarative`, and `isolated_process` as plugin execution locations. Code-bearing packages must declare a fixed Plugin Runner entry, IPC version, and resource digest; the host must not dynamically load plugin code.
- Do not encode vendor selection as a host-side Driver, Executor, Projector, or page branch.
- Treat package and workflow hashes as content identity, not as a display label.

The host owns publication state, approval, credential and artifact Grants, audit, execution locks, and status transitions. A package existing in storage does not mean that its tenant has enabled or approved it.

## Built-in package version source

For every built-in package, `manifest.json.version` is the sole source of truth for the plugin version. Startup and hot reload scan packages, then derive Registry entries, database `PluginVersion` records, and Workflow Bindings. Those derived records must never define or overwrite a package version. The same `pluginId@version` with the same digest is idempotent; a different digest must reject startup or reload; a higher Manifest version creates a new record while preserving history.

`scripts/architecture/p2-plugin-release-manifest.json` is a release catalog. It stores only release policy, package digests, Host API grants, and ownership metadata. It does not store mirrored plugin, capability, or workflow versions. A workflow `metadata.version` belongs to the workflow itself and is not a copy of the plugin version.

User-plugin publisher cryptographic verification is still `todo`; do not use a user-provided signature state as a trusted-publisher guarantee.

## New-device entry for application onboarding

An application onboarding recipe must be referenced by Manifest `resources.onboarding.applicationAsset`, normally `onboarding/application-asset.json`. A recipe with `deviceSelection: "EXISTING_OR_NEW"` may declare `newDeviceOnboarding` to preselect the entry in the shared device wizard. The host must not infer this flow from an application platform, vendor, or product name.

Use `{ "kind": "AGENT_INSTALL", "platformKey": "linux" }` for an Agent-install flow, where `platformKey` is a registered device-platform key. Generating an install command does not make a device selectable: the Agent must register and pass health and capability filtering first. Use `{ "kind": "PLUGIN_MANAGED", "pluginId": "device.citrix.netscaler-adc" }` when the device plugin must collect connection information.

The `PLUGIN_MANAGED` flow loads the concrete `forms.device` resource declared in the target plugin Manifest; aliases, embedded forms, and host-specific fields are invalid. `EXISTING_ONLY` and `NONE` recipes must not declare this field. Legacy recipes without it remain able to select an existing device, but do not show a new-device option in application onboarding.

After a device plugin creates a device, the host restores the original session and refreshes compatible devices. A recipe, form, or Manifest onboarding-resource change is package-content change: increment the Manifest version and refresh the release Catalog. Do not edit runtime database records or add vendor branches in the host.
