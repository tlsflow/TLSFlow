---
title: 单机部署
description: 使用 TLSFlow v1.0.0 小型版在单台主机上部署
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

# 单机部署

## 资源建议

单机版适合 **50 个应用资产以下** 的小规模部署。以下是仅运行容器的建议资源，不包含镜像构建过程，也不包含宿主机上其他 Docker 服务的消耗：

| 应用资产数 | 建议可用内存 | 建议 CPU | 说明 |
| ---: | ---: | ---: | --- |
| 5 | 512 MiB | 1 vCPU | 适合家用 NAS 和轻量使用 |
| 15 | 768 MiB | 1-2 vCPU | 适合少量后台任务 |
| 50 | 1 GiB | 2 vCPU | 已接近单机版长期使用边界 |
| 100 | 不建议 | - | 应迁移到标准版 |

如果宿主机总内存低于 8 GiB，优先选择单机版，并为 NAS 系统和其他 Docker 服务保留至少 1 GiB 内存。监控、凭据有效性检测和证书更新任务同时增多时，应提前迁移到标准版。

small 把所有服务打包在一个容器中运行，使用内置的 PGlite（文件型 PostgreSQL 兼容数据库）
保存数据。它适合 50 个应用资产以下的评估和小规模环境，不包含独立 PostgreSQL、
高可用或 Browser Runtime 等能力。该部署方式只需要 Docker CLI，适合群晖、威联通、
Unraid 等内置 Docker 管理器的环境。

## 启动容器

下面命令只有公开地址和 KEK 两个需要填写的部署参数。容器名、端口和 Docker 命名卷是固定的运行配置，
不是额外的业务参数；`--label` 仅用于标记镜像架构，也可以省略。Docker 会自动拉取镜像；将下面命令保持为
一行执行即可：

```bash
docker run -d --name tlsflow-small --restart unless-stopped -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8085 -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-pglite:/var/lib/gcac/pglite -v tlsflow-small-data:/app/data tlsflow/gcac-small:latest
```

该快速安装使用两个 Docker 命名卷自动保存 PGlite 和 `/app/data` 下的工作流、运行时、TLS Inspector
及插件数据，不需要手动创建宿主机目录。两个 `-v` 选项不是容器启动的硬性要求，但生产环境必须保留，
否则删除或重建容器后数据、Token 密钥和运行时安全材料都会丢失。需要在 NAS 共享目录中直接管理文件、备份或将插件目录设为只读时，
使用下面“宿主机目录绑定”场景的命令。

正式环境必须把 KEK 示例值替换为随机且长期保持不变的密钥。Token 签名密钥在首次启动时自动生成并
保存到 `runtime/token-secret`，升级和重启都会复用；如需自行管理，可追加
`-e GCAC_TOKEN_SECRET=...` 覆盖默认值。升级时只替换
镜像标签，保留所有数据目录和密钥。默认地址为 `http://<主机地址>:8085/`；
端口冲突时只修改左侧宿主机端口，例如 `-p 8103:3003`。

管理员密码由首次启动时的系统初始化向导设置。CA 高风险操作确认密钥由容器首启自动生成并加密
保存到运行时目录，无需追加环境变量。small 的数据库参数不要手动覆盖，除非有明确的运行时需求。

在群晖、威联通或 Unraid 图形界面中，按同样的容器名、端口、两个环境变量和五个
Bind Mount（绑定挂载）创建容器即可；`plugins` 目录设置为只读，其余四个目录必须
允许容器写入。镜像默认使用 UID/GID `10001:10001`，若 NAS 的共享文件夹启用严格
权限控制，应提前授予该 UID/GID 读写权限。

## 可选变量

以下变量都可以通过追加 `-e 变量名=值` 传入。未设置时使用镜像或后端默认值；密钥类变量一旦用于
首次初始化，后续重启必须保持不变。`GCAC_DEPLOYMENT_ARCHITECTURE`、`GCAC_PERSISTENCE_BACKEND`
和容器内部目录不要覆盖。

