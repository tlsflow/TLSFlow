---
title: Plugin Center
description: Manage TLSFlow v1.0.0 built-in plugins and user plugin packages
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/plugins/PluginsView.vue
  - backend/src/modules/plugins
testRefs: []
lastVerified: 2026-09-02
---

# Plugin Center

Plugins provide the platform with extended capabilities for device connection, discovery, certificate processing, etc. The Plugin Center is used to view plugin versions and status, and decide which plugins can be used in device or application wizards.

## Find Plugins

1. Open "Plugin Center" and click "Refresh" first to get the latest list.
2. Use the search box to find plugins by name, product, capability, or tag.
3. Use "Source" to filter built-in plugins or user plugins, use "Status" to filter valid or invalid versions.
4. Click "Details" to view applicable products, versions, runtime location, available capabilities, and usage restrictions.

## Enable or Disable

1. In the details, confirm the plugin matches the target device or application, and confirm the required credentials are ready.
2. For plugins that pass verification and are not enabled, click "Enable" and wait for the status to change to "Enabled".
3. When no longer in use, click "Disable" and confirm that no running tasks depend on this plugin.
4. Return to the device or application wizard and reopen the list to confirm the plugin is selectable or has been removed.

Plugin versions are managed independently by version. Upgrades will not automatically replace already created application assets; to use a new version, reselect in the corresponding wizard. Plugins with invalid or pending approval status cannot be enabled.

## Checks When Importing User Plugins

- Only submit plugin packages through the import entry provided on the page and wait for verification to complete.
- First verify the source, applicable platform, version, and capabilities before approving and enabling.
- Import, approval, enable, binding, and execution are different steps; failure in one step only affects that plugin.
- When plugin execution fails, first check target compatibility, connection credentials, and device status before deciding whether to retry.

> [Placeholder screenshot: Plugin Center list, highlighting search box, source/status filters, refresh, and enable/disable buttons]
>
> [Placeholder screenshot: Plugin detail popup, highlighting version, applicable platform, capabilities, runtime location, and restriction descriptions]
