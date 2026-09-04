---
title: Single-node deployment (small)
description: Deploy TLSFlow v1.0.0 small on a single host with Docker
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

# Single-node deployment (small)

The small edition packages TLSFlow services in one Docker container and uses the built-in PGlite (a file-based PostgreSQL-compatible database) for storage. It does not require Docker Compose or a separate PostgreSQL server. Use it for evaluation, personal environments, home NAS systems, or small production environments with a limited number of application assets.

This guide takes you from an empty host to a working small instance. After deployment, continue with [First Login](./first-login.md) to create the administrator account and complete security setup.

## When to use small

The small edition is recommended for environments with **up to 50 application assets**. The following figures cover the container runtime only; they exclude image builds and other Docker services running on the host:

| Application assets | Recommended available memory | Recommended CPU | Typical use |
| ---: | ---: | ---: | --- |
| 5 | 512 MiB | 1 vCPU | Home NAS or light evaluation |
| 15 | 768 MiB | 1–2 vCPU | A few background tasks |
| 50 | 1 GiB | 2 vCPU | Near the long-term small-edition limit |
| 100 | Not recommended | — | Use [Standard Deployment](./standard-deployment.md) |

If the host has less than 8 GiB of total memory, small is usually the better choice; reserve at least 1 GiB for the NAS operating system and other Docker services. Move to the standard edition early as monitoring, credential checks, and certificate update jobs grow. Choose standard deployment when you need multiple tenants, standalone PostgreSQL, high availability, or Browser Runtime (the browser runtime service).

## Before you start

On the deployment host, confirm that:

- Docker CLI is installed and the Docker daemon is running.
- The host can reach the Docker registry and the devices, certificate services, and vendor APIs that TLSFlow will use.
- You know the public URL where users and Agents will reach TLSFlow, such as `http://192.168.1.20:8085` or `https://tlsflow.example.com`. The URL must be reachable from the Agent and from users' browsers.
- Persistent storage is available. Production deployments must retain `/app/data`; deleting or recreating the container without it removes the database, workflows, and runtime security materials.
- You have a random `GCAC_SECRET_KEK` (key-encryption key). Generate and store it in a password manager, and do not change it after initialization.

> **Security note:** Never put the KEK, Token signing key, or other runtime secrets in screenshots, logs, or support tickets. The values in this guide are examples only.

## Quick deployment

### 1. Start the container

Copy the command below to the deployment host and replace the two placeholders:

- `your-tlsflow-host:8085`: the address users and Agents will use to reach TLSFlow;
- `your-random-kek`: a randomly generated KEK that will remain unchanged.

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8085 -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-data:/app/data tlsflow/tlsflow-small:latest
```

Docker pulls the image and starts the container in the background. In `8085:3003`, the left side is the host port and the right side is the container's fixed port. If `8085` is already in use, change only the host port and update `GCAC_PUBLIC_BASE_URL` to match—for example, `-p 8103:3003` and `http://your-tlsflow-host:8103`.

The `tlsflow-small-data` Docker named volume stores:

| Container path | Contents |
| --- | --- |
| `/app/data/pglite` | Business database |
| `/app/data/workflows` | Workflow files |
| `/app/data/runtime` | Token key, encrypted runtime materials, and policy state |
| `/app/data/tls-inspector` | TLS Inspector data |
| `/app/data/plugins` | User plugin data |

### 2. Open the console and initialize TLSFlow

When the container is running, open `http://<host-address>:8085/` in a browser (use your custom host port if you changed it). The first visit opens the system initialization wizard. Follow the prompts to create the administrator account and password. New deployments do not need `GCAC_INITIAL_ADMIN_PASSWORD`.

![image-20260903T165008.webp](img/image-20260903T165008.webp)

The wizard sets the administrator password. On the first container startup, TLSFlow generates the CA high-risk-operation confirmation key and encrypts it with the KEK in the runtime directory; no extra environment variable is required.

### 3. Verify the deployment