| 变量 | 默认行为 | 使用说明 |
| --- | --- | --- |
| `GCAC_TOKEN_SECRET` | 首次启动随机生成并保存到 `runtime/token-secret` | 手动管理登录令牌签名密钥；迁移或重建容器时保持一致 |
| `GCAC_TOKEN_SECRET_FILE` | `/app/data/runtime/token-secret` | 自定义自动生成 Token 密钥的持久化文件路径；必须位于可写目录 |
| `GCAC_CA_CONFIRMATION_SECRET` | 首次启动自动生成并使用 KEK 加密保存 | 手动管理 CA 高风险操作确认密钥；首次设置后保持一致 |
| `GCAC_INITIAL_ADMIN_PASSWORD` | 不设置，使用初始化向导 | 兼容旧版自动化 Admin seed；启用时还需设置 `GCAC_ENABLE_LEGACY_ADMIN_SEED=true` |
| `GCAC_ENABLE_LEGACY_ADMIN_SEED` | `false` | 是否启用旧版 Admin seed；新部署建议保持关闭 |
| `GCAC_AGENT_INSTALL_PUBLIC_BASE_URL` | 使用 `GCAC_PUBLIC_BASE_URL` | Agent 安装命令使用的公开地址；反向代理地址与控制台地址不同时设置 |
| `GCAC_AGENT_RELEASE_BASE_URL` | 使用 `GCAC_PUBLIC_BASE_URL` | Agent 发布包下载地址；需要独立下载域名时设置 |
| `GCAC_LICENSE_STORAGE_KEY` | 使用 `GCAC_SECRET_KEK` | 单独指定许可证敏感材料存储密钥 |
| `GCAC_PGLITE_DATA_DIR` | `/var/lib/gcac/pglite` | 自定义 PGlite 数据目录；修改后必须同步调整对应 Bind Mount |
| `GCAC_WORKFLOW_DATA_DIR` | `/app/data/workflows` | 自定义工作流目录；修改后必须同步调整对应 Bind Mount |
| `GCAC_RUNTIME_SECRETS_FILE` | `/app/data/runtime/runtime-secrets.enc` | 自定义加密运行时材料路径；必须位于持久化且可写的目录 |
| `AUTH_COOKIE_SECURE` | 生产环境自动开启 | 仅在 HTTP 内网测试时临时设置为 `false`；HTTPS 部署不要关闭 |
| `AUTH_BROWSER_SESSION_TTL_SECONDS` | `28800`（8 小时） | 浏览器会话有效期，单位为秒 |
| `GCAC_TENANT_MODE` | `single` | 初始化时选择租户模式；已有数据切换前先在控制台预检查 |
| `LOG_LEVEL` | `info` | 日志级别，可设为 `debug`、`info`、`warn` 或 `error` |
| `GCAC_VERSION` | 使用镜像内置版本 | 仅用于受控兼容性测试，正式部署不要覆盖 |

## 安装场景示例

下面示例每条命令都是一行，按需替换主机地址、端口和密钥；已有同名容器时先执行
`docker rm -f tlsflow-small`。

### 宿主机目录绑定

适合 NAS、需要自行备份文件或需要将插件目录设为只读的环境。先准备目录（下面以
`/volume1/docker/tlsflow/data` 为例），再执行命令：

```bash
DATA_ROOT=/volume1/docker/tlsflow/data && mkdir -p "$DATA_ROOT/pglite" "$DATA_ROOT/workflows" "$DATA_ROOT/runtime" "$DATA_ROOT/tls-inspector" "$DATA_ROOT/plugins" && chown -R 10001:10001 "$DATA_ROOT"
```

