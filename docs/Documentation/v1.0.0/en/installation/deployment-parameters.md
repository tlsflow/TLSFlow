---
title: Deployment parameters
description: Reference for TLSFlow v1.0.0 Docker environment variables, ports, data directories, and secrets
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

# Deployment parameters

This page is the reference for TLSFlow Docker deployment parameters. Most users only need the “Required parameters” and “Secrets and persistence” sections. Use the later tables when you change ports, enable Browser Runtime, migrate data, or tune capacity.

Prepare environment variables before starting the containers:

- **Standard** reads them from `docker/.env` through Docker Compose.
- **Small** receives them through `docker run -e name=value`.
- Keep keys and other sensitive values in a permission-restricted environment file or password manager.

## Choose the deployment topology

| Item | Standard | Small |
| --- | --- | --- |
| Best for | Production, multi-tenant, multi-enterprise, or continuous background tasks | Evaluation, personal environments, home NAS, or up to 50 application assets |
| Service shape | Multiple Docker Compose services | One Docker container |
| Database | PostgreSQL 16 provided by the `db` service | Built-in PGlite (file-based PostgreSQL-compatible database) |
| Persistence root | `GCAC_DATA_ROOT`, default `docker/data/` | Docker volume or host bind mounted at `/app/data` |
| Web port | `GCAC_PORT`, default `8085` | Host mapping, default `8085:3003` |
| Browser Runtime | Disabled by default; enable on demand | Not supported |
| Fixed architecture | `GCAC_DEPLOYMENT_ARCHITECTURE=standard` | `GCAC_DEPLOYMENT_ARCHITECTURE=small` (built into image) |
| Fixed persistence backend | `GCAC_PERSISTENCE_BACKEND=postgres` | `GCAC_PERSISTENCE_BACKEND=pglite` (built into image) |

Standard and small cannot run at the same time or share ports or data directories. Small's PGlite data cannot be used directly as standard's PostgreSQL data.

## Required parameters

### Required for both editions

| Parameter | Purpose | Example or default |
| --- | --- | --- |
| `GCAC_PUBLIC_BASE_URL` | Public URL users and Agents use to reach TLSFlow | `https://tlsflow.example.com` or `http://192.168.1.20:8085` |
| `GCAC_SECRET_KEK` | Encryption key for Secrets, license-sensitive materials, and runtime security materials | Use a random value and keep it unchanged after initialization |

`GCAC_PUBLIC_BASE_URL` must include the protocol, hostname, and port users actually use. With an HTTPS reverse proxy, enter the proxy URL, not an internal container address.

### Also required for standard

| Parameter | Purpose | Example or default |
| --- | --- | --- |
| `GCAC_RELEASE_VERSION` | Version tag used by all standard images | Default `latest`; pin a release in production |
| `POSTGRES_PASSWORD` | PostgreSQL database password | Required; use a random value |
| `GCAC_TOKEN_SECRET` | Login-token signing key | Required; use a random value and keep it unchanged |

Standard defaults `POSTGRES_DB` and `POSTGRES_USER` to `gcac`. Most deployments do not need to change them.

### Small-specific behavior

Small only requires `GCAC_PUBLIC_BASE_URL` and `GCAC_SECRET_KEK` as application parameters. If `GCAC_TOKEN_SECRET` is unset, the image generates a Token signing key on first startup and saves it to `/app/data/runtime/token-secret`; restarts and upgrades reuse that file.

The administrator password is set by the system initialization wizard on first console access. Do not set `GCAC_INITIAL_ADMIN_PASSWORD` for a new deployment. On first startup, TLSFlow generates the CA high-risk-operation confirmation key and encrypts it with the KEK in the runtime directory.

## Secrets, runtime materials, and licenses

### Runtime directory must be persistent

Standard uses `GCAC_DATA_ROOT/runtime/` by default. Small uses `runtime/` inside its mounted data directory. The directory contains:

- Token signing key;
- CA high-risk-operation confirmation key;
- Encrypted runtime materials such as policy trust roots, signing private keys, key sets, and policy packages.

Deleting `runtime/` creates a new trust root and CA confirmation key. Changing `GCAC_SECRET_KEK` prevents existing materials from being decrypted and may prevent the service from starting. Keep the data directory, KEK, and Token key together during upgrades, migrations, and recovery.