Run these commands on the deployment host:

```bash
docker ps --filter name=tlsflow-small
docker logs --tail 200 tlsflow-small
```

Confirm that `tlsflow-small` is `Up`, the logs show that database migrations have completed and the service is listening on `3003`, and the console opens and accepts your login. Only after these checks should you import test certificates or connect production devices.

## Persistence, backup, and recovery

### Docker named volume (default)

The `-v tlsflow-small-data:/app/data` option in the quick-deployment command provides the required persistence. Keep this volume and all keys when restarting or upgrading. To see where Docker stores the volume, run:

```bash
docker volume inspect tlsflow-small-data
```

### Host-directory binding

Bind a host directory to `/app/data` when you need to manage files directly in a NAS share or run your own backups:

```bash
DATA_ROOT=/volume1/docker/tlsflow/data && mkdir -p "$DATA_ROOT/pglite" "$DATA_ROOT/workflows" "$DATA_ROOT/runtime" "$DATA_ROOT/tls-inspector" "$DATA_ROOT/plugins" && chown -R 10001:10001 "$DATA_ROOT"
```

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8085 -e GCAC_SECRET_KEK=your-random-kek -v "$DATA_ROOT:/app/data" tlsflow/tlsflow-small:latest
```

The image runs as UID/GID `10001:10001`. If the NAS share enforces strict permissions, grant this UID/GID read and write access before starting the container.

Stop the container before backup or recovery, then handle the complete `data/` directory according to [Backup and Recovery](../manual/backup-and-restore.md). Never copy files into a running PGlite directory.

## Optional configuration

Pass any of the following variables with an additional `-e name=value` option. Secret values must remain unchanged after first initialization. The image owns `GCAC_DEPLOYMENT_ARCHITECTURE`, `GCAC_PERSISTENCE_BACKEND`, and its internal directories; do not override them.

| Variable | Default behavior | Use it when |
| --- | --- | --- |
| `GCAC_TOKEN_SECRET` | Generated on first startup and saved to `runtime/token-secret` | You manage the login-token signing key yourself; keep it unchanged when migrating or rebuilding |
| `GCAC_TOKEN_SECRET_FILE` | `/app/data/runtime/token-secret` | You need a different writable path for the generated Token key |
| `GCAC_CA_CONFIRMATION_SECRET` | Generated on first startup and encrypted with the KEK | You manage the CA high-risk-operation confirmation key yourself; keep it unchanged after setting it |
| `GCAC_INITIAL_ADMIN_PASSWORD` | Unset; use the initialization wizard | You need the legacy automated Admin seed; also set `GCAC_ENABLE_LEGACY_ADMIN_SEED=true` |
| `GCAC_ENABLE_LEGACY_ADMIN_SEED` | `false` | You need to enable the legacy Admin seed; leave disabled for new deployments |
| `GCAC_AGENT_INSTALL_PUBLIC_BASE_URL` | Uses `GCAC_PUBLIC_BASE_URL` | Agent installation commands use a different public address than the console |
| `GCAC_AGENT_RELEASE_BASE_URL` | Uses `GCAC_PUBLIC_BASE_URL` | Agent release packages need a separate download domain |
| `GCAC_LICENSE_STORAGE_KEY` | Uses `GCAC_SECRET_KEK` | License-sensitive materials need a separate storage key |
| `GCAC_PGLITE_DATA_DIR` | `/app/data/pglite` | You need a custom PGlite directory; adjust the bind mount as well |
| `GCAC_WORKFLOW_DATA_DIR` | `/app/data/workflows` | You need a custom workflow directory; adjust the bind mount as well |
| `GCAC_RUNTIME_SECRETS_FILE` | `/app/data/runtime/runtime-secrets.enc` | You need a custom path for encrypted runtime materials; it must be persistent and writable |
| `AUTH_COOKIE_SECURE` | Enabled automatically in production | Only for temporary HTTP-only internal testing; do not disable it for HTTPS |
| `AUTH_BROWSER_SESSION_TTL_SECONDS` | `28800` (8 hours) | You need a different browser-session lifetime, in seconds |
| `GCAC_TENANT_MODE` | `single` | You choose the tenant mode during initialization; pre-check existing data before switching |
| `LOG_LEVEL` | `info` | You need `debug`, `info`, `warn`, or `error` logging |
| `GCAC_VERSION` | Uses the version bundled in the image | Controlled compatibility testing only; do not override in production |

## Common scenarios

### HTTPS reverse proxy and a separate Agent address

Use this configuration when the console is behind an HTTPS reverse proxy and Agent downloads use a separate domain:

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=https://tlsflow.example.com -e GCAC_AGENT_INSTALL_PUBLIC_BASE_URL=https://agent.example.com -e GCAC_AGENT_RELEASE_BASE_URL=https://agent.example.com -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-data:/app/data tlsflow/tlsflow-small:latest
```

