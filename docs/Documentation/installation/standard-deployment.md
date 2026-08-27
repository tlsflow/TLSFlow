---
title: 标准部署
description: 使用 Docker Compose 部署 TLSFlow v1.0.0 标准版
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/compose.yml
  - docker/.env.example
testRefs: []
lastVerified: 2026-08-26
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

标准版基础部署由三个服务组成：PostgreSQL（关系数据库）保存业务数据，Backend 提供 API，Web 提供控制台。Browser Runtime 是按需启用的独立服务，仅在内网使用，不应直接暴露到公网。

## 1. 准备变量

复制 `docker/.env.example` 为 `docker/.env`，至少填写：

- `GCAC_IMAGE_NAMESPACE`：发布镜像的 Docker Hub 命名空间；
- `GCAC_RELEASE_VERSION`：镜像标签，建议使用固定版本，不要长期使用 `latest`；
- `GCAC_PUBLIC_BASE_URL`：Agent 可访问的 TLSFlow Web 地址；
- `POSTGRES_PASSWORD`、`GCAC_TOKEN_SECRET` 和 `GCAC_SECRET_KEK`。

新部署不需要 `GCAC_INITIAL_ADMIN_PASSWORD`；服务启动后通过 Web 初始化向导创建管理员。
默认不拉取或启动 Browser Runtime。需要浏览器登录凭据时，将
`BROWSER_RUNTIME_ENABLED=true`，保留模板中的 `COMPOSE_PROFILES=${BROWSER_RUNTIME_ENABLED}`，
并填写 `BROWSER_RUNTIME_SHARED_SECRET`。该开关只由 Docker Compose 使用，不会传给 Backend。

## 2. 拉取并启动镜像

在 `docker` 目录执行以下命令。宿主机不需要安装 Node.js、Go、Buildx 或源码：

```bash
cd docker
docker compose pull
docker compose up -d
```

当 `BROWSER_RUNTIME_ENABLED=true` 时，`docker compose pull` 和
`docker compose up -d` 会自动包含 Browser Runtime；保持默认 `false` 时不会下载或启动该镜像。

Web 默认访问端口为 `8085`；Backend 只加入 Compose 内部网络，不发布宿主机端口。
Compose 文件不包含 small 服务，也不包含源码构建配置。

## 3. 验证

```bash
docker compose ps
docker compose logs db backend web
```

确认 `db` 通过健康检查、Backend 完成迁移并监听 `3003`，Web 为运行状态，再访问 `http://<主机地址>:8085/`。启用 Browser Runtime 时再确认其服务健康；其 CDP、RFB 和 `8787` 端口不映射到主机，需要远程浏览器会话时只能经 Web 的 `/vnc/` 代理访问。若 Web 无法调用 API，检查反向代理和 Backend 容器网络，不要把 `BROWSER_RUNTIME_URL` 指向公网地址。

## 运行边界

Compose 文件默认将持久化数据保存到与 `compose.yml` 同目录的 `docker/data/` 目录：

| 目录 | 内容 |
| --- | --- |
| `docker/data/postgres/` | PostgreSQL 数据库 |
| `docker/data/workflows/` | 用户工作流目录 `/app/data/workflows` |
| `docker/data/runtime/` | 运行时密钥和策略状态 |
| `docker/data/tls-inspector/` | TLS Inspector 数据 |

标准版不会创建 `docker/data/pglite/`。用户插件目录 `docker/data/plugins/` 以只读方式挂载，需纳入
运维备份。small 和 standard 不允许同时运行；切换架构前必须先停止 small 容器，
并确认 `8085` 端口和共享数据目录没有被占用。升级前必须先备份 `docker/data/` 目录；
标准版面向单机运行，未提供自动故障转移等集群能力。
