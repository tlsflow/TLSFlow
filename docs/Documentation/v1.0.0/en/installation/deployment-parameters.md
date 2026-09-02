---
title: Deployment Parameters
description: TLSFlow v1.0.0 Docker deployment environment variables, ports, and secrets
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - docker/docker-compose.yml
  - backend/src/config
  - docker/versions.env
testRefs: []
lastVerified: 2026-09-02
---

# Deployment Parameters

Environment variables (configuration items read at process startup) must be prepared before container startup. Variables marked "sensitive" should only be placed in permission-restricted environment files. Standard edition reads these variables through Compose; small edition passes them via `docker run -e`.

## Fixed Values for Two Topologies

| Parameter | Standard Deployment | Single-node Deployment |
| --- | --- | --- |
| `GCAC_DEPLOYMENT_ARCHITECTURE` | `standard` | `small` (built into image) |
| `GCAC_PERSISTENCE_BACKEND` | `postgres` | `pglite` |
| Database | `db` service, PostgreSQL 16, data saved in `docker/data/postgres/` | PGlite data saved in `data/pglite/` |
| Web Port | `GCAC_PORT`, default `8085` | Host-mapped port, default `8085:3003` |
| Browser Runtime | Disabled by default, can be enabled separately | Not supported |

## Image and Required Parameters

| Parameter | Purpose |
| --- | --- |
| `GCAC_RELEASE_VERSION` | Standard edition image tag; recommended to use fixed release version, default `latest` |
| `GCAC_PUBLIC_BASE_URL` | TLSFlow Web address accessible by Agent, e.g., `http://host-address:8085` |
| `GCAC_TOKEN_SECRET` | Login token signing key; required for standard edition, auto-generated and persisted on first startup if unset for small edition |
| `GCAC_SECRET_KEK` | Secret (sensitive value) encryption key; required for both standard and small editions |
| `POSTGRES_PASSWORD` | Standard edition PostgreSQL password; not needed for small edition |

Small edition only requires two application parameters: `GCAC_PUBLIC_BASE_URL` and `GCAC_SECRET_KEK`. If `GCAC_TOKEN_SECRET` is unset, it is auto-generated on first startup and saved to `data/runtime/token-secret`, then reused on restarts; manual input overrides the auto value. PGlite database, username, password, host, and port all use image built-in defaults.

Administrator password is set by the system initialization wizard on first startup. The CA high-risk operation confirmation key is auto-generated on container first startup, encrypted with `GCAC_SECRET_KEK`, and persisted; it does not need to be configured in Compose or environment files. `BROWSER_RUNTIME_SHARED_SECRET` is only required when Browser Runtime is enabled.

Runtime security materials (trust roots, signing private keys, key sets, and policy packages) are auto-generated on container first startup and encrypted with `GCAC_SECRET_KEK` before being saved to `/app/data/runtime/runtime-secrets.enc`. This directory must be persisted: deleting it generates a new trust root, and changing `GCAC_SECRET_KEK` prevents the service from starting. Do not paste decrypted materials in any documentation, logs, or tickets.

License management code, license status page, offline activation requests, license import, and quota validation are normal functions of public Docker. The current built-in license `keyId` is `gcac-license-release-2026-08`, using Ed25519 256-bit keys, providing approximately 128 bits of security strength. The license trust root public key is hardcoded with Backend code, and both development and production release environments use the same built-in public key; deployment environments cannot override it via environment variables. License signing private keys are not part of runtime materials and must be kept in a separate private signing environment, never entering public repositories, Docker build contexts, images, or container environment variables.

## Database and Persistence Directories

| Parameter | Purpose |
| --- | --- |
| `GCAC_DATABASE_HOST` / `GCAC_DATABASE_PORT` | Standard edition PostgreSQL address, default host `db`, port `5432` |
| `GCAC_DATABASE_NAME` / `GCAC_DATABASE_USER` / `GCAC_DATABASE_PASSWORD` | PostgreSQL connection components; if `GCAC_DATABASE_URL` is set, URL takes precedence |
| `GCAC_DATABASE_URL` | Complete PostgreSQL connection URL |
| `GCAC_PGLITE_DATA_DIR` | Small edition PGlite data directory, image default `/var/lib/gcac/pglite` |
| `GCAC_MIGRATIONS_DIR` | Database migration directory, Compose default `/app/src/database/migrations` |
| `GCAC_WORKFLOW_DATA_DIR` | User workflow directory, Compose default `/app/data/workflows` |
| `GCAC_RUNTIME_SECRETS_FILE` | Encrypted runtime security materials path, Compose default `/app/data/runtime/runtime-secrets.enc` |
| `GCAC_WEB_ROOT` | Small edition static frontend directory, image default `/app/web` |

## Identity, Sessions, and Licenses

