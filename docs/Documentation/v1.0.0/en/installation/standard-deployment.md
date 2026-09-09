---
title: Standard deployment
description: Deploy TLSFlow v1.0.0 standard on a single host with Docker Compose
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - docker/docker-compose.yml
  - docker/.env.example
testRefs: []
lastVerified: 2026-09-02
---

# Standard deployment

The standard edition runs TLSFlow as multiple Docker Compose services and stores business data in a separate PostgreSQL database. It is intended for production, multi-tenant and multi-enterprise environments, and deployments with continuously running monitoring, credential-check, and certificate-update jobs.

This guide deploys prebuilt images on a single host. The host does not need Node.js, Go, Buildx, or TLSFlow source code. After deployment, continue with [First Login](./first-login.md) to create the administrator account and complete security setup.

## When to use standard

These resource recommendations include PostgreSQL, background tasks, and optional Browser Runtime overhead; they exclude image builds and other Docker services on the host:

| Application assets | Recommended available memory | Recommended CPU | Browser Runtime sessions |
| ---: | ---: | ---: | ---: |
| 5 | 4 GiB | 2 vCPU | 1 |
| 15 | 6 GiB | 2 vCPU | 1–2 |
| 50 | 10 GiB | 4 vCPU | 2 |
| 100 | 16 GiB | 4 vCPU | 4 |

If the host has less than 8 GiB of total memory and Browser Runtime is not required, use [Single-node deployment](./single-node-deployment.md). Increase the configuration tier as browser sessions, monitoring frequency, credential-check frequency, and certificate-update concurrency grow.

The standard deployment includes:

| Service | Purpose | Publicly exposed |
| --- | --- | --- |
| `db` | PostgreSQL 16 database | No; Compose internal network only |
| `backend` | API and background tasks | No; Compose internal network only |
| `web` | TLSFlow Web console | Yes; host port `8085` by default |
| `browser-runtime` | Optional isolated Chromium service | No; access through the internal network and Web's `/vnc/` proxy only |

Standard is designed for single-host operation and does not provide automatic failover or other cluster capabilities. Small and standard cannot run at the same time or share ports or data directories.

## Before you start

On the deployment host, confirm that:

- Docker Engine and Docker Compose v2 are installed. Check with `docker compose version`.
- The Docker daemon is running and the host can reach the Docker registry.
- The host can reach the devices, certificate services, and vendor APIs that TLSFlow will use.
- You know the URL users and Agents will use to reach TLSFlow, such as `http://192.168.1.20:8085` or `https://tlsflow.example.com`.
- Persistent disk space is available and UID/GID `10001:10001` can read and write the data directory.
- You have random values for `POSTGRES_PASSWORD`, `GCAC_TOKEN_SECRET`, and `GCAC_SECRET_KEK`. Generate and store them in a password manager; do not change them after initialization.

> **Security note:** Never put the database password, KEK, Token signing key, or Browser Runtime shared secret in screenshots, logs, or support tickets. Values in this guide are examples only.

## Quick deployment

### 1. Create the configuration file

Run this from the repository root:

```bash
cp docker/.env.example docker/.env
```

Edit `docker/.env` and replace at least these values:

| Variable | Purpose |
| --- | --- |
| `GCAC_RELEASE_VERSION` | Image tag; pin a release in production instead of using `latest` long-term |
| `GCAC_PUBLIC_BASE_URL` | TLSFlow address reachable by Agents and users |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `GCAC_TOKEN_SECRET` | Login-token signing key |
| `GCAC_SECRET_KEK` | Encryption key for Secrets and runtime security materials |

`GCAC_PUBLIC_BASE_URL` must include the protocol, hostname, and port users actually use. With an HTTPS reverse proxy, enter the proxy URL rather than an internal container address.

The administrator password is set by the system initialization wizard on first access; do not set `GCAC_INITIAL_ADMIN_PASSWORD` in `.env`. On first startup, Backend generates the CA high-risk-operation confirmation key and encrypts it with the KEK; no extra variable is required. General approval functionality has been discontinued, so approval-related variables are not needed.


### 2. Prepare persistent directories

The default data root is `docker/data/`. From the repository root, run:

```bash
mkdir -p docker/data/{postgres,workflows,runtime,tls-inspector,plugins}
sudo chown -R 10001:10001 docker/data
```

To use another location, set `GCAC_DATA_ROOT` to an absolute path in `.env` and apply the same permission settings to that directory. Do not place production data in a temporary directory or the container writable layer.

### 3. Pull and start the services

Enter the `docker` directory and pull and start the prebuilt images:

```bash
cd docker
docker compose pull
docker compose up -d
```

Compose automatically reads the `.env` in the same directory. By default, only `db`, `backend`, and `web` start; Browser Runtime is not downloaded or started.

Web maps to host port `8085` by default. To change it, set `GCAC_PORT=8103` in `.env` and run `docker compose up -d` again. Backend does not publish a host port. Browser Runtime provides `8787` only inside the Compose network; do not add a public port mapping.

