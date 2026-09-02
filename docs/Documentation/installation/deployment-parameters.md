---
title: 部署参数
description: TLSFlow v1.0.0 Docker 部署环境变量、端口和密钥说明
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
lastVerified: 2026-08-26
---

# 部署参数

环境变量（Environment Variable，进程启动时读取的配置项）必须在容器启动前准备。
带“敏感”的变量只能放在权限受限的环境文件中。standard 通过 Compose 读取这些变量；
small 通过 `docker run -e` 传入。

## 两种拓扑固定值

| 参数 | 标准部署 | 单机部署 |
| --- | --- | --- |
| `GCAC_DEPLOYMENT_ARCHITECTURE` | `standard` | `small`（镜像内置） |
| `GCAC_PERSISTENCE_BACKEND` | `postgres` | `pglite` |
| 数据库 | `db` 服务、PostgreSQL 16，数据保存于 `docker/data/postgres/` | PGlite 数据保存于 `data/pglite/` |
| Web 端口 | `GCAC_PORT`，默认 `8085` | 宿主机映射端口，默认 `8085:3003` |
| Browser Runtime | 默认关闭，可单独启用 | 不支持 |

## 镜像和必填参数

| 参数 | 用途 |
| --- | --- |
| `GCAC_RELEASE_VERSION` | standard 镜像标签；建议使用固定发布版本，默认 `latest` |
| `GCAC_PUBLIC_BASE_URL` | Agent 可访问的 TLSFlow Web 地址，例如 `http://主机地址:8085` |
| `GCAC_TOKEN_SECRET` | 登录令牌签名密钥；standard 必填，small 未设置时首次启动自动生成并持久化 |
| `GCAC_SECRET_KEK` | Secret（敏感值）加密密钥；standard 和 small 必填 |
| `POSTGRES_PASSWORD` | standard PostgreSQL 密码；small 不需要 |

small 只要求 `GCAC_PUBLIC_BASE_URL` 和 `GCAC_SECRET_KEK` 两个应用参数。`GCAC_TOKEN_SECRET`
未设置时首次启动自动生成并保存到 `data/runtime/token-secret`，重启时复用；手动传入时覆盖自动值。
PGlite 数据库、用户名、密码、主机和端口均使用镜像内置默认值。

管理员密码由首次启动时的系统初始化向导设置。CA 高风险操作确认密钥由容器首启自动生成，使用
`GCAC_SECRET_KEK` 加密后持久化；不需要在 Compose 或环境文件中配置。`BROWSER_RUNTIME_SHARED_SECRET`
仅在启用 Browser Runtime 时必填。

运行时安全材料（信任根、签名私钥、密钥集合和策略包等）由容器首次启动时自动生成，并使用 `GCAC_SECRET_KEK` 加密保存到 `/app/data/runtime/runtime-secrets.enc`。该目录必须持久化：删除它会生成全新的信任根，更换 `GCAC_SECRET_KEK` 会导致服务无法启动。不要在任何文档、日志或工单中粘贴解密后的材料。

许可证管理代码、许可证状态页面、离线激活请求、许可证导入和额度校验属于公开 Docker 的正常功能。当前内置许可证 `keyId` 为 `gcac-license-release-2026-08`，使用 Ed25519 256 位密钥，提供约 128 位安全强度。许可证信任根公钥随 Backend 代码固化，开发和正式发布环境都使用同一内置公钥，部署环境不能通过环境变量覆盖。许可证签发私钥不属于运行时材料，必须保存在独立的私有签发环境中，不能进入公开仓库、Docker 构建上下文、镜像或容器环境变量。

## 数据库与持久化目录

| 参数 | 作用 |
| --- | --- |
| `GCAC_DATABASE_HOST` / `GCAC_DATABASE_PORT` | 标准版 PostgreSQL 地址，默认主机为 `db`、端口 `5432` |
| `GCAC_DATABASE_NAME` / `GCAC_DATABASE_USER` / `GCAC_DATABASE_PASSWORD` | PostgreSQL 连接分项；`GCAC_DATABASE_URL` 设置后优先使用 URL |
| `GCAC_DATABASE_URL` | 完整 PostgreSQL 连接 URL |
| `GCAC_PGLITE_DATA_DIR` | small PGlite 数据目录，镜像默认 `/var/lib/gcac/pglite` |
| `GCAC_MIGRATIONS_DIR` | 数据库迁移目录，Compose 默认 `/app/src/database/migrations` |
| `GCAC_WORKFLOW_DATA_DIR` | 用户工作流目录，Compose 默认 `/app/data/workflows` |
| `GCAC_RUNTIME_SECRETS_FILE` | 加密运行时安全材料路径，Compose 默认 `/app/data/runtime/runtime-secrets.enc` |
| `GCAC_WEB_ROOT` | small 静态前端目录，镜像默认 `/app/web` |

