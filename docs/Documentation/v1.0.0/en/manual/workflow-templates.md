---
title: Workflow Templates
description: View, import, and select TLSFlow certificate deployment workflow templates
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/workflows/WorkflowTemplatesView.vue
  - backend/src/modules/workflow-templates
testRefs: []
lastVerified: 2026-09-02
---

# Workflow Templates

Workflow templates are a set of reusable certificate deployment steps. System-provided templates can be used directly, and administrators can also import reviewed templates; the page only displays published available versions.

1. Go to "Certificate Deployment → Workflow Templates" and filter by name, plugin, or status.
2. Open template details to confirm version, input fields, execution location, and rollback support.
3. When you need to import, use the import entry provided on the page and wait for verification to complete before publishing.
4. In application assets or deployment plans, select explicit template versions; do not rely on the system to automatically replace versions.

When template verification fails, specific error information will be displayed. Template changes will not modify already created deployment plans.

## Source and Workflow Types

Template sources are divided into "System Templates" and "User Imported Templates". System templates are maintained uniformly by the platform, and user imported templates are reviewed and published by the user. Templates attached to plugins can usually only be viewed and cannot be edited directly; old templates that are no longer in use should be disabled and operation records retained.

Template versions are fixed when deployment plans are created. After a new version is published, existing plans still execute according to the original version; to use a new version, actively select it in the application asset or automation settings.

## Page Screenshot Placeholders

> [Placeholder screenshot: Workflow template list, showing name, version, source, and publish status]
>
> [Placeholder screenshot: Workflow template details, showing input fields, execution location, and rollback support]
