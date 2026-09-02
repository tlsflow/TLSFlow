---
title: Standard Deployment
description: Deploy TLSFlow v1.0.0 standard edition with Docker Compose
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

# Standard Deployment

## Resource Recommendations

The standard edition is suitable for multi-tenant, multi-enterprise, and continuous background task scenarios. The following recommendations account for monitoring tasks, credential validity checks, task queues, intermittent certificate batch updates, PostgreSQL, and Browser Runtime overhead; they do not include image build processes or consumption by other Docker services on the host:

| Application Assets | Recommended Available Memory | Recommended CPU | Browser Runtime Session Recommendation |
| ---: | ---: | ---: | ---: |
| 5 | 4 GiB | 2 vCPU | 1 |
| 15 | 6 GiB | 2 vCPU | 1-2 |
| 50 | 10 GiB | 4 vCPU | 2 |
| 100 | 16 GiB | 4 vCPU | 4 |

When host total memory is below 8 GiB, unless Browser Runtime is essential, choose [Single-node Deployment](./single-node-deployment.md) instead. Standard edition also requires memory reservation for NAS systems, PostgreSQL databases, and other Docker services; with higher browser sessions, monitoring frequency, credential check frequency, and certificate update concurrency, prioritize the higher configuration tier from the table.

The standard edition base deployment consists of three services: `db` uses PostgreSQL 16 to store business data, `backend` provides the API, and `web` provides the console. `browser-runtime` is an independently enabled on-demand service that only operates within the Docker internal network and should not be directly exposed to the public internet.

The user deployment entry is fixed at `docker/docker-compose.yml`, and all application images are pulled from the `tlsflow` namespace on Docker Hub. Developers building from source use `docker/dev-compose.yml`; do not modify the user-facing Compose file to complete source builds.

## 1. Prepare Variables

Execute in the repository root directory:

```bash
cp docker/.env.example docker/.env
```

Edit `docker/.env` and fill in at least the following, replacing example values:

- `GCAC_RELEASE_VERSION`: Image tag; production environments use fixed release tags, do not use `latest` long-term;
- `GCAC_PUBLIC_BASE_URL`: TLSFlow Web address accessible by Agent, e.g., `http://tlsflow.example.com:8085`;
- `POSTGRES_PASSWORD`: PostgreSQL password;
- `GCAC_TOKEN_SECRET`: Login token signing key;
- `GCAC_SECRET_KEK`: Encryption key for Secrets and runtime security materials, must remain unchanged long-term.

Do not configure administrator initial password, CA confirmation key, or approval self-approval variables in Compose or `.env`. Administrator password is set by the system initialization wizard when first opening the console; CA confirmation key is randomly generated and encrypted on Backend first startup. General approval functionality has been discontinued and no longer requires approval-related environment variables.

By default, Browser Runtime is not pulled or started. When browser login credentials are needed, set `BROWSER_RUNTIME_ENABLED=true`, keep `COMPOSE_PROFILES=${BROWSER_RUNTIME_ENABLED}` from the template, and fill in `BROWSER_RUNTIME_SHARED_SECRET`. This toggle is only for Docker Compose to select the Profile and is not passed to Backend.

`GCAC_DATA_ROOT` defaults to `./data`, meaning `docker/data/`. To use another host directory, set an absolute path in `.env` and ensure that directory and its subdirectories allow container user `10001:10001` to write. The following commands target the default path; when using a custom root directory, replace `docker/data` in commands with the actual path:

```bash
mkdir -p docker/data/{postgres,workflows,runtime,tls-inspector,plugins}
sudo chown -R 10001:10001 docker/data
```

## 2. Pull and Start Images

Execute the following commands in the `docker` directory. Deploying pre-built images does not require installing Node.js, Go, Buildx, or source code:

```bash
cd docker
docker compose pull
docker compose up -d
```

`docker compose` automatically reads the `.env` in the same directory. When `BROWSER_RUNTIME_ENABLED=true`, the `COMPOSE_PROFILES` in the template makes `pull` and `up` automatically include Browser Runtime; keeping the default `false` will not download or start that image. No additional `--profile` parameter needed.

Web defaults to mapping to host port `8085`, modifiable via `GCAC_PORT` for the left-side port, e.g., `GCAC_PORT=8103`. Backend only joins the Compose internal network and does not publish host ports; Browser Runtime only provides `8787` through the internal network and is not mapped to the host.

The Compose file does not include small services or source build configuration. Developers building from source use:

```bash
docker compose -f dev-compose.yml up --build -d
```

This command generates and uses `tlsflow-dev-*` local images without overwriting the user-facing `tlsflow/*` images.

## 3. Verification

```bash
docker compose ps
docker compose logs --tail=200 db backend web
```

Confirm that `db` status is `healthy`, Backend logs show migration completed and listening on `3003`, Web status is `running`, then access `http://<host-address>:<GCAC_PORT>/`. When Browser Runtime is enabled, confirm its container status is `running`; its CDP, RFB, and `8787` ports are not mapped to the host and can only be accessed through Web's `/vnc/` proxy when remote browser sessions are needed.

After first opening the console, follow the initialization wizard to create an administrator account and password, then complete first login. If Web cannot call the API, check Backend container logs, Web reverse proxy, and Compose internal network; do not change the Browser Runtime address to a public address.

## Runtime Boundaries

The Compose file defaults to saving persistence data to `docker/data/`, but can be uniformly migrated to another host directory via `GCAC_DATA_ROOT`:

| Directory | Contents |
| --- | --- |
| `docker/data/postgres/` | PostgreSQL database |
| `docker/data/workflows/` | User workflow directory `/app/data/workflows` |
| `docker/data/runtime/` | Encrypted runtime keys, CA confirmation key, and policy state |
| `docker/data/tls-inspector/` | TLS Inspector data |
| `docker/data/plugins/` | User plugin packages, read-only mounted to Backend |

The `runtime/` directory must be included in backups. Deleting this directory generates a new policy trust root and CA confirmation key; changing `GCAC_SECRET_KEK` prevents Backend from decrypting existing runtime materials. Standard edition will not create a `pglite/` directory.

Small and standard editions cannot run simultaneously; before switching architectures, you must first stop the small container and confirm that the `GCAC_PORT` port and shared data directories are not occupied. Before upgrading, back up `GCAC_DATA_ROOT` and `.env`, then execute:

```bash
docker compose pull
docker compose up -d
```

When upgrading, only replace the image tag; do not delete data directories or regenerate `GCAC_SECRET_KEK`. Standard edition is designed for single-host operation and does not provide automatic failover or other cluster capabilities.
