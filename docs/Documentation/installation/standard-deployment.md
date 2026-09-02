---
title: 标准部署
description: 使用 Docker Compose 部署 TLSFlow v1.0.0 标准版
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

## 资源建议

标准版适合多企业、多租户和持续后台任务场景。以下建议已考虑监控任务、凭据有效性检测、任务队列、间歇性证书批量更新、PostgreSQL 和 Browser Runtime 的运行开销；不包含镜像构建过程，也不包含宿主机上其他 Docker 服务的消耗：

| 应用资产数 | 建议可用内存 | 建议 CPU | Browser Runtime 会话建议 |
| ---: | ---: | ---: | ---: |
| 5 | 4 GiB | 2 vCPU | 1 |
| 15 | 6 GiB | 2 vCPU | 1-2 |
| 50 | 10 GiB | 4 vCPU | 2 |
| 100 | 16 GiB | 4 vCPU | 4 |

宿主机总内存低于 8 GiB 时，除非必须使用 Browser Runtime，否则应选择[单机部署](./single-node-deployment.md)。标准版还需要为 NAS 系统、PostgreSQL 数据库和其他 Docker 服务预留内存；浏览器会话、监控频率、凭据检测频率和证书更新并发越高，应优先使用表格的上档配置。

标准版基础部署由三个服务组成：`db` 使用 PostgreSQL 16 保存业务数据，`backend` 提供 API，`web` 提供控制台。
`browser-runtime` 是按需启用的独立服务，仅在 Docker 内部网络使用，不应直接暴露到公网。

用户部署入口固定为 `docker/docker-compose.yml`，所有应用镜像均从 Docker Hub 的 `tlsflow` 命名空间拉取。
开发者从源码构建时使用 `docker/dev-compose.yml`，不要修改用户版 Compose 文件来完成源码构建。

## 1. 准备变量

在仓库根目录执行：

```bash
cp docker/.env.example docker/.env
```

编辑 `docker/.env`，至少填写并替换示例值：

- `GCAC_RELEASE_VERSION`：镜像标签，生产环境使用固定发布标签，不要长期使用 `latest`；
- `GCAC_PUBLIC_BASE_URL`：Agent 可以访问的 TLSFlow Web 地址，例如 `http://tlsflow.example.com:8085`；
- `POSTGRES_PASSWORD`：PostgreSQL 密码；
- `GCAC_TOKEN_SECRET`：登录令牌签名密钥；
- `GCAC_SECRET_KEK`：Secret 和运行时安全材料的加密密钥，必须长期保持不变。

不要在 Compose 或 `.env` 中配置管理员初始密码、CA 确认密钥或审批自批准变量。管理员密码在首次打开控制台时
由系统初始化向导设置；CA 确认密钥由 Backend 首次启动时随机生成并加密保存。通用审批功能已停用，
不再需要审批相关环境变量。

默认不拉取或启动 Browser Runtime。需要浏览器登录凭据时，将
`BROWSER_RUNTIME_ENABLED=true`，保留模板中的 `COMPOSE_PROFILES=${BROWSER_RUNTIME_ENABLED}`，
并填写 `BROWSER_RUNTIME_SHARED_SECRET`。该开关只供 Docker Compose 选择 Profile，不会传给 Backend。

`GCAC_DATA_ROOT` 默认是 `./data`，即 `docker/data/`。如需使用其他宿主机目录，在 `.env` 中设置绝对路径，
并确保该目录及其子目录允许容器用户 `10001:10001` 写入。以下命令针对默认路径；使用自定义根目录时，
将命令中的 `docker/data` 替换为实际路径：

```bash
mkdir -p docker/data/{postgres,workflows,runtime,tls-inspector,plugins}
sudo chown -R 10001:10001 docker/data
```

## 2. 拉取并启动镜像

在 `docker` 目录执行以下命令。部署预构建镜像不需要安装 Node.js、Go、Buildx 或源码：

```bash
cd docker
docker compose pull
docker compose up -d
```

`docker compose` 会自动读取同目录下的 `.env`。当 `BROWSER_RUNTIME_ENABLED=true` 时，模板中的
`COMPOSE_PROFILES` 会使 `pull` 和 `up` 自动包含 Browser Runtime；保持默认 `false` 时不会下载或启动该镜像。
不需要额外追加 `--profile` 参数。

Web 默认映射到宿主机 `8085` 端口，可通过 `GCAC_PORT` 修改左侧端口，例如 `GCAC_PORT=8103`。
Backend 只加入 Compose 内部网络，不发布宿主机端口；Browser Runtime 只通过内部网络提供 `8787`，
不会映射到宿主机。

Compose 文件不包含 small 服务，也不包含源码构建配置。开发者构建源码时使用：

```bash
docker compose -f dev-compose.yml up --build -d
```

该命令生成并使用 `tlsflow-dev-*` 本地镜像，不会覆盖用户版 `tlsflow/*` 镜像。

## 3. 验证

```bash
docker compose ps
docker compose logs --tail=200 db backend web
```

确认 `db` 状态为 `healthy`，Backend 日志显示迁移完成并监听 `3003`，Web 状态为 `running`，再访问
`http://<主机地址>:<GCAC_PORT>/`。启用 Browser Runtime 时确认其容器状态为 `running`；其 CDP、RFB 和 `8787`
端口不映射到主机，需要远程浏览器会话时只能经 Web 的 `/vnc/` 代理访问。

首次打开控制台后，按初始化向导创建管理员账号和密码，再完成首次登录。若 Web 无法调用 API，检查
Backend 容器日志、Web 反向代理和 Compose 内部网络，不要把 Browser Runtime 地址改成公网地址。

## 运行边界

Compose 文件默认将持久化数据保存到 `docker/data/`，也可以通过 `GCAC_DATA_ROOT` 统一迁移到其他宿主机目录：

| 目录 | 内容 |
| --- | --- |
| `docker/data/postgres/` | PostgreSQL 数据库 |
| `docker/data/workflows/` | 用户工作流目录 `/app/data/workflows` |
| `docker/data/runtime/` | 加密运行时密钥、CA 确认密钥和策略状态 |
| `docker/data/tls-inspector/` | TLS Inspector 数据 |
| `docker/data/plugins/` | 用户插件包，只读挂载到 Backend |

`runtime/` 目录必须纳入备份。删除该目录会生成新的策略信任根和 CA 确认密钥；更换
`GCAC_SECRET_KEK` 会导致 Backend 无法解密已有运行时材料。标准版不会创建 `pglite/` 目录。

small 和 standard 不允许同时运行；切换架构前必须先停止 small 容器，并确认 `GCAC_PORT` 端口和共享数据
目录没有被占用。升级前先备份 `GCAC_DATA_ROOT` 和 `.env`，然后执行：

```bash
docker compose pull
docker compose up -d
```

升级时只替换镜像标签，不要删除数据目录或重新生成 `GCAC_SECRET_KEK`。标准版面向单机运行，未提供自动
故障转移等集群能力。
