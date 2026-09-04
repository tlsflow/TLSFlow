---
title: 部署参数
description: TLSFlow v1.0.0 Docker 部署的环境变量、端口、数据目录和密钥参考
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/docker-compose.yml
  - backend/src/config
  - docker/versions.env
testRefs: []
lastVerified: 2026-09-02
---

# 部署参数

本文是 TLSFlow Docker 部署的参数参考。大多数用户只需要阅读“必填参数”和“安全与持久化”两节；只有在更换端口、启用 Browser Runtime（浏览器运行时）、迁移数据或进行容量调优时，才需要继续查看后面的参数表。

环境变量必须在容器启动前准备：

- **标准版**通过 `docker/.env` 由 Docker Compose 读取；
- **单机版**通过 `docker run -e 变量名=值` 传入；
- 标记为密钥或敏感值的变量应只保存在权限受限的环境文件或密码管理器中。

## 先确认部署方式

| 项目 | 标准版（standard） | 单机版（small） |
| --- | --- | --- |
| 适用场景 | 生产、多租户、多企业或持续后台任务 | 评估、个人环境、家用 NAS 或 50 个应用资产以内 |
| 服务形态 | Docker Compose 多服务 | 单个 Docker 容器 |
| 数据库 | PostgreSQL 16，由 `db` 服务提供 | 内置 PGlite（文件型 PostgreSQL 兼容数据库） |
| 持久化根目录 | `GCAC_DATA_ROOT`，默认 `docker/data/` | Docker 卷或宿主机绑定目录，挂载到 `/app/data` |
| Web 端口 | `GCAC_PORT`，默认 `8085` | 宿主机映射端口，默认 `8085:3003` |
| Browser Runtime | 默认关闭，可按需启用 | 不支持 |
| 固定架构参数 | `GCAC_DEPLOYMENT_ARCHITECTURE=standard` | `GCAC_DEPLOYMENT_ARCHITECTURE=small`（镜像内置） |
| 固定持久化后端 | `GCAC_PERSISTENCE_BACKEND=postgres` | `GCAC_PERSISTENCE_BACKEND=pglite`（镜像内置） |

标准版和单机版不能同时运行，也不能共用端口或数据目录。small 的 PGlite 数据不能直接作为 standard 的 PostgreSQL 数据使用。

## 必填参数

### 所有部署都需要

| 参数 | 用途 | 示例或默认行为 |
| --- | --- | --- |
| `GCAC_PUBLIC_BASE_URL` | 用户和 Agent 实际访问 TLSFlow 的公开地址 | `https://tlsflow.example.com` 或 `http://192.168.1.20:8085` |
| `GCAC_SECRET_KEK` | Secret、许可证敏感材料和运行时安全材料的加密密钥 | 必须使用随机值；初始化后保持不变 |

`GCAC_PUBLIC_BASE_URL` 必须包含实际使用的协议、主机名和端口。使用 HTTPS 反向代理时填写代理地址，不要填写容器内部地址。

### 标准版还需要

| 参数 | 用途 | 示例或默认行为 |
| --- | --- | --- |
| `GCAC_RELEASE_VERSION` | 所有标准版镜像使用的版本标签 | 默认 `latest`；生产环境建议固定到发布版本 |
| `POSTGRES_PASSWORD` | PostgreSQL 数据库密码 | 必填，使用随机值 |
| `GCAC_TOKEN_SECRET` | 登录令牌签名密钥 | 必填，使用随机值并长期保持不变 |

标准版的 `POSTGRES_DB` 和 `POSTGRES_USER` 默认分别为 `gcac` 和 `gcac`，通常不需要修改。

### 单机版的区别

small 版只需要 `GCAC_PUBLIC_BASE_URL` 和 `GCAC_SECRET_KEK` 两个应用参数。未设置 `GCAC_TOKEN_SECRET` 时，镜像会在首次启动时生成 Token 签名密钥，并保存到 `/app/data/runtime/token-secret`；重启和升级时会继续使用该文件中的值。

管理员密码由首次访问控制台时的系统初始化向导设置，不要为了新部署而配置 `GCAC_INITIAL_ADMIN_PASSWORD`。CA 高风险操作确认密钥由首次启动时自动生成，并使用 KEK 加密后保存到运行时目录。

## 密钥、运行时材料与许可证

### 必须持久化的运行时目录

标准版默认使用 `GCAC_DATA_ROOT/runtime/`，small 默认使用挂载目录中的 `runtime/`。其中包含：

- Token 签名密钥；
- CA 高风险操作确认密钥；
- 策略信任根、签名私钥、密钥集合和策略包等加密运行时材料。

