---
title: Single-node Deployment
description: Deploy TLSFlow v1.0.0 small edition on a single host
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - docker/build-tools/Dockerfile.small
  - docker/.env.example
testRefs: []
lastVerified: 2026-09-02
---

# Single-node Deployment

## Resource Recommendations

The single-node edition is suitable for small-scale deployments with **under 50 application assets**. The following are recommended resources for running containers only, excluding image build processes or consumption by other Docker services on the host:

| Application Assets | Recommended Available Memory | Recommended CPU | Notes |
| ---: | ---: | ---: | --- |
| 5 | 512 MiB | 1 vCPU | Suitable for home NAS and light usage |
| 15 | 768 MiB | 1-2 vCPU | Suitable for few background tasks |
| 50 | 1 GiB | 2 vCPU | Near the long-term usage boundary for single-node edition |
| 100 | Not recommended | - | Should migrate to standard edition |

If host total memory is below 8 GiB, prioritize the single-node edition and reserve at least 1 GiB memory for the NAS system and other Docker services. When monitoring, credential validity checks, and certificate update tasks increase simultaneously, migrate to standard edition early.

Small edition packages all services in a single container, using built-in PGlite (file-based PostgreSQL-compatible database) to store data. It is suitable for evaluation and small-scale environments with under 50 application assets and does not include standalone PostgreSQL, high availability, or Browser Runtime capabilities. This deployment method only requires Docker CLI and is suitable for environments like Synology, QNAP, Unraid, and others with built-in Docker managers.

## Starting the Container

The following command only requires two deployment parameters to fill in: public address and KEK. Container name, port, and Docker named volume are fixed runtime configurations, not additional business parameters; `--label` is only for marking image architecture and can be omitted. Docker automatically pulls the image; execute the command below as a single line:

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8085 -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-data:/app/data tlsflow/gcac-small:latest
```

This quick installation uses a single Docker named volume to automatically save PGlite, workflow, runtime, TLS Inspector, and plugin data under `/app/data`, without requiring manual creation of host directories. The `-v` option is not a hard requirement for container startup, but production environments must retain it; otherwise, data, Token keys, and runtime security materials will be lost after container deletion or rebuild. When you need to directly manage files or backups in NAS shared directories, use the "Host Directory Binding" scenario command below.

Production environments must replace the KEK example value with a random key that remains unchanged long-term. The Token signing key is auto-generated on first startup and saved to `runtime/token-secret`, reused on upgrades and restarts; to manage it yourself, append `-e GCAC_TOKEN_SECRET=...` to override the default. When upgrading, only replace the image tag, retaining all data directories and keys. Default address is `http://<host-address>:8085/`; for port conflicts, only modify the left-side host port, e.g., `-p 8103:3003`.

Administrator password is set by the system initialization wizard on first startup. The CA high-risk operation confirmation key is auto-generated on container first startup and encrypted before being saved to the runtime directory, requiring no additional environment variables. Small edition database parameters should not be manually overridden unless there are explicit runtime requirements.

In Synology, QNAP, or Unraid GUI, create the container with the same container name, port, two environment variables, and one `data` Bind Mount; this directory must allow container writes. The image defaults to using UID/GID `10001:10001`; if NAS shared folders have strict permission controls enabled, grant this UID/GID read/write permissions in advance.

Legacy versions using separate `/var/lib/gcac/pglite` mounts can continue with the old command; to migrate to the new single-directory layout, first stop the old container, copy the old PGlite, workflow, runtime, TLS Inspector, and plugin directories to `DATA_ROOT/pglite`, `DATA_ROOT/workflows`, `DATA_ROOT/runtime`, `DATA_ROOT/tls-inspector`, and `DATA_ROOT/plugins` respectively, then start with the new single-directory command. Do not copy files over a running PGlite directory.

## Optional Variables

All variables below can be passed by appending `-e variable-name=value`. When unset, image or backend defaults are used; key-type variables must remain unchanged after first initialization. Do not override `GCAC_DEPLOYMENT_ARCHITECTURE`, `GCAC_PERSISTENCE_BACKEND`, or container internal directories.

