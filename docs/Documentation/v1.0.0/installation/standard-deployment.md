---
title: 标准部署
description: 使用 Docker Compose 在单台主机上部署 TLSFlow v1.0.0 标准版
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/docker-compose.yml
  - docker/.env.example
testRefs: []
lastVerified: 2026-09-02
---

# 标准部署

标准版（standard）使用 Docker Compose 运行 TLSFlow 的多个服务，并使用独立的 PostgreSQL 保存业务数据。它适合生产环境、多租户、多企业以及需要持续运行监控、凭据检测和证书更新任务的场景。

本文介绍如何在单台主机上部署预构建镜像。部署主机不需要安装 Node.js、Go、Buildx 或 TLSFlow 源码。完成部署后，请继续阅读[首次登录](./first-login.md)完成管理员和安全设置。

## 适用范围

标准版的资源建议已考虑 PostgreSQL、后台任务和可选 Browser Runtime（浏览器运行时）的开销，不包括镜像构建过程及主机上的其他 Docker 服务：

| 应用资产数 | 建议可用内存 | 建议 CPU | Browser Runtime 会话建议 |
| ---: | ---: | ---: | ---: |
| 5 | 4 GiB | 2 vCPU | 1 |
| 15 | 6 GiB | 2 vCPU | 1–2 |
| 50 | 10 GiB | 4 vCPU | 2 |
| 100 | 16 GiB | 4 vCPU | 4 |

如果主机总内存低于 8 GiB，且不需要 Browser Runtime，建议使用[单机部署](./single-node-deployment.md)。浏览器会话数、监控频率、凭据检测频率和证书更新并发越高，应优先选择表格中的上档配置。

标准版基础部署包含以下服务：

| 服务 | 作用 | 对外暴露 |
| --- | --- | --- |
| `db` | PostgreSQL 16 数据库 | 否，仅限 Compose 内部网络 |
| `backend` | API 和后台任务 | 否，仅限 Compose 内部网络 |
| `web` | TLSFlow Web 控制台 | 是，默认主机端口 `8085` |
| `browser-runtime` | 按需启用的隔离 Chromium 服务 | 否，仅通过内部网络和 Web 的 `/vnc/` 代理访问 |

标准版面向单机运行，不提供自动故障转移等集群能力。small 和 standard 不能同时运行，也不能共用端口或数据目录。

## 开始前准备

请在部署主机上确认以下条件：

- 已安装 Docker Engine 和 Docker Compose v2，可执行 `docker compose version` 检查。
- Docker daemon 正在运行，主机可以访问 Docker 镜像仓库。
- 主机可以访问后续要接入的设备、证书服务和厂商 API。
- 已确定用户和 Agent 可以访问的 TLSFlow 地址，例如 `http://192.168.1.20:8085` 或 `https://tlsflow.example.com`。
- 已准备持久化磁盘空间，并确认容器用户 UID/GID `10001:10001` 对数据目录具有读写权限。
- 已准备随机的 `POSTGRES_PASSWORD`、`GCAC_TOKEN_SECRET` 和 `GCAC_SECRET_KEK`。建议使用密码管理器生成和保存；初始化后不要更换。

> **安全提示**：不要把数据库密码、KEK、Token 签名密钥或 Browser Runtime 共享密钥写入截图、日志或工单。示例值只能用于说明格式。

## 快速部署

### 1. 创建配置文件

在仓库根目录执行：

```bash
cp docker/.env.example docker/.env
```

编辑 `docker/.env`，至少替换以下值：

| 变量 | 用途 |
| --- | --- |
| `GCAC_RELEASE_VERSION` | 镜像标签；生产环境建议使用固定版本，不要长期使用 `latest` |
| `GCAC_PUBLIC_BASE_URL` | Agent 和用户实际访问的 TLSFlow 地址 |
| `POSTGRES_PASSWORD` | PostgreSQL 密码 |
| `GCAC_TOKEN_SECRET` | 登录令牌签名密钥 |
| `GCAC_SECRET_KEK` | Secret 和运行时安全材料的加密密钥 |

`GCAC_PUBLIC_BASE_URL` 必须包含用户实际访问的协议、主机名和端口。使用 HTTPS 反向代理时填写代理地址，而不是容器内部地址。

管理员密码由首次访问时的系统初始化向导设置，不要在 `.env` 中配置 `GCAC_INITIAL_ADMIN_PASSWORD`。CA 高风险操作确认密钥由 Backend 首次启动时自动生成，并使用 KEK 加密保存；通用审批功能已停用，不需要添加审批相关变量。


### 2. 准备持久化目录

默认数据目录是 `docker/data/`。在仓库根目录执行：

```bash
mkdir -p docker/data/{postgres,workflows,runtime,tls-inspector,plugins}
sudo chown -R 10001:10001 docker/data
```

如果使用其他位置，在 `.env` 中将 `GCAC_DATA_ROOT` 设置为绝对路径，并对实际目录执行相同的权限设置。不要把生产数据目录放在临时目录或容器可写层中。

### 3. 拉取并启动服务

进入 `docker` 目录，拉取并启动预构建镜像：

```bash
cd docker
docker compose pull
docker compose up -d
```

Compose 会自动读取同目录下的 `.env`。默认只启动 `db`、`backend` 和 `web`；Browser Runtime 不会被下载或启动。

Web 默认映射到主机的 `8085` 端口。如需更换端口，在 `.env` 中设置 `GCAC_PORT=8103`，然后重新执行 `docker compose up -d`。Backend 不发布主机端口，Browser Runtime 只在 Compose 内部提供 `8787`，不要为它增加公网端口映射。