```bash
docker run -d --name tlsflow-small --restart unless-stopped --label com.gcac.deployment.architecture=small -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8085 -e GCAC_SECRET_KEK=your-random-kek -v "$DATA_ROOT/pglite:/var/lib/gcac/pglite" -v "$DATA_ROOT/workflows:/app/data/workflows" -v "$DATA_ROOT/runtime:/app/data/runtime" -v "$DATA_ROOT/tls-inspector:/app/data/tls-inspector" -v "$DATA_ROOT/plugins:/app/data/plugins:ro" tlsflow/gcac-small:latest
```

### 自定义宿主机端口

宿主机的 `8103` 映射到容器固定的 `3003`，公开地址也必须使用新端口：

```bash
docker run -d --name tlsflow-small --restart unless-stopped --label com.gcac.deployment.architecture=small -p 8103:3003 -e GCAC_PUBLIC_BASE_URL=http://your-tlsflow-host:8103 -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-pglite:/var/lib/gcac/pglite -v tlsflow-small-data:/app/data tlsflow/gcac-small:latest
```

### 手动固定 Token 密钥

适合需要由密码管理系统统一托管登录令牌密钥的环境。该值必须长期保持不变：

```bash
docker run -d --name tlsflow-small --restart unless-stopped --label com.gcac.deployment.architecture=small -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=https://tlsflow.example.com -e GCAC_SECRET_KEK=your-random-kek -e GCAC_TOKEN_SECRET=your-random-token-secret -v tlsflow-small-pglite:/var/lib/gcac/pglite -v tlsflow-small-data:/app/data tlsflow/gcac-small:latest
```

### HTTPS 反向代理和独立 Agent 地址

当控制台通过 HTTPS 反向代理访问，且 Agent 下载地址使用独立域名时：

```bash
docker run -d --name tlsflow-small --restart unless-stopped --label com.gcac.deployment.architecture=small -p 8085:3003 -e GCAC_PUBLIC_BASE_URL=https://tlsflow.example.com -e GCAC_AGENT_INSTALL_PUBLIC_BASE_URL=https://agent.example.com -e GCAC_AGENT_RELEASE_BASE_URL=https://agent.example.com -e GCAC_SECRET_KEK=your-random-kek -v tlsflow-small-pglite:/var/lib/gcac/pglite -v tlsflow-small-data:/app/data tlsflow/gcac-small:latest
```

### 临时评估环境

评估环境仍建议挂载数据目录；使用独立容器名和端口，避免与正式实例冲突。不要在生产环境复用下面的
示例密钥：

```bash
docker run -d --name tlsflow-small-demo --restart unless-stopped --label com.gcac.deployment.architecture=small -p 18085:3003 -e GCAC_PUBLIC_BASE_URL=http://192.168.1.20:18085 -e GCAC_SECRET_KEK=demo-random-kek -v tlsflow-small-demo-pglite:/var/lib/gcac/pglite -v tlsflow-small-demo-data:/app/data tlsflow/gcac-small:latest
```

只验证页面能否打开、且不需要保留数据时，可以省略标签和挂载：

```bash
docker run -d --name tlsflow-small-ephemeral -p 18086:3003 -e GCAC_PUBLIC_BASE_URL=http://192.168.1.20:18086 -e GCAC_SECRET_KEK=demo-random-kek tlsflow/gcac-small:latest
```

该模式仅适合临时测试；容器删除后 PGlite、Token 密钥和运行时安全材料都会随之丢失。

## 验证和限制

```bash
docker ps --filter name=tlsflow-small
docker logs --tail 200 tlsflow-small
```

确认迁移完成、登录可用后再导入测试证书。small 与 standard 不允许同时运行；
切换到标准版前先执行 `docker rm -f tlsflow-small`，再按[标准部署](./standard-deployment.md)
启动。不要在运行中的 PGlite 目录上直接复制文件。备份和恢复必须先停止容器，再按
[备份与恢复](../manual/backup-and-restore.md)处理 `data/` 目录。