Never paste decrypted runtime materials into documentation, screenshots, logs, or support tickets.

### License trust boundary

License status, offline activation requests, license import, and quota validation are normal public-Docker functions. The license trust-root public key is built into Backend and cannot be overridden through deployment environment variables. License-signing private keys are not runtime materials; keep them in a separate private signing environment and never place them in a public repository, Docker build context, image, or container environment variable.

## Database and data directories

| Parameter | Edition | Default or behavior |
| --- | --- | --- |
| `GCAC_DATA_ROOT` | standard | Host persistence root, default `./data` (that is, `docker/data/`) |
| `POSTGRES_DB` | standard | PostgreSQL database name, default `gcac` |
| `POSTGRES_USER` | standard | PostgreSQL username, default `gcac` |
| `GCAC_DATABASE_HOST` | standard | PostgreSQL host, default `db` |
| `GCAC_DATABASE_PORT` | standard | PostgreSQL port, default `5432` |
| `GCAC_DATABASE_NAME` | standard | Backend database name; Compose defaults to `POSTGRES_DB` |
| `GCAC_DATABASE_USER` | standard | Backend database user; Compose defaults to `POSTGRES_USER` |
| `GCAC_DATABASE_PASSWORD` | standard | Backend database password; Compose defaults to `POSTGRES_PASSWORD` |
| `GCAC_DATABASE_URL` | standard | Complete PostgreSQL connection URL; takes precedence over component parameters |
| `GCAC_PGLITE_DATA_DIR` | small | PGlite data directory. The image defaults to `/app/data/pglite`; legacy-layout compatibility may fall back to `/var/lib/gcac/pglite` |
| `GCAC_WORKFLOW_DATA_DIR` | standard, small | User workflow directory, default `/app/data/workflows` |
| `GCAC_RUNTIME_SECRETS_FILE` | standard, small | Encrypted runtime-material path, default `/app/data/runtime/runtime-secrets.enc` |
| `GCAC_MIGRATIONS_DIR` | standard, small | Database migration directory, normally image-managed; do not change without a specific requirement |
| `GCAC_WEB_ROOT` | small | Static frontend directory, normally image-managed; do not change without a specific requirement |

The standard Compose file separately mounts `postgres/`, `workflows/`, `runtime/`, `tls-inspector/`, and `plugins/`. Back up the entire `GCAC_DATA_ROOT` in production; do not back up only PostgreSQL.

## Ports and network boundaries

| Parameter or port | Purpose | Rule |
| --- | --- | --- |
| `GCAC_PORT` | Standard Web host port | Default `8085`; update the public URL when changing it |
| `8085:3003` | Small host-to-container mapping | Left side is the host port; right side `3003` is fixed |
| `3003` | Backend or small internal Web/API port | Do not expose standard Backend `3003` directly to users |
| `8787` | Browser Runtime internal service port | Not mapped to the host; access through Web's `/vnc/` proxy |
| `8788` | Small TLS Inspector container port | Do not expose it to the public internet |

A reverse proxy should forward user requests to the Web port. Browser Runtime and TLS Inspector are internal services; do not add public port mappings for them.

## Identity, sessions, and tenants

| Parameter | Default behavior | Use it when |
| --- | --- | --- |
| `AUTH_COOKIE_SECURE` | Enabled automatically in production | Only temporary HTTP internal testing; do not disable for HTTPS |
| `AUTH_BROWSER_SESSION_TTL_SECONDS` | `28800` (8 hours) | You need a different browser-session lifetime, in seconds |
| `GCAC_TENANT_MODE` | `single` | You choose a tenant mode during initialization; review the existing data before switching |
| `GCAC_TOKEN_SECRET_FILE` | Small default `/app/data/runtime/token-secret` | You need a different writable and persistent path for the generated Token key |
| `GCAC_INITIAL_ADMIN_PASSWORD` | Unset | Legacy automated Admin seed only; use the initialization wizard for new deployments |
| `GCAC_ENABLE_LEGACY_ADMIN_SEED` | `false` | You need the legacy Admin seed; leave disabled for new deployments |
| `GCAC_CA_CONFIRMATION_SECRET` | Generated and encrypted on first startup | You have a specific key-management requirement; keep it unchanged after setting it |
| `GCAC_LICENSE_STORAGE_KEY` | Uses `GCAC_SECRET_KEK` | License-sensitive materials need a separately managed key |

