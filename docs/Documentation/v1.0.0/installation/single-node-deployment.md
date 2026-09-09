---
title: 单机部署（small）
description: 使用 Docker 在单台主机上部署 TLSFlow v1.0.0 small 版
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/build-tools/Dockerfile.small
  - docker/.env.example
testRefs: []
lastVerified: 2026-09-02
---

# 单机部署（small）

单机版（small）将 TLSFlow 的服务打包在一个 Docker 容器中，使用内置的 PGlite（文件型 PostgreSQL 兼容数据库）保存数据。它不需要 Docker Compose 或独立的 PostgreSQL，适合评估、个人环境、家用 NAS 以及应用资产较少的小型生产环境。

本文介绍从零启动一个可用的 small 实例。完成部署后，请继续阅读[首次登录](./first-login.md)完成管理员和安全设置。

## 适用范围

small 版建议用于 **50 个应用资产以内** 的环境。以下资源是容器运行本身的建议值，不包括镜像构建过程和主机上的其他 Docker 服务：

| 应用资产数 | 建议可用内存 | 建议 CPU | 适用说明 |
| ---: | ---: | ---: | --- |
| 5 | 512 MiB | 1 vCPU | 家用 NAS 或轻量评估 |
| 15 | 768 MiB | 1–2 vCPU | 少量后台任务 |
| 50 | 1 GiB | 2 vCPU | 接近 small 版的长期使用边界 |
| 100 | 不建议 | — | 请改用[标准部署](./standard-deployment.md) |

如果主机总内存低于 8 GiB，建议优先选择 small，并至少为 NAS 系统及其他 Docker 服务预留 1 GiB。监控、凭据有效性检测和证书更新任务同时增加时，应尽早迁移到标准版。需要多租户、独立 PostgreSQL、高可用或 Browser Runtime（浏览器运行时）时，请直接选择标准部署。

## 开始前准备

请在部署主机上确认以下条件：

- 已安装 Docker CLI，且 Docker daemon（Docker 后台服务）正在运行。
- 主机可以访问 Docker 镜像仓库，以及后续要连接的设备、证书服务和厂商 API。
- 已确定用户访问 TLSFlow 的公开地址，例如 `http://192.168.1.20:8085` 或 `https://tlsflow.example.com`。该地址必须能被 Agent 和浏览器实际访问。
- 已准备持久化存储。生产环境必须保留 `/app/data`，否则删除或重建容器会丢失数据库、工作流和运行时安全材料。
- 已准备随机的 `GCAC_SECRET_KEK`（密钥加密密钥）。建议使用密码管理器生成并保存，初始化后不要更换。

> **安全提示**：KEK、Token 签名密钥和其他运行时密钥不要写入截图、日志或工单。示例中的密钥只能用于阅读命令格式。

## 快速部署

### 1. 启动容器

将下面命令复制到部署主机的终端中，并替换两个占位值：

- `your-tlsflow-host:8085`：TLSFlow 对用户和 Agent 提供服务的地址；
- `your-random-kek`：随机生成且长期保持不变的 KEK。

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8085 -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-data:/app/data tlsflow/tlsflow-small:latest
```

Docker 会自动拉取镜像并在后台启动容器。命令中的 `8085:3003` 表示将主机的 `8085` 端口映射到容器的固定端口 `3003`；如果主机端口冲突，只需修改左侧端口，并同步修改 `GCAC_PUBLIC_BASE_URL`，例如 `-p 8103:3003` 和 `http://your-tlsflow-host:8103`。

`tlsflow-small-data` 是 Docker 命名卷，自动保存以下数据：

| 容器内目录 | 内容 |
| --- | --- |
| `/app/data/pglite` | 业务数据库 |
| `/app/data/workflows` | 工作流文件 |
| `/app/data/runtime` | Token 密钥、运行时加密材料和策略状态 |
| `/app/data/tls-inspector` | TLS Inspector 数据 |
| `/app/data/plugins` | 用户插件数据 |

### 2. 打开控制台并完成初始化

容器启动后，在浏览器打开 `http://<主机地址>:8085/`（如果修改了主机端口，请使用对应端口）。首次访问会进入系统初始化向导，按页面提示创建管理员账号和密码。新部署不需要设置 `GCAC_INITIAL_ADMIN_PASSWORD`。

![image-20260903T164950.webp](img/image-20260903T164950.webp)