| Parameter | Purpose |
| --- | --- |
| `AUTH_COOKIE_SECURE` | Whether to enforce secure cookies; enabled by default in production |
| `AUTH_BROWSER_SESSION_TTL_SECONDS` | Browser session validity period (seconds) |
| `GCAC_TENANT_MODE` | Tenant mode; pre-check in console before switching |
| `GCAC_LICENSE_STORAGE_KEY` | License sensitive material storage key; uses `GCAC_SECRET_KEK` if unset |
| `GCAC_ENABLE_LEGACY_ADMIN_SEED` | Whether to enable legacy fixed Admin seed; disabled by default |
| `GCAC_INITIAL_ADMIN_PASSWORD` | Legacy automated seed Admin password; leave empty for new deployments and use initialization wizard |
| `GCAC_CA_CONFIRMATION_SECRET` | CA high-risk operation confirmation key; auto-generated and encrypted on production container first startup, should not be manually configured |
| `GCAC_VERSION` | Override runtime version; keep as `1.0.0` for official releases |

## Browser Runtime

| Parameter | Purpose |
| --- | --- |
| `BROWSER_RUNTIME_ENABLED` | Whether Docker Compose pulls and starts Browser Runtime image; default `false`, not passed to Backend |
| `BROWSER_RUNTIME_URL` | Backend's internal network address for browser runtime, standard edition default `http://browser-runtime:8787` |
| `BROWSER_RUNTIME_SHARED_SECRET` | Shared key between Backend and browser runtime; required when enabled |
| `BROWSER_RUNTIME_PUBLIC_BASE_URL` | Public base address when external reverse proxy serves `/vnc/`; leave empty if not needed |
| `BROWSER_RUNTIME_MAX_SESSIONS` | Maximum browser session concurrency, Compose default `4` |

By default, starting standard edition does not include the `browser-runtime` service. After setting `BROWSER_RUNTIME_ENABLED=true`, the `COMPOSE_PROFILES` in the template automatically selects the Browser Runtime Profile; no additional command parameters needed. If your deployment tool overrides `COMPOSE_PROFILES`, ensure it includes `browser-runtime`.

## Common Optional Parameters

| Parameter | Default Value | Description |
| --- | --- | --- |
| `GCAC_PORT` | Standard default `8085` | Web external port; small edition adjusts via host port mapping |
| `GCAC_DATA_ROOT` | `./data` | Host persistence data root directory; defaults to same directory as Compose file |
| `POSTGRES_DB` | `gcac` | Database name |
| `POSTGRES_USER` | `gcac` | Database user |
| `BROWSER_RUNTIME_PUBLIC_BASE_URL` | Empty | Public address for browser sessions; leave empty without public network access |
| `BROWSER_RUNTIME_MAX_SESSIONS` | `4` | Browser session limit |
| `VITE_PRODUCT_EDITION` | `public` | Only used for source code builds, not a runtime deployment parameter |
| `DOCS_VERSION` | `1.0.0` | Docker build argument determining frontend "User Manual" entry redirect documentation version; not a runtime deployment parameter |

Source code builds can also use the semantically identical `VITE_DOCS_VERSION` (e.g., `1.0.0` or `v1.0.0`). During Docker build, pass via `--build-arg DOCS_VERSION=1.0.0`; if unset, temporarily uses `1.0.0`. This variable only controls the entry link; the documentation image still fully copies `docs/Documentation/.vitepress/dist` to preserve version switching and Chinese/English pages.

The system also reads variables for Agent offline determination, device liveness probing, monitoring, automation, CA synchronization, ACME renewal, and task Worker (background task process) intervals/concurrency, such as `AGENT_OFFLINE_TIMEOUT_SECONDS`, `DEVICE_HEALTH_STALE_SECONDS`, `DEVICE_LIVENESS_PROBE_INTERVAL_MS`, `MONITOR_PROBE_SCHEDULER_INTERVAL_MS`, `AUTOMATION_SCHEDULER_INTERVAL_MS`, and `GCAC_TASK_WORKER_INTERVAL_MS`. Both `AGENT_OFFLINE_TIMEOUT_SECONDS` and `DEVICE_HEALTH_STALE_SECONDS` default to 60 seconds. Agent terminal-state task auto-cleanup can be adjusted via `AGENT_TASK_CLEANUP_INTERVAL_MS`, `AGENT_TASK_CLEANUP_BATCH_SIZE`, `AGENT_TASK_DETERMINISTIC_RETENTION_SECONDS`, and `AGENT_TASK_UNKNOWN_RETENTION_SECONDS`; defaults are 60 seconds, 100 entries, 1 hour, and 24 hours respectively. Cleanup only deletes `succeeded`, `failed`, `rejected` terminal-state tasks and their task logs/cursors, never touching `queued`, `leased`, `acked` active tasks. These variables are only for capacity tuning and retention period adjustment, not new feature toggles; keep default values without clear capacity evidence.

## Variables Explicitly Not for Production

`NODE_TEST_CONTEXT`, `GCAC_E2E_*`, `GCAC_P2_DEV_CUTOVER`, and test signing materials only serve development or testing. They do not replace production keys and should not be written into standard or single-node Compose environments.
