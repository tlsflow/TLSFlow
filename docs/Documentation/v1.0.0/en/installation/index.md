---
title: Installation
description: Installation, configuration, and first login for TLSFlow v1.0.0
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - docker/docker-compose.yml
  - docker/build-tools/Dockerfile.small
  - docker/build-tools/Dockerfile.backend
testRefs: []
lastVerified: 2026-09-02
---

# Installation

This documentation covers Docker deployment methods for TLSFlow v1.0.0. The standard edition uses Docker Compose; the small edition uses `docker run` with a single container. Both methods pull images directly from Docker Hub and do not require Node.js installation or source code deployment on the host machine.

## Choosing a Deployment Method

| Method | Use Case | Service Components | Data Storage |
| --- | --- | --- | --- |
| Standard Deployment | Production environments, multiple tenants, and continuous background tasks; Browser Runtime enabled on demand | `db`, `backend`, `web` (optional `browser-runtime`) | `docker/data/postgres/`, `docker/data/workflows/`, `docker/data/runtime/` |
| Small Single-Container | Under 50 application assets, home NAS, or environments where Compose is unavailable | `tlsflow-small` | `data/pglite/`, `data/workflows/`, `data/runtime/`, `data/tls-inspector/`, `data/plugins/` |

Follow the [Quick Start](./quick-start.md) to prepare images, directories, and secrets, then choose either [Standard Deployment](./standard-deployment.md) or [Single-node Deployment](./single-node-deployment.md). The two architectures cannot run simultaneously. For all variable meanings and requirements, see [Deployment Parameters](./deployment-parameters.md). After containers start, follow [First Login](./first-login.md) instructions.

After installation, it is recommended to complete the following steps in order: create daily-use accounts, import licenses (if applicable), store credentials, connect a test device, import a test certificate, and perform a Dry Run (read-only rehearsal). Following this sequence helps identify and resolve issues related to infrastructure, permissions, and target connectivity progressively.