删除 `runtime/` 会生成新的信任根和 CA 确认密钥；更换 `GCAC_SECRET_KEK` 会导致已有材料无法解密，服务可能无法启动。因此，升级、迁移和恢复时必须同时保留数据目录、KEK 和 Token 密钥。

不要在文档、截图、日志或工单中粘贴解密后的运行时材料。

### 许可证信任边界

许可证状态、离线激活请求、许可证导入和额度校验属于公开 Docker 的正常功能。许可证信任根公钥随 Backend 代码固化，部署环境不能通过环境变量覆盖。许可证签发私钥不属于运行时材料，必须保存在独立的私有签发环境中，不得进入公开仓库、Docker 构建上下文、镜像或容器环境变量。

## 数据库和数据目录

| 参数 | 适用版本 | 默认值或说明 |
| --- | --- | --- |
| `GCAC_DATA_ROOT` | standard | 宿主机持久化根目录，默认 `./data`（即 `docker/data/`） |
| `POSTGRES_DB` | standard | PostgreSQL 数据库名，默认 `gcac` |
| `POSTGRES_USER` | standard | PostgreSQL 用户名，默认 `gcac` |
| `GCAC_DATABASE_HOST` | standard | PostgreSQL 主机，默认 `db` |
| `GCAC_DATABASE_PORT` | standard | PostgreSQL 端口，默认 `5432` |
| `GCAC_DATABASE_NAME` | standard | Backend 使用的数据库名；Compose 默认取 `POSTGRES_DB` |
| `GCAC_DATABASE_USER` | standard | Backend 使用的数据库用户；Compose 默认取 `POSTGRES_USER` |
| `GCAC_DATABASE_PASSWORD` | standard | Backend 使用的数据库密码；Compose 默认取 `POSTGRES_PASSWORD` |
| `GCAC_DATABASE_URL` | standard | 完整 PostgreSQL 连接 URL；设置后优先于分项连接参数 |
| `GCAC_PGLITE_DATA_DIR` | small | PGlite 数据目录。镜像默认先使用 `/app/data/pglite`；旧版独立目录兼容逻辑可能回退到 `/var/lib/gcac/pglite` |
| `GCAC_WORKFLOW_DATA_DIR` | standard、small | 用户工作流目录，默认 `/app/data/workflows` |
| `GCAC_RUNTIME_SECRETS_FILE` | standard、small | 加密运行时材料路径，默认 `/app/data/runtime/runtime-secrets.enc` |
| `GCAC_MIGRATIONS_DIR` | standard、small | 数据库迁移目录，通常由镜像固定，不建议修改 |
| `GCAC_WEB_ROOT` | small | 静态前端目录，通常由镜像固定，不建议修改 |

标准版 Compose 还会分别挂载 `postgres/`、`workflows/`、`runtime/`、`tls-inspector/` 和 `plugins/`。生产环境请将整个 `GCAC_DATA_ROOT` 纳入备份；不要只备份 PostgreSQL 目录。

## 端口与网络

| 参数或端口 | 作用 | 使用规则 |
| --- | --- | --- |
| `GCAC_PORT` | standard Web 主机端口 | 默认 `8085`；修改后同步修改公开 URL |
| `8085:3003` | small 主机到容器的端口映射 | 左侧是主机端口，右侧 `3003` 固定；端口冲突时只改左侧 |
| `3003` | Backend 或 small 容器内部 Web/API 端口 | 不要将 standard Backend 的 `3003` 直接暴露给用户 |
| `8787` | Browser Runtime 内部服务端口 | 不映射到主机；通过 Web 的 `/vnc/` 代理访问 |
| `8788` | small 容器内 TLS Inspector 端口 | 不要暴露到公网 |

反向代理应将用户请求转发到 Web 对外端口。Browser Runtime 和 TLS Inspector 只供内部服务使用，不应增加公网端口映射。

## 身份、会话和租户

| 参数 | 默认行为 | 使用说明 |
| --- | --- | --- |
| `AUTH_COOKIE_SECURE` | 生产环境自动开启 | 仅在 HTTP 内网测试时临时设为 `false`；HTTPS 部署不要关闭 |
| `AUTH_BROWSER_SESSION_TTL_SECONDS` | `28800`（8 小时） | 浏览器会话有效期，单位为秒 |
| `GCAC_TENANT_MODE` | `single` | 初始化时选择租户模式；已有数据切换前先在控制台预检查 |
| `GCAC_TOKEN_SECRET_FILE` | small 默认 `/app/data/runtime/token-secret` | 自定义自动生成 Token 密钥的持久化路径，必须位于可写且持久化的目录 |
| `GCAC_INITIAL_ADMIN_PASSWORD` | 未设置 | 仅兼容旧版自动化 Admin seed；新部署使用初始化向导 |
| `GCAC_ENABLE_LEGACY_ADMIN_SEED` | `false` | 是否启用旧版 Admin seed；新部署建议保持关闭 |
| `GCAC_CA_CONFIRMATION_SECRET` | 首次启动自动生成并加密保存 | 仅在有明确密钥托管要求时手动管理；设置后保持不变 |
| `GCAC_LICENSE_STORAGE_KEY` | 使用 `GCAC_SECRET_KEK` | 需要单独管理许可证敏感材料密钥时设置 |