## 身份、会话和许可证

| 参数 | 作用 |
| --- | --- |
| `AUTH_COOKIE_SECURE` | 是否强制安全 Cookie；生产环境默认开启 |
| `AUTH_BROWSER_SESSION_TTL_SECONDS` | 浏览器会话有效期（秒） |
| `GCAC_TENANT_MODE` | 租户模式；切换前先在控制台预检查 |
| `GCAC_LICENSE_STORAGE_KEY` | 许可证敏感材料存储密钥；未设置时使用 `GCAC_SECRET_KEK` |
| `GCAC_ENABLE_LEGACY_ADMIN_SEED` | 是否启用旧版固定 Admin seed；默认关闭 |
| `GCAC_INITIAL_ADMIN_PASSWORD` | 旧版自动化 seed 的 Admin 密码；新部署留空并使用初始化向导 |
| `GCAC_CA_CONFIRMATION_SECRET` | CA 高风险操作确认密钥；由生产容器首启自动生成并加密持久化，不应手工配置 |
| `GCAC_VERSION` | 覆盖运行时版本；正式发布保持为 `1.0.0` |

## Browser Runtime

| 参数 | 作用 |
| --- | --- |
| `BROWSER_RUNTIME_ENABLED` | Docker Compose 是否拉取并启动 Browser Runtime 镜像；默认 `false`，不会传给 Backend |
| `BROWSER_RUNTIME_URL` | Backend 访问浏览器运行时的内网地址，标准版默认 `http://browser-runtime:8787` |
| `BROWSER_RUNTIME_SHARED_SECRET` | Backend 与浏览器运行时之间的共享密钥；启用时必填 |
| `BROWSER_RUNTIME_PUBLIC_BASE_URL` | 外部反向代理承载 `/vnc/` 时的公开基础地址；不需要时留空 |
| `BROWSER_RUNTIME_MAX_SESSIONS` | 浏览器会话最大并发数，Compose 默认 `4` |

默认启动标准版时不包含 `browser-runtime` 服务。将
`BROWSER_RUNTIME_ENABLED=true` 后，模板中的 `COMPOSE_PROFILES` 会自动选择
Browser Runtime Profile；不需要额外追加命令参数。若部署工具覆盖了
`COMPOSE_PROFILES`，请确保其中包含 `browser-runtime`。

## 常用可选参数

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `GCAC_PORT` | standard 默认 `8085` | Web 对外端口；small 通过宿主机端口映射调整 |
| `GCAC_DATA_ROOT` | `./data` | 宿主机持久化数据根目录；默认与 Compose 文件位于同一目录 |
| `POSTGRES_DB` | `gcac` | 数据库名 |
| `POSTGRES_USER` | `gcac` | 数据库用户 |
| `BROWSER_RUNTIME_PUBLIC_BASE_URL` | 空 | 浏览器会话生成的公共地址；无公网访问时留空 |
| `BROWSER_RUNTIME_MAX_SESSIONS` | `4` | 浏览器会话上限 |
| `VITE_PRODUCT_EDITION` | `public` | 仅源码构建时使用，不属于运行时部署参数 |

系统还读取 Agent 离线判断、设备存活探测、监控、自动化、CA 同步、ACME 续签和任务 Worker（后台任务进程）的间隔/并发变量，例如 `AGENT_OFFLINE_TIMEOUT_SECONDS`、`DEVICE_HEALTH_STALE_SECONDS`、`DEVICE_LIVENESS_PROBE_INTERVAL_MS`、`MONITOR_PROBE_SCHEDULER_INTERVAL_MS`、`AUTOMATION_SCHEDULER_INTERVAL_MS` 和 `GCAC_TASK_WORKER_INTERVAL_MS`。`AGENT_OFFLINE_TIMEOUT_SECONDS` 与 `DEVICE_HEALTH_STALE_SECONDS` 默认均为 60 秒。Agent 终态任务自动清理可通过 `AGENT_TASK_CLEANUP_INTERVAL_MS`、`AGENT_TASK_CLEANUP_BATCH_SIZE`、`AGENT_TASK_DETERMINISTIC_RETENTION_SECONDS` 和 `AGENT_TASK_UNKNOWN_RETENTION_SECONDS` 调整；默认分别为 60 秒、100 条、1 小时和 24 小时。清理只删除 `succeeded`、`failed`、`rejected` 终态任务及其任务日志/游标，不触碰 `queued`、`leased`、`acked` 活动任务。上述变量只用于容量调优和保留期调整，不是新功能开关；没有明确容量证据时保持默认值。

## 明确不用于生产的变量

`NODE_TEST_CONTEXT`、`GCAC_E2E_*`、`GCAC_P2_DEV_CUTOVER` 和测试签名材料只服务开发或测试。它们不会替代生产密钥，也不应写入标准或单机 Compose 环境。
