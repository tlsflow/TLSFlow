---
title: "Quick start"
description: "Complete the minimum TLSFlow v1.0.0 installation with Docker Hub images"
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs: []
testRefs: []
lastVerified: 2026-09-02
---

# Quick start

## Prerequisites

Prepare a Linux, macOS, or NAS host with Docker CLI. Standard deployment also requires Docker Compose v2. The host must reach target devices, certificate services, and any external vendor APIs used by the deployment.

## Choose a topology

- Use [standard deployment](/v1.0.0/en/installation/standard-deployment) with Docker Compose for production and multi-tenant environments.
- Use [single-node deployment](/v1.0.0/en/installation/single-node-deployment) for the small single-container architecture.

Do not run both architectures against the same data directory or port. After startup, confirm that the container is `running`, migrations have completed, and the Backend is listening before opening the Web address. Do not use development variables in production.

<LocalizedImage name="quick-start.svg" alt="Quick start deployment flow" width="960" height="360" />