### 4. Open the console and initialize TLSFlow

Open `http://<host-address>:<GCAC_PORT>/`. The first visit opens the system initialization wizard. Follow the prompts to create the administrator account and password, then sign in.


## Verify the deployment

From the `docker` directory, run:

```bash
docker compose ps
docker compose logs --tail=200 db backend web
```

A successful deployment has:

- `db` in `healthy` state;
- Backend logs showing completed migrations and a listener on `3003`;
- Web in `running` state;
- A console that opens in the browser and accepts your login.

When Browser Runtime is enabled, also confirm that its container is `running`. CDP, RFB, and `8787` are not mapped to the host; remote browser sessions are available only through Web's `/vnc/` proxy. If the page opens but API calls fail, check Backend logs, the Web reverse proxy, and the Compose internal network first.

## Enable Browser Runtime (optional)

Enable Browser Runtime only when browser login credentials or browser-based workflows are required. Edit `.env`:

```dotenv
BROWSER_RUNTIME_ENABLED=true
COMPOSE_PROFILES=${BROWSER_RUNTIME_ENABLED}
BROWSER_RUNTIME_SHARED_SECRET=your-random-browser-runtime-secret
```

Then, from the `docker` directory, run:

```bash
docker compose pull
docker compose up -d
```

The template's `COMPOSE_PROFILES` selects the Profile automatically; no additional `--profile` argument is required. The shared secret must match between Backend and Browser Runtime. Do not expose the Browser Runtime address directly to the public internet.

## Data directories and backups

Compose stores the following directories under `GCAC_DATA_ROOT` (default: `docker/data/`):

| Directory | Contents |
| --- | --- |
| `postgres/` | PostgreSQL database |
| `workflows/` | User workflows, mounted at `/app/data/workflows` |
| `runtime/` | Encrypted runtime keys, CA confirmation key, and policy state |
| `tls-inspector/` | TLS Inspector data |
| `plugins/` | User plugin packages, mounted read-only to Backend |

Always back up `runtime/`. Deleting it creates a new policy trust root and CA confirmation key; changing `GCAC_SECRET_KEK` prevents Backend from decrypting existing runtime materials. Standard does not create a `pglite/` directory.

Stop the services before backup or recovery:

```bash
cd docker
docker compose down
```

Then handle the complete `GCAC_DATA_ROOT` directory and `.env` according to [Backup and Recovery](../manual/backup-and-restore.md). Start the services again with `docker compose up -d` after recovery.

## Upgrade, switch editions, or build from source

### Upgrade the images

Back up `GCAC_DATA_ROOT` and `.env` first, then run from the `docker` directory:

```bash
docker compose pull
docker compose up -d
```

For production upgrades, change only the image tag in `GCAC_RELEASE_VERSION`. Do not delete data directories or regenerate `POSTGRES_PASSWORD`, `GCAC_TOKEN_SECRET`, or `GCAC_SECRET_KEK`.

### Switch from small to standard

Stop and remove the small container:

```bash
docker rm -f tlsflow-small
```

Confirm that the host port and data directory are free, then configure and start standard as described in this guide. The two editions cannot run at the same time or share data directories; small's PGlite data cannot be used directly as standard's PostgreSQL data.

### Build from source (developers)

User deployments use `docker/docker-compose.yml` and prebuilt Docker Hub images. Developers building from source should run this from the `docker` directory:

```bash
docker compose -f dev-compose.yml up --build -d
```

This command uses local `tlsflow-dev-*` images and does not overwrite the user-facing `tlsflow/*` images. Do not modify the user Compose file for source builds.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `docker compose up` fails immediately | Run `docker compose config`; check that `.env` exists, required variables are set, and the YAML is valid |
| `db` is unhealthy | Run `docker compose logs db`; check the PostgreSQL password, disk space, and data-directory permissions |
| Web page does not open | Run `docker compose ps`; verify `GCAC_PORT` and firewall settings. Do not access Backend on `3003` |
| Page opens but API calls fail | Review `docker compose logs backend web`; confirm migrations completed and the internal proxy is reachable |
| Login fails or data cannot be decrypted after restart | Confirm `GCAC_DATA_ROOT` still points to the original directory and `GCAC_SECRET_KEK` and `GCAC_TOKEN_SECRET` have not changed |
| Browser Runtime does not start | Confirm `BROWSER_RUNTIME_ENABLED=true`, `COMPOSE_PROFILES` is present, and the shared secret is set |
| NAS reports a permission error | Grant UID/GID `10001:10001` read and write access to `GCAC_DATA_ROOT` and its subdirectories |

After installation and verification, continue with [First Login](./first-login.md). For the full environment-variable reference, see [Deployment Parameters](./deployment-parameters.md). For production backup guidance, see [Backup and Recovery](../manual/backup-and-restore.md).