The reverse proxy must forward requests to the container's `3003` port. Do not expose TLS Inspector's `8788` port to the public internet.

### Manually managed Token key

If your organization stores login-token keys in a password-management system, pass `GCAC_TOKEN_SECRET` explicitly. Keep the value unchanged:

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=https://tlsflow.example.com -e GCAC_SECRET_KEK=your-random-kek -e GCAC_TOKEN_SECRET=your-random-token-secret -v tlsflow-small-data:/app/data tlsflow/tlsflow-small:latest
```

### Temporary evaluation

For evaluation, keep a data volume when possible and use a separate container name and port:

```bash
docker run -d --name tlsflow-small-demo --restart unless-stopped -p 18085:3003 -e GCAC_PUBLIC_BASE_URL=http://192.168.1.20:18085 -e GCAC_SECRET_KEK=demo-random-kek -v tlsflow-small-demo-data:/app/data tlsflow/tlsflow-small:latest
```

If you only need to check that the page opens and do not need to retain data, you can omit `--restart` and `-v`:

```bash
docker run -d --name tlsflow-small-ephemeral -p 18086:3003 -e GCAC_PUBLIC_BASE_URL=http://192.168.1.20:18086 -e GCAC_SECRET_KEK=demo-random-kek tlsflow/tlsflow-small:latest
```

This temporary container loses its PGlite database, Token key, and runtime security materials when deleted. Never use the example keys in production.

## Upgrade, migrate, or switch editions

- **Upgrade the image:** Back up the data and `.env` (if used), stop and recreate the container, and change only the image tag. Keep `/app/data` and the KEK and Token key already in use.
- **Migrate from a legacy layout:** Stop the old container first. Copy the old PGlite, workflow, runtime, TLS Inspector, and plugin directories into the new `pglite`, `workflows`, `runtime`, `tls-inspector`, and `plugins` directories, then start with the single-directory mount. Never copy files into a running PGlite directory.
- **Switch to standard:** Run `docker rm -f tlsflow-small`, confirm that the host port and data directory are free, and then follow [Standard Deployment](./standard-deployment.md). Small and standard cannot run at the same time or share a data directory.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Container exits immediately | Run `docker logs tlsflow-small`; check the KEK, directory permissions, and port conflicts first |
| Page does not open | Run `docker ps`, verify the host-port mapping, and check the firewall and reverse proxy |
| Page opens but API calls fail | Review `docker logs --tail 200 tlsflow-small` and confirm migrations completed; do not expose Browser Runtime or TLS Inspector to the public internet |
| Login fails after restart | Confirm that the data volume is still mounted and that `GCAC_SECRET_KEK` and `GCAC_TOKEN_SECRET` have not changed |
| NAS reports a permission error | Grant UID/GID `10001:10001` read and write access to the bind directory and its subdirectories |

After installation and verification, continue with [First Login](./first-login.md). For the full environment-variable reference, see [Deployment Parameters](./deployment-parameters.md). For production backup guidance, see [Backup and Recovery](../manual/backup-and-restore.md).