| Variable | Default Behavior | Usage Notes |
| --- | --- | --- |
| `GCAC_TOKEN_SECRET` | Randomly generated on first startup and saved to `runtime/token-secret` | Manually manage login token signing key; keep consistent when migrating or rebuilding containers |
| `GCAC_TOKEN_SECRET_FILE` | `/app/data/runtime/token-secret` | Customize auto-generated Token key persistence file path; must be in writable directory |
| `GCAC_CA_CONFIRMATION_SECRET` | Auto-generated on first startup and encrypted with KEK before saving | Manually manage CA high-risk operation confirmation key; keep consistent after first setting |
| `GCAC_INITIAL_ADMIN_PASSWORD` | Not set, use initialization wizard | Compatible with legacy automated Admin seed; when enabled, also set `GCAC_ENABLE_LEGACY_ADMIN_SEED=true` |
| `GCAC_ENABLE_LEGACY_ADMIN_SEED` | `false` | Whether to enable legacy Admin seed; recommended to keep disabled for new deployments |
| `GCAC_AGENT_INSTALL_PUBLIC_BASE_URL` | Uses `GCAC_PUBLIC_BASE_URL` | Public address used by Agent installation commands; set when reverse proxy address differs from console address |
| `GCAC_AGENT_RELEASE_BASE_URL` | Uses `GCAC_PUBLIC_BASE_URL` | Agent release package download address; set when separate download domain is needed |
| `GCAC_LICENSE_STORAGE_KEY` | Uses `GCAC_SECRET_KEK` | Separately specify license sensitive material storage key |
| `GCAC_PGLITE_DATA_DIR` | `/app/data/pglite` | Customize PGlite data directory; after modification, must synchronize corresponding Bind Mount adjustment |
| `GCAC_WORKFLOW_DATA_DIR` | `/app/data/workflows` | Customize workflow directory; after modification, must synchronize corresponding Bind Mount adjustment |
| `GCAC_RUNTIME_SECRETS_FILE` | `/app/data/runtime/runtime-secrets.enc` | Customize encrypted runtime materials path; must be in persistent and writable directory |
| `AUTH_COOKIE_SECURE` | Automatically enabled in production | Only temporarily set to `false` for HTTP internal network testing; do not disable for HTTPS deployment |
| `AUTH_BROWSER_SESSION_TTL_SECONDS` | `28800` (8 hours) | Browser session validity period in seconds |
| `GCAC_TENANT_MODE` | `single` | Choose tenant mode during initialization; pre-check in console before switching with existing data |
| `LOG_LEVEL` | `info` | Log level, can be set to `debug`, `info`, `warn`, or `error` |
| `GCAC_VERSION` | Uses image built-in version | Only for controlled compatibility testing, do not override for formal deployment |

## Installation Scenario Examples

Each example command below is a single line; replace host address, port, and keys as needed; if a container with the same name exists, first execute `docker rm -f tlsflow-small`.

### Host Directory Binding

Suitable for NAS or environments requiring self-managed file backups. First prepare the directory (using `/volume1/docker/tlsflow/data` as an example below), then execute the command:

```bash
DATA_ROOT=/volume1/docker/tlsflow/data && mkdir -p "$DATA_ROOT/pglite" "$DATA_ROOT/workflows" "$DATA_ROOT/runtime" "$DATA_ROOT/tls-inspector" "$DATA_ROOT/plugins" && chown -R 10001:10001 "$DATA_ROOT"
```

```bash
docker run -d --name tlsflow-small --restart unless-stopped --label com.gcac.deployment.architecture=small -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8085 -e GCAC_SECRET_KEK=your-random-kek -v "$DATA_ROOT:/app/data" tlsflow/gcac-small:latest
```

### Custom Host Port

Host's `8103` maps to container's fixed `3003`, and the public address must also use the new port:

```bash
docker run -d --name tlsflow-small --restart unless-stopped --label com.gcac.deployment.architecture=small -p 8103:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8103 -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-data:/app/data tlsflow/gcac-small:latest
```

### Manually Fixed Token Key

Suitable for environments requiring centralized management of login token keys by password management systems. This value must remain unchanged long-term:

```bash
docker run -d --name tlsflow-small --restart unless-stopped --label com.gcac.deployment.architecture=small -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=https://tlsflow.example.com -e GCAC_SECRET_KEK=your-random-kek -e GCAC_TOKEN_SECRET=your-random-token-secret -v tlsflow-small-data:/app/data tlsflow/gcac-small:latest
```

### HTTPS Reverse Proxy and Separate Agent Address

When console is accessed via HTTPS reverse proxy and Agent download address uses a separate domain:

```bash
docker run -d --name tlsflow-small --restart unless-stopped --label com.gcac.deployment.architecture=small -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=https://tlsflow.example.com -e GCAC_AGENT_INSTALL_PUBLIC_BASE_URL=https://agent.example.com -e GCAC_AGENT_RELEASE_BASE_URL=https://agent.example.com -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-data:/app/data tlsflow/gcac-small:latest
```

### Temporary Evaluation Environment

Evaluation environments still recommend mounting data directory; use separate container name and port to avoid conflicts with production instances. Do not reuse example keys below in production environments:

```bash
docker run -d --name tlsflow-small-demo --restart unless-stopped --label com.gcac.deployment.architecture=small -p 18085:3003 -e GCAC_PUBLIC_BASE_URL=http://192.168.1.20:18085 -e GCAC_SECRET_KEK=demo-random-kek -v tlsflow-small-demo-data:/app/data tlsflow/gcac-small:latest
```

For only verifying if page can open and not needing to retain data, you can omit label and mount:

```bash
docker run -d --name tlsflow-small-ephemeral -p 18086:3003 -e GCAC_PUBLIC_BASE_URL=http://192.168.1.20:18086 -e GCAC_SECRET_KEK=demo-random-kek tlsflow/gcac-small:latest
```

This mode is only suitable for temporary testing; after container deletion, PGlite, Token keys, and runtime security materials will all be lost.

## Verification and Limitations

```bash
docker ps --filter name=tlsflow-small
docker logs --tail 200 tlsflow-small
```

After confirming migration completion and login availability, import test certificates. Small and standard editions cannot run simultaneously; before switching to standard edition, first execute `docker rm -f tlsflow-small`, then start according to [Standard Deployment](./standard-deployment.md). Do not directly copy files over a running PGlite directory. Backup and recovery must first stop the container, then handle the `data/` directory according to [Backup and Recovery](../manual/backup-and-restore.md).