管理员密码由向导设置；CA 高风险操作确认密钥会在容器首次启动时自动生成，并使用 KEK 加密保存在运行时目录，无需额外设置环境变量。

### 3. 验证部署

在部署主机执行：

```bash
docker ps --filter name=tlsflow-small
docker logs --tail 200 tlsflow-small
```

确认 `tlsflow-small` 处于 `Up`（运行中）状态，日志显示数据库迁移已完成且服务监听 `3003`，然后在浏览器确认控制台可以打开并登录。完成验证后，再导入测试证书或接入生产设备。

## 持久化、备份与恢复

### 使用 Docker 命名卷（默认）

快速部署命令中的 `-v tlsflow-small-data:/app/data` 已满足持久化要求。升级或重启时保留该卷和所有密钥即可。查看卷位置可执行：

```bash
docker volume inspect tlsflow-small-data
```

### 绑定宿主机目录

如果需要直接在 NAS 共享目录中管理文件或执行备份，可将宿主机目录绑定到 `/app/data`：

```bash
DATA_ROOT=/volume1/docker/tlsflow/data && mkdir -p "$DATA_ROOT/pglite" "$DATA_ROOT/workflows" "$DATA_ROOT/runtime" "$DATA_ROOT/tls-inspector" "$DATA_ROOT/plugins" && chown -R 10001:10001 "$DATA_ROOT"
```

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8085 -e GCAC_SECRET_KEK=your-random-kek -v "$DATA_ROOT:/app/data" tlsflow/tlsflow-small:latest
```

镜像默认以 UID/GID `10001:10001` 运行；NAS 共享目录启用严格权限控制时，请提前授予该 UID/GID 读写权限。


备份或恢复前必须先停止容器，再按[备份与恢复](../manual/backup-and-restore.md)处理整个 `data/` 目录。不要在运行中的 PGlite 目录上复制文件。

## 可选配置

以下变量可通过追加 `-e 变量名=值` 传入。密钥类变量在首次初始化后必须保持不变。`GCAC_DEPLOYMENT_ARCHITECTURE`、`GCAC_PERSISTENCE_BACKEND` 及容器内部目录由镜像固定，不要覆盖。

| 变量 | 默认行为 | 使用说明 |
| --- | --- | --- |
| `GCAC_TOKEN_SECRET` | 首次启动随机生成并保存到 `runtime/token-secret` | 手动管理登录令牌签名密钥；迁移或重建容器时保持一致 |
| `GCAC_TOKEN_SECRET_FILE` | `/app/data/runtime/token-secret` | 自定义 Token 密钥持久化文件路径；必须位于可写目录 |
| `GCAC_CA_CONFIRMATION_SECRET` | 首次启动自动生成，并使用 KEK 加密保存 | 手动管理 CA 高风险操作确认密钥；首次设置后保持一致 |
| `GCAC_INITIAL_ADMIN_PASSWORD` | 未设置，使用初始化向导 | 兼容旧版自动化 Admin seed；启用时还需设置 `GCAC_ENABLE_LEGACY_ADMIN_SEED=true` |
| `GCAC_ENABLE_LEGACY_ADMIN_SEED` | `false` | 是否启用旧版 Admin seed；新部署建议保持关闭 |
| `GCAC_AGENT_INSTALL_PUBLIC_BASE_URL` | 使用 `GCAC_PUBLIC_BASE_URL` | Agent 安装命令使用的公开地址；与控制台地址不同时设置 |
| `GCAC_AGENT_RELEASE_BASE_URL` | 使用 `GCAC_PUBLIC_BASE_URL` | Agent 发布包下载地址；需要独立下载域名时设置 |
| `GCAC_LICENSE_STORAGE_KEY` | 使用 `GCAC_SECRET_KEK` | 单独指定许可证敏感材料存储密钥 |
| `GCAC_PGLITE_DATA_DIR` | `/app/data/pglite` | 自定义 PGlite 数据目录；必须同步调整绑定挂载 |
| `GCAC_WORKFLOW_DATA_DIR` | `/app/data/workflows` | 自定义工作流目录；必须同步调整绑定挂载 |
| `GCAC_RUNTIME_SECRETS_FILE` | `/app/data/runtime/runtime-secrets.enc` | 自定义加密运行时材料路径；必须位于持久化且可写的目录 |
| `AUTH_COOKIE_SECURE` | 生产环境自动开启 | 仅可在 HTTP 内网测试时临时设为 `false`；HTTPS 部署不要关闭 |
| `AUTH_BROWSER_SESSION_TTL_SECONDS` | `28800`（8 小时） | 浏览器会话有效期，单位为秒 |
| `GCAC_TENANT_MODE` | `single` | 初始化时选择租户模式；已有数据切换前先在控制台预检查 |
| `LOG_LEVEL` | `info` | 日志级别，可设为 `debug`、`info`、`warn` 或 `error` |
| `GCAC_VERSION` | 使用镜像内置版本 | 仅用于受控兼容性测试；正式部署不要覆盖 |

## 常见场景

### HTTPS 反向代理和独立 Agent 地址

控制台通过 HTTPS 反向代理访问，且 Agent 使用独立下载域名时：

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=https://tlsflow.example.com -e GCAC_AGENT_INSTALL_PUBLIC_BASE_URL=https://agent.example.com -e GCAC_AGENT_RELEASE_BASE_URL=https://agent.example.com -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-data:/app/data tlsflow/tlsflow-small:latest
```