## Browser Runtime (optional)

Browser Runtime is available only in standard and is disabled by default:

| Parameter | Default | Use it when |
| --- | --- | --- |
| `BROWSER_RUNTIME_ENABLED` | `false` | You want Compose to pull and start the Browser Runtime image; this variable only selects the Profile and is not passed to Backend |
| `COMPOSE_PROFILES` | `${BROWSER_RUNTIME_ENABLED}` | Keep the template value; if a deployment tool overrides it, it must include `browser-runtime` |
| `BROWSER_RUNTIME_URL` | `http://browser-runtime:8787` | Backend needs the Browser Runtime internal address |
| `BROWSER_RUNTIME_SHARED_SECRET` | Empty | Required when enabled; Backend and Browser Runtime must use the same value |
| `BROWSER_RUNTIME_PUBLIC_BASE_URL` | Empty | An external reverse proxy serves `/vnc/`; leave empty otherwise |
| `BROWSER_RUNTIME_MAX_SESSIONS` | `4` | You need a different maximum browser-session concurrency |

Example:

```dotenv
BROWSER_RUNTIME_ENABLED=true
COMPOSE_PROFILES=${BROWSER_RUNTIME_ENABLED}
BROWSER_RUNTIME_SHARED_SECRET=your-random-browser-runtime-secret
```

After editing `.env`, run from the `docker` directory:

```bash
docker compose pull
docker compose up -d
```

Do not map Browser Runtime CDP, RFB, or `8787` directly to the public internet.

## Background tasks and capacity tuning

The system also reads interval and concurrency variables for Agent offline detection, device liveness probes, monitoring, automation, CA synchronization, ACME renewal, and the task Worker, including:

- `AGENT_OFFLINE_TIMEOUT_SECONDS`
- `DEVICE_HEALTH_STALE_SECONDS`
- `DEVICE_LIVENESS_PROBE_INTERVAL_MS`
- `MONITOR_PROBE_SCHEDULER_INTERVAL_MS`
- `AUTOMATION_SCHEDULER_INTERVAL_MS`
- `GCAC_TASK_WORKER_INTERVAL_MS`

Both `AGENT_OFFLINE_TIMEOUT_SECONDS` and `DEVICE_HEALTH_STALE_SECONDS` default to 60 seconds. Agent terminal-task cleanup can be tuned with:

| Parameter | Default | Description |
| --- | --- | --- |
| `AGENT_TASK_CLEANUP_INTERVAL_MS` | 60 seconds | Cleanup check interval |
| `AGENT_TASK_CLEANUP_BATCH_SIZE` | 100 entries | Entries removed per run |
| `AGENT_TASK_DETERMINISTIC_RETENTION_SECONDS` | 1 hour | Retention for tasks with a known source |
| `AGENT_TASK_UNKNOWN_RETENTION_SECONDS` | 24 hours | Retention for tasks with an unknown source |

Cleanup removes only `succeeded`, `failed`, and `rejected` terminal tasks and their logs and cursors. It never removes active `queued`, `leased`, or `acked` tasks. These variables tune capacity and retention; keep the defaults unless you have measured capacity requirements.

## Source-build parameters (developers only)

The following parameters are not runtime deployment settings:

| Parameter | Purpose |
| --- | --- |
| `VITE_PRODUCT_EDITION` | Selects the product edition during source builds; default `public` |
| `DOCS_VERSION` | Docker build argument controlling the documentation version used by the frontend “User Manual” link |
| `VITE_DOCS_VERSION` | Documentation-version variable for source builds |

User deployments should use `docker/docker-compose.yml` and prebuilt Docker Hub images. Do not modify the user Compose file or place source-build parameters in a production `.env`.

## Never use these in production

`NODE_TEST_CONTEXT`, `GCAC_E2E_*`, `GCAC_P2_DEV_CUTOVER`, and test signing materials are for development or testing only. They do not replace production keys and should not be written into standard or small runtime environments.

For step-by-step deployment instructions, see [Single-node Deployment](./single-node-deployment.md) or [Standard Deployment](./standard-deployment.md). For backup guidance, see [Backup and Recovery](../manual/backup-and-restore.md).
