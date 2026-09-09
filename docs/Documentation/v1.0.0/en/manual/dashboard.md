---
title: "Dashboard"
description: "Review TLSFlow v1.0.0 certificates, assets, execution, and audit status"
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs: []
testRefs: []
lastVerified: 2026-09-02
---

# Dashboard

The dashboard is the daily overview. It summarizes certificates, applications, device connections, Gateways, system resources, execution results, and audit activity.

## Daily review

1. Check red and yellow states before handling certificates that are approaching expiration.
2. Open the related object from a resource card or heat map to inspect the actual cause.
3. Confirm recent audit entries show the intended operation completed; submission alone does not prove a target was updated.
4. Refresh after handling an issue. Refresh only reads data and does not execute deployment.

<LocalizedImage name="dashboard-overview.svg" alt="Dashboard overview" width="960" height="420" />