### 4. 打开控制台并完成初始化

打开 `http://<主机地址>:<GCAC_PORT>/`。首次访问会进入系统初始化向导，按页面提示创建管理员账号和密码，然后登录控制台。


## 验证部署

在 `docker` 目录执行：

```bash
docker compose ps
docker compose logs --tail=200 db backend web
```

部署成功应满足以下条件：

- `db` 状态为 `healthy`；
- Backend 日志显示数据库迁移已完成，并监听 `3003`；
- Web 状态为 `running`；
- 浏览器可以打开控制台并完成登录。

启用 Browser Runtime 时，还要确认其容器处于 `running`。CDP、RFB 和 `8787` 端口不会映射到主机；需要远程浏览器会话时，只能通过 Web 的 `/vnc/` 代理访问。页面能打开但 API 请求失败时，优先检查 Backend 日志、Web 反向代理和 Compose 内部网络。

## 启用 Browser Runtime（可选）

只有需要浏览器登录凭据或浏览器类工作流时才启用 Browser Runtime。编辑 `.env`：

```dotenv
BROWSER_RUNTIME_ENABLED=true
COMPOSE_PROFILES=${BROWSER_RUNTIME_ENABLED}
BROWSER_RUNTIME_SHARED_SECRET=your-random-browser-runtime-secret
```

然后在 `docker` 目录执行：

```bash
docker compose pull
docker compose up -d
```

模板中的 `COMPOSE_PROFILES` 会根据开关自动选择 Profile，不需要额外追加 `--profile`。共享密钥必须在 Backend 和 Browser Runtime 之间保持一致；不要把 Browser Runtime 地址直接暴露到公网。

## 数据目录与备份

Compose 默认将以下目录保存到 `GCAC_DATA_ROOT`（默认是 `docker/data/`）：

| 目录 | 内容 |
| --- | --- |
| `postgres/` | PostgreSQL 数据库 |
| `workflows/` | 用户工作流，对应容器内 `/app/data/workflows` |
| `runtime/` | 加密运行时密钥、CA 确认密钥和策略状态 |
| `tls-inspector/` | TLS Inspector 数据 |
| `plugins/` | 用户插件包，以只读方式挂载到 Backend |

`runtime/` 必须纳入备份。删除该目录会生成新的策略信任根和 CA 确认密钥；更换 `GCAC_SECRET_KEK` 会导致 Backend 无法解密已有运行时材料。标准版不会创建 `pglite/` 目录。

备份或恢复前必须停止服务：

```bash
cd docker
docker compose down
```

然后按[备份与恢复](../manual/backup-and-restore.md)处理完整的 `GCAC_DATA_ROOT` 目录和 `.env`。恢复后再执行 `docker compose up -d`。

## 升级、切换与开发构建

### 升级镜像

升级前先备份 `GCAC_DATA_ROOT` 和 `.env`，然后在 `docker` 目录执行：

```bash
docker compose pull
docker compose up -d
```

生产环境升级时只替换 `GCAC_RELEASE_VERSION` 的镜像标签，不要删除数据目录、重新生成 `POSTGRES_PASSWORD`、`GCAC_TOKEN_SECRET` 或 `GCAC_SECRET_KEK`。

### 从 small 切换到 standard

先停止并删除 small 容器：

```bash
docker rm -f tlsflow-small
```

确认主机端口和数据目录已释放后，再按本文配置并启动标准版。两种部署不能同时运行，也不能共用数据目录；small 的 PGlite 数据不能直接作为 standard 的 PostgreSQL 数据使用。

### 从源码构建（开发者）

用户部署使用 `docker/docker-compose.yml` 和 Docker Hub 预构建镜像。开发者从源码构建时，在 `docker` 目录执行：

```bash
docker compose -f dev-compose.yml up --build -d
```

该命令使用 `tlsflow-dev-*` 本地镜像，不会覆盖用户版 `tlsflow/*` 镜像。不要修改用户版 Compose 文件来完成源码构建。

## 排障

| 现象 | 处理建议 |
| --- | --- |
| `docker compose up` 直接失败 | 执行 `docker compose config`，检查 `.env` 是否存在、必填变量是否填写，以及 YAML 配置是否有效 |
| `db` 不健康 | 查看 `docker compose logs db`，检查 PostgreSQL 密码、磁盘空间和数据目录权限 |
| Web 页面无法打开 | 执行 `docker compose ps`，确认 `GCAC_PORT` 映射和防火墙设置；不要访问 Backend 的 `3003` |
| 页面能打开但 API 失败 | 查看 `docker compose logs backend web`，确认迁移完成及内部代理可达 |
| 重启后无法登录或无法解密数据 | 确认 `GCAC_DATA_ROOT` 仍指向原目录，且 `GCAC_SECRET_KEK`、`GCAC_TOKEN_SECRET` 没有变化 |
| Browser Runtime 无法启动 | 确认 `BROWSER_RUNTIME_ENABLED=true`、`COMPOSE_PROFILES` 未被删除，并已填写共享密钥 |
| NAS 报权限错误 | 确认 `GCAC_DATA_ROOT` 及子目录允许 UID/GID `10001:10001` 读写 |

完成安装和验证后，请继续阅读[首次登录](./first-login.md)。完整环境变量说明请参阅[部署参数](./deployment-parameters.md)，生产环境备份请参阅[备份与恢复](../manual/backup-and-restore.md)。
