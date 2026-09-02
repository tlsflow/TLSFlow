<div align="center">

<img src="web/public/brand/tlsflow-lockup.svg" alt="TLSFlow" width="480">

[![License](https://img.shields.io/badge/License-PolyForm_Noncommercial_1.0.0-blue.svg)](https://polyformproject.org/licenses/noncommercial/1.0.0)
![Version](https://img.shields.io/badge/version-1.0.0-brightgreen.svg)
![Vue](https://img.shields.io/badge/Vue-3.5+-4FC08D.svg?logo=vue.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-latest-E0234E.svg?logo=nestjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16+-336791.svg?logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)

**Enterprise-grade SSL/TLS Certificate Lifecycle Automation Platform**

[English](#) | [中文](docs/Readme/README.zh-CN.md) | [日本語](docs/Readme/README.ja.md) | [Français](docs/Readme/README.fr.md) | [Русский](docs/Readme/README.ru.md) | [한국어](docs/Readme/README.ko.md) | [Español](docs/Readme/README.es.md)

</div>

---

## ⚠️ Important Notice

Please read the following carefully before using this project:

- **Terms of Service Risk:** Using this project in commercial production environments requires a separate commercial license or EULA. The default PolyForm Noncommercial 1.0.0 license permits only non-commercial use. Please review the [LICENSE](LICENSE) file and contact the rights holder before commercial deployment.

- **Compliant Use:** Use this project only in compliance with the laws and regulations of your country or region. Any unlawful use is strictly prohibited.

- **Disclaimer:** This project is provided for technical learning, research, and evaluation purposes. The authors assume no liability for production incidents, data loss, or any other direct or indirect damages resulting from the use of this project in unsupported environments.

---

## Product Overview

### Don't Let Certificate Expiration Bring Down Your Business

Hundreds of servers, dozens of application types, different network environments—what happens when certificates are about to expire? Manual updates are time-consuming, error-prone, and can bring production systems down. TLSFlow helps you manage certificates, automate deployments, and automatically roll back when issues occur, ensuring certificate updates are no longer a ticking time bomb.

Through its plugin system and workflow orchestration, it extensibly supports various web servers, application servers, load balancers, gateway devices, cloud platforms, and container environments.

### Product Value

| Value | Description |
| --- | --- |
| **Know What Certificates You Have** | No need to dig through Excel sheets and emails. Find out which machine has which certificate, what application it's bound to, and when it expires—all in one place. |
| **Batch Updates with One Click** | Automatically deploy to Windows, Linux, cloud platforms, and network devices without manually SSH-ing into each server late at night. |
| **Auto-Rollback on Update Failure** | Automatic backup before updates, automatic verification after updates, and immediate rollback to original configuration if issues are detected, reducing business interruption risk. |
| **Advance Expiration Notifications** | Automatic reminders before expiration, immediate alerts on deployment failures via WeChat, email, DingTalk, and other channels. |

## Pain Points & Challenges

### The 47-Day Certificate Era Is Coming

The CA/B Forum passed SC081v3 on April 11, 2025, phasing down the maximum validity period for publicly trusted TLS/SSL certificates:

| Phase | Maximum Validity | Effective Date | Estimated Annual Renewals |
| --- | ---: | --- | ---: |
| Current | 1 year | Current | ~1 time |
| Phase 1 | 200 days | 2026-03-15 | ~2 times |
| Phase 2 | 100 days | 2027-03-15 | ~4 times |
| Phase 3 | 47 days | 2029-03-15 | ~8 times |

Doubling update frequency means application, deployment, verification, and rollback must become reproducible automated processes.

### Operations Support: How Many Certificates Does Your Enterprise Need to Manage?

- Public domain names scattered across multiple cloud providers, internal gateways distributed across branch offices;
- Certificate information scattered in Excel, emails, and shared folders, making it difficult to track quantity, expiration dates, and deployment locations;
- Every inventory requires ad-hoc compilation, prone to omissions, duplications, and unclear responsibilities.

**TLSFlow Solution**: Provides a certificate asset center to centrally manage all certificates and their deployment locations.

### Application Implementers: How to Cope with the Coming 47-Day Certificate Era?

- Current certificates are typically renewed once a year; for 200 applications at 2 hours each, one round requires about 400 hours;
- When validity shortens to 47 days, annual renewals increase to about 8 times, multiplying repetitive labor costs;
- Without unified automation, continuous application, upload, configuration, restart, and verification become unsustainable.

**TLSFlow Solution**: Automated deployment processes reduce single-update time from hours to minutes.

### Application Maintainers: Have Certificate Expiration or Installation Failures Caused Business Interruptions?

- Expired certificates can cause website inaccessibility, mobile app API failures, partner API interruptions;
- Manual updates involve many steps; configuration errors and untimely verification easily introduce problems into production;
- Even with prompt handling, business may already be interrupted for hours, leading to complaints and customer concerns;
- Lack of unified change records and recovery references means troubleshooting, rollback, and post-mortem depend on manual experience.

**TLSFlow Solution**: Provides expiration warnings, post-deployment automatic verification, and failure rollback mechanisms.

### Information Security Personnel: What Are the Security Risks of Widespread Wildcard Certificate Use on Internal Networks?

- A single wildcard certificate and private key are copied to dozens or even hundreds of internal servers;
- Any server compromise, backup leak, or operational error can cause private key proliferation;
- Deployment scope cannot be tracked; once a certificate needs revocation, impact assessment and network-wide investigation become difficult;
- Unclear private key usage boundaries and actual deployment entities make audit, rotation, and compliance responsibilities hard to implement.

**TLSFlow Solution**: Recommends combining internal private certificates, public wildcard certificates, and automated deployment to reduce private key proliferation risk.

### Team Managers: How Far Is Your Team from the 47-Day Certificate Era?

- First confirm whether your asset inventory is complete and whether certificates, servers, applications, and responsible persons can be mapped;
- Then evaluate automation coverage to reduce reliance on personal experience, temporary scripts, and manual logins;
- Finally verify whether the team has rapid response, approval traceability, and failure rollback capabilities;
- Integrate expiration reminders, deployment verification, and execution records into a unified closed loop to continuously cope with 47-day cycles.

**TLSFlow Solution**: Provides a complete solution from asset inventory, automated deployment, to monitoring and alerting.

## Features

### What TLSFlow Can Do

| Feature | Description |
| --- | --- |
| **Unified Certificate Asset Management** | Centrally manage certificate assets, versions, format conversions, and trust chain verification. Supports multiple formats including PEM/PFX/JKS/P7B. Automatically detects certificate expiration and archives historical versions. |
| **Multi-Source Certificate Integration** | Supports manual import, internal CA (OpenSSL/ACME), cloud vendor certificates (Alibaba Cloud CDN), Microsoft AD CS, and other certificate sources. Automatically parses certificate chains and maps to managed assets. |
| **Heterogeneous Environment Application Discovery** | Automatically discovers various web servers, application servers, load balancers, and other application assets through Agent. Identifies current certificate bindings and compatibility. |
| **Workflow Automated Deployment** | Orchestrates certificate deployment workflows based on DSL. Supports SSH remote execution, CURL API calls, file transfers. Built-in pre-checks, backup, verification, and rollback safeguards. |
| **Extensible Plugin System** | Includes 20 high-frequency application plugins covering web servers, application middleware, load balancers, gateway devices, cloud platforms, and more. Supports custom plugin extensions to adapt to any target environment. |
| **Continuous Monitoring & Alerting** | Real-time monitoring of certificate expiration, binding drift, chain verification failures, deployment anomalies. Multi-channel alert push via email/Webhook/DingTalk/WeCom/Feishu/Slack/Telegram. |
| **Approval Workflows & Auditing** | Supports approval triggers by risk level and operation type (plugin installation/enablement, workflow execution, rollback operations). Complete operation logs and execution snapshots. |
| **Fine-Grained Access Control** | Based on RBAC + object authorization model. Permission assignment by certificate asset, application, Agent dimensions. Supports tenant isolation and cross-department collaboration. |

### Real-World Pain Points

| Problems You May Encounter | How TLSFlow Solves Them |
| --- | --- |
| Certificate information scattered in emails, Excel, shared drives—can't find it when needed | All certificates centrally managed; search to find usage locations and responsible persons. |
| After updates, unsure if they took effect; only discover configuration errors after user complaints | Post-update automatic HTTPS access confirmation; only marked complete after fingerprint verification. |
| When problems occur, don't know who changed what, unable to investigate | Every update records operator, timestamp, and changes for later review. |
| Production zone prohibits external network access, can't install Agent, only manual login possible | Use Gateway for active connection, or deploy directly via SSH without proxy. |

## Product Advantages

### Why TLSFlow Is Better Suited for Enterprises

- **Legacy System Compatibility**: Many systems can't install Agents, and networks have isolation zones. TLSFlow provides multiple integration methods, allowing legacy systems and isolated networks to be brought under management without major overhauls.
- **Automatic Rollback on Certificate Update Failures**: Automatic backup before updates; on verification failure, automatically restores original configuration based on backup inventory and checkpoints. Supports both automatic failure policy triggers and manual rollback, avoiding scrambling to roll back after business disruption.
- **Handles Both Common and Special Applications**: High-frequency applications use built-in plugins directly; niche devices and special processes can orchestrate update steps through workflow DSL for unlimited extensibility.
- **Clear Certificate Associations**: Each certificate is bound to specific servers, sites, and applications for rapid impact assessment when issues occur.
- **Complete Access Control**: Different roles have different permissions; sensitive operations require policy-based approval; passwords and private keys are not displayed in plaintext in logs.
- **Comprehensive Audit Logs**: Every update shows execution steps, certificates used, and configuration changes for problem review—not black-box operations.

## Use Cases

- **Complex Heterogeneous Environments**: Multiple web servers, application middleware, load balancers, gateway devices, and cloud platforms coexist, making manual maintenance unsustainable;
- **Isolation Zones and Legacy Systems**: Production zones restrict software installation, legacy systems cannot be upgraded, but certificates still need updates;
- **Fully Air-Gapped Internal Networks**: Production environments physically isolated from the internet, unable to use public cloud online certificate services;
- **Approval and Record Requirements**: Certificate changes are sensitive operations requiring approval workflows, operation traceability, and complete audit trails.

Stop making certificate updates a ticking time bomb. TLSFlow uses unified asset management, automated deployment, secure rollback, and continuous alerting to help teams cope with increasingly shorter certificate rotation cycles.

## Technical Architecture

The project adopts a layered, modular architecture: the core platform uniformly manages data, permissions, and execution contracts, while the execution layer can be replaced according to targets.

| Component | Technology & Responsibilities |
| --- | --- |
| Web Console | Vue 3, TypeScript, Vite, Pinia, vue-i18n |
| Backend | NestJS, TypeScript; domain modules split by business boundaries providing REST/OpenAPI interfaces |
| Data Persistence | Standard deployment uses PostgreSQL 16; single-node evaluation uses PGlite |
| Browser Runtime | Node.js, Playwright; provides isolated browser sessions and controlled credential flows |
| TLS Inspector | Independent Node.js service for TLS handshake and certificate status analysis |
| Full Agent / CA Node | Go native programs for host execution and isolated CA issuance boundaries respectively |
| Extension Runtime | Manifest, Host API, Runner, Workflow DSL, and compatibility directory |
| Deployment Methods | standard uses Docker Compose; small uses single container `docker run` |

## Quick Start

### Prerequisites

- Linux, macOS, or NAS host
- Docker CLI; standard deployment additionally requires Docker Compose v2
- Access to target devices and certificate services
- Production environments use random, long-term unchanging runtime keys

Deploying pre-built images does not require Node.js, Go, Buildx, or source code.

### Single-Node Deployment

Suitable for small-scale environments with fewer than 50 application assets, using PGlite embedded database, single-container operation.

Quick start (using Docker named volume):

```bash
docker run -d \
  --name tlsflow-small \
  --restart unless-stopped \
  -p 8085:3003 \
  -e GCAC_PUBLIC_BASE_URL=http://your-host:8085 \
  -e GCAC_SECRET_KEK=your-random-kek \
  -v tlsflow-small-data:/app/data \
  tlsflow/gcac-small:latest
```

**Important**:
- Production environments must replace `GCAC_SECRET_KEK` with a random key
- Administrator password is set through initialization wizard on first access
- Default access address: `http://<host-address>:8085/`

For detailed parameter configuration, host directory binding, HTTPS reverse proxy, and other scenarios, please refer to the complete documentation.

### Standard Deployment

Suitable for production environments and multi-tenant scenarios, using PostgreSQL 16 database, supports Browser Runtime browser sessions.

**1. Prepare Configuration File**

```bash
cp docker/.env.example docker/.env
```

Edit `docker/.env`, at minimum fill in:
- `GCAC_RELEASE_VERSION`: Image tag (use fixed version in production)
- `GCAC_PUBLIC_BASE_URL`: Web address accessible to Agent
- `POSTGRES_PASSWORD`: Database password
- `GCAC_TOKEN_SECRET`: Login token signing key
- `GCAC_SECRET_KEK`: Encryption root key (must remain unchanged long-term)

**2. Start Services**

```bash
cd docker
docker compose pull
docker compose up -d
```

**3. Verification**

```bash
docker compose ps
docker compose logs --tail=200 db backend web
```

Confirm `db` status is `healthy`, access `http://<host-address>:8085/` to complete initialization wizard.

**Browser Runtime** (optional): When browser login credentials are needed, set `BROWSER_RUNTIME_ENABLED=true` in `.env` and fill in `BROWSER_RUNTIME_SHARED_SECRET`, then execute `docker compose up -d`.

For detailed resource configuration, data directories, backup and recovery, please refer to the complete documentation.

## Project Directory

```text
backend/          NestJS backend, database migrations, plugin host, and execution orchestration
web/              Vue 3 management console
browser-runtime/  Controlled browser runtime
tls-inspector/    TLS handshake and certificate detection service
agents/           Windows/Linux Agent, CA Node, and Gateway Agent
docker/           Dockerfile, Compose, image, and Agent release package build tools
data/             Runtime plugins, database, workflows, and runtime data directory
docs/             User manual, development documentation, operations guide, and product materials
specs/            Requirements and design specifications organized by domain
scripts/          Architecture checks, compatibility checks, plugin governance, and public release tools
```

## Secondary Development & Extension

### Choosing the Right Extension Method

1. **Adding Ordinary Systems or Authenticated Environments**: Prioritize reusing existing Agent, SSH, CURL, and platform capabilities. Add configurations and verification records through the compatibility directory with minimal core code changes.
2. **Adding High-Frequency Products**: Develop product plugins that encapsulate device connection, identity confirmation, read-only discovery, application asset mapping, deployment plans, and target verification.
3. **Adding Niche Devices or Internal APIs**: Write versioned Workflow DSL using controlled steps like SSH, SFTP, SCP, CURL, conditions, transformations, waits, manual confirmations, extractions, and assertions.
4. **Genuinely Need New Execution Boundaries**: Then evaluate whether new Agent product lines or host capabilities are needed, first completing protocol, permission, audit, and rollback contracts.

### Plugin Development Boundaries

- Plugins declare identity, version, capabilities, permissions, and compatibility scope through `Manifest`;
- Plugins default to using only Host API, Secret, Artifact, audit, locks, and execution authorization provided by the host;
- Built-in plugins are located in `backend/src/modules/plugins/builtin-plugins/<pluginId>/`;
- User plugins are placed in `data/plugins/` and published through the unified plugin package import interface;
- Plugin workflow resources must be synchronized with plugin versions; testing certificate update processes and saving iteration records must be completed before release;
- Plugins cannot bypass the host to directly read tenant data, plaintext credentials, or arbitrarily execute host processes.

Entry documentation: [Plugin Development](docs/Documentation/developer/plugin-development.md), [Host Plugin Capabilities](docs/Documentation/developer/host-plugin-capabilities.md), [Workflow Development](docs/Documentation/developer/workflow-development.md).

### Workflow DSL Boundaries

Workflow templates use the project's proprietary protocol `gcac.workflow/v1`. Template sources are only:

- Built-in templates: `backend/src/modules/workflow-templates/builtin-workflows`;
- User-imported templates: `data/workflows` (created at runtime as needed, not a built-in template directory).

Passwords, tokens, private keys, and certificate artifacts must be referenced through `SecretRef` or Artifact Slot, not written into DSL, ordinary variables, logs, or execution snapshots. Deployment processes should maintain `prepare → backup → install → refresh → verify` phases; rollback uses original workflow version and input snapshots.

### Local Development and Verification

The repository does not require development services to automatically start as part of README delivery. Common build and test entry points:

```bash
# Backend build
npm --prefix backend run build

# Frontend type check and production build
npm --prefix web run build

# Browser Runtime build
npm --prefix browser-runtime run build

# TLS Inspector test
npm --prefix tls-inspector test

# Frontend unit and contract tests
npm --prefix web run test:unit
```

Backend complete testing, compatibility architecture checks, plugin version checks, and Agent builds have additional environment requirements—please follow corresponding module documentation and project specifications. Passing tests does not equal completion of real vendor device, external CA, isolated network, or production rollback acceptance.

## Security & Production Boundaries

- `GCAC_SECRET_KEK` is the decryption root key for runtime security materials; must be independently backed up; prohibited from being written into code, logs, public documentation, or browsers;
- Do not place license signing private keys in repositories, images, or container environment variables; public deployments only need license trust public keys;
- Standard Browser Runtime should only be accessed through internal networks and web proxies;
- Sensitive materials like certificates, private keys, tokens, PFX/JKS passwords must not enter ordinary variables, execution logs, or workflow templates;
- Target versions, permission conditions, execution channels, and real compatibility must be separately accepted; static code, Schema, and unit tests cannot replace on-site verification;
- Standard Compose topology is designed for single-node operation, does not provide automatic failover clustering; database, workflows, user plugins, and runtime security materials should be backed up before upgrades and recovery;
- Capabilities for ACME, external CAs, vendor APIs, and complex networks evolve with versions—please refer to current user documentation, plugin compatibility directory, and actual environment results.

## Official Documentation

For complete user manuals, development documentation, product materials, and technical specifications, please visit:

**https://docs.tlsflow.com**

## License

This project is a combined licensing project. Please first read the root [LICENSE](LICENSE):

- Core source code and official implementation default to **PolyForm Noncommercial 1.0.0**; commercial use requires separate commercial license or EULA;
- Plugin SDK, Manifest, Host API contracts, and public Schema/protocol examples default to **Apache-2.0**;
- Documentation and examples default to **CC BY 4.0**;
- Third-party or community plugins follow their accompanying licenses and declarations.

## Project Positioning

TLSFlow does not attempt to replace all CAs, Kubernetes controllers, or lightweight ACME tools. Its value lies in turning the most easily uncontrollable parts "after certificate issuance"—asset relationships, heterogeneous target deployment, pre-checks, verification, rollback, approval, auditing, and continuous monitoring—into a unified, transparent, extensible enterprise process.

**Use structured assets to answer "where are the certificates", use plugins and workflows to answer "how to deploy", use pre-checks and verification to answer "is deployment safe and effective", use rollback and audits to answer "how to trace and recover when problems occur".**