## Browser Runtime（可选）

Browser Runtime 只在 standard 中可用，默认关闭。启用时使用以下参数：

| 参数 | 默认值 | 使用说明 |
| --- | --- | --- |
| `BROWSER_RUNTIME_ENABLED` | `false` | 是否让 Compose 拉取并启动 Browser Runtime 镜像；该变量只用于选择 Profile，不会传给 Backend |
| `COMPOSE_PROFILES` | `${BROWSER_RUNTIME_ENABLED}` | 保留模板中的值；如果部署工具覆盖它，必须包含 `browser-runtime` |
| `BROWSER_RUNTIME_URL` | `http://browser-runtime:8787` | Backend 访问 Browser Runtime 的内部地址 |
| `BROWSER_RUNTIME_SHARED_SECRET` | 空 | 启用时必填，Backend 与 Browser Runtime 必须使用相同值 |
| `BROWSER_RUNTIME_PUBLIC_BASE_URL` | 空 | 外部反向代理承载 `/vnc/` 时填写；不需要时留空 |
| `BROWSER_RUNTIME_MAX_SESSIONS` | `4` | 浏览器会话最大并发数 |

启用示例：

```dotenv
BROWSER_RUNTIME_ENABLED=true
COMPOSE_PROFILES=${BROWSER_RUNTIME_ENABLED}
BROWSER_RUNTIME_SHARED_SECRET=your-random-browser-runtime-secret
```

修改 `.env` 后，在 `docker` 目录重新执行：

```bash
docker compose pull
docker compose up -d
```

不要将 Browser Runtime 的 CDP、RFB 或 `8787` 端口直接映射到公网。

## 后台任务和容量调优

系统还读取 Agent 离线判断、设备存活探测、监控、自动化、CA 同步、ACME 续签和任务 Worker 的间隔及并发变量，例如：

- `AGENT_OFFLINE_TIMEOUT_SECONDS`
- `DEVICE_HEALTH_STALE_SECONDS`
- `DEVICE_LIVENESS_PROBE_INTERVAL_MS`
- `MONITOR_PROBE_SCHEDULER_INTERVAL_MS`
- `AUTOMATION_SCHEDULER_INTERVAL_MS`
- `GCAC_TASK_WORKER_INTERVAL_MS`

`AGENT_OFFLINE_TIMEOUT_SECONDS` 和 `DEVICE_HEALTH_STALE_SECONDS` 默认均为 60 秒。Agent 终态任务清理还可通过以下变量调整：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `AGENT_TASK_CLEANUP_INTERVAL_MS` | 60 秒 | 清理检查间隔 |
| `AGENT_TASK_CLEANUP_BATCH_SIZE` | 100 条 | 单次清理数量 |
| `AGENT_TASK_DETERMINISTIC_RETENTION_SECONDS` | 1 小时 | 可确定来源的终态任务保留时间 |
| `AGENT_TASK_UNKNOWN_RETENTION_SECONDS` | 24 小时 | 来源未知的终态任务保留时间 |

清理只删除 `succeeded`、`failed`、`rejected` 终态任务及其日志和游标，不会删除 `queued`、`leased`、`acked` 活动任务。上述变量只用于容量和保留期调优，没有明确容量证据时请保持默认值。

## 源码构建参数（仅开发者）

以下参数不属于用户运行时部署配置：

| 参数 | 作用 |
| --- | --- |
| `VITE_PRODUCT_EDITION` | 源码构建时选择产品版本，默认 `public` |
| `DOCS_VERSION` | Docker 构建参数，控制前端“使用手册”入口指向的文档版本 |
| `VITE_DOCS_VERSION` | 源码构建时使用的文档版本变量 |

用户部署请使用 `docker/docker-compose.yml` 和 Docker Hub 预构建镜像。不要为了部署修改用户版 Compose 文件，也不要把源码构建参数写入生产 `.env`。

## 明确不要用于生产

`NODE_TEST_CONTEXT`、`GCAC_E2E_*`、`GCAC_P2_DEV_CUTOVER` 和测试签名材料只服务开发或测试。它们不能替代生产密钥，也不应写入 standard 或 small 的运行环境。

如需了解具体部署步骤，请参阅[单机部署](./single-node-deployment.md)或[标准部署](./standard-deployment.md)；如需备份策略，请参阅[备份与恢复](../manual/backup-and-restore.md)。