反向代理必须将请求转发到容器的 `3003` 端口；不要把 TLS Inspector 的 `8788` 端口暴露到公网。

### 手动固定 Token 密钥

如果组织使用密码管理系统统一托管登录令牌密钥，可显式传入 `GCAC_TOKEN_SECRET`。该值必须长期保持不变：

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=https://tlsflow.example.com -e GCAC_SECRET_KEK=your-random-kek -e GCAC_TOKEN_SECRET=your-random-token-secret -v tlsflow-small-data:/app/data tlsflow/tlsflow-small:latest
```

### 临时评估环境

评估时仍建议挂载数据卷，并使用独立的容器名和端口：

```bash
docker run -d --name tlsflow-small-demo --restart unless-stopped -p 18085:3003 -e GCAC_PUBLIC_BASE_URL=http://192.168.1.20:18085 -e GCAC_SECRET_KEK=demo-random-kek -v tlsflow-small-demo-data:/app/data tlsflow/tlsflow-small:latest
```

只验证页面能否打开且不需要保留数据时，可以省略 `--restart` 和 `-v`：

```bash
docker run -d --name tlsflow-small-ephemeral -p 18086:3003 -e GCAC_PUBLIC_BASE_URL=http://192.168.1.20:18086 -e GCAC_SECRET_KEK=demo-random-kek tlsflow/tlsflow-small:latest
```

临时容器删除后，PGlite、Token 密钥和运行时安全材料都会丢失。示例密钥绝不能用于生产环境。

## 升级、迁移与切换版本

- **升级镜像**：先备份数据和 `.env`（如有），再停止并重新创建容器，只替换镜像标签；保留 `/app/data` 和已使用过的 KEK、Token 密钥。
- **从旧版目录迁移**：先停止旧容器，将旧 PGlite、工作流、运行时、TLS Inspector 和插件目录分别复制到新目录下的 `pglite`、`workflows`、`runtime`、`tls-inspector` 和 `plugins`，再使用单目录挂载启动。不要在运行中的 PGlite 目录上复制文件。
- **切换到标准版**：先执行 `docker rm -f tlsflow-small`，确认 `8085`（或自定义端口）和数据目录已释放，再按[标准部署](./standard-deployment.md)启动。small 与 standard 不能同时运行，也不能共用数据目录。

## 排障

| 现象 | 处理建议 |
| --- | --- |
| 容器立即退出 | 执行 `docker logs tlsflow-small`，优先检查 KEK、目录权限和端口占用 |
| 页面无法打开 | 执行 `docker ps`，确认主机端口映射正确，并检查防火墙和反向代理 |
| 页面能打开但 API 失败 | 查看 `docker logs --tail 200 tlsflow-small`，确认迁移完成；不要把 Browser Runtime 或 TLS Inspector 地址改成公网地址 |
| 重启后无法登录 | 确认数据卷仍挂载，且 `GCAC_SECRET_KEK`、`GCAC_TOKEN_SECRET` 没有变化 |
| NAS 报权限错误 | 确认绑定目录及子目录允许 UID/GID `10001:10001` 读写 |

完成安装和验证后，请继续阅读[首次登录](./first-login.md)。需要完整环境变量说明时，参阅[部署参数](./deployment-parameters.md)；生产环境的备份策略请参阅[备份与恢复](../manual/backup-and-restore.md)。
