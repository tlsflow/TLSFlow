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
  - docker/build-tools/Dockerfile.db
  - docker/build-tools/Dockerfile.backend
  - docker/build-tools/Dockerfile.web
  - docker/build-tools/Dockerfile.browser-runtime
testRefs: []
lastVerified: 2026-08-22
---

# 标准部署

标准版由四个服务组成：PostgreSQL（关系数据库）保存业务数据，Backend 提供 API，Web 提供控制台，Browser Runtime 提供凭据浏览器会话。Browser Runtime 只在 Docker 内网暴露 `8787`，不应直接发布到公网。

## 1. 准备变量

在当前 Shell 或 CI Secret 中至少设置 `POSTGRES_PASSWORD`、`GCAC_TOKEN_SECRET`、`GCAC_INITIAL_ADMIN_PASSWORD`、`GCAC_SECRET_KEK`、`GCAC_CA_CONFIRMATION_SECRET`、`BROWSER_RUNTIME_SHARED_SECRET`，以及插件 Runner 和策略授权进程要求的变量。完整清单见[部署参数](./deployment-parameters.md)。如果用本地文件保存变量，执行 Compose 前必须先安全导出到当前 Shell。

## 2. 构建 Agent 发布包和镜像

先生成 Agent Release Bundle（Agent 发布包）：

```bash
node docker/build-tools/build-agent-release-bundle.mjs
```

脚本会生成 Linux/Windows Agent、Windows Compatibility Agent 安装资源、`manifest.json` 和 SHA-256（安全散列）清单。缺少 Windows Compatibility Agent 产物时构建失败；不能把源码目录直接放入镜像。

公开仓库只做本地可复现构建，不执行 `docker login` 或 `--push`：

公开仓库只做本地可复现构建，不执行 `docker login` 或 `--push`：

```bash
node docker/build-tools/build-local.mjs --architecture standard
```

跨平台构建只能使用发布矩阵中的 `linux/amd64` 和 `linux/arm64`。镜像发布属于私有发布流水线，不是本页的部署步骤。

## 3. 启动服务

```bash
GCAC_RELEASE_VERSION="$(tr -d '\r\n' < version)" \
docker compose --env-file docker/versions.env --profile standard -f docker/compose.yml up -d
```

如果需要重新构建，追加 `--build`。Web 默认访问端口为 `8085`，Backend 默认端口为 `3003`；对外只建议发布 Web，Backend 端口仅用于受控运维和健康检查。

## 4. 验证

```bash
docker compose --profile standard -f docker/compose.yml ps
docker compose --profile standard -f docker/compose.yml logs db backend web browser-runtime
```

确认 `db` 通过健康检查、Backend 完成迁移并监听 `3003`，Web 和 Browser Runtime 均为健康状态，再访问 `http://<主机地址>:8085/`。Browser Runtime 的 CDP、RFB 和 `8787` 端口不映射到主机；需要远程浏览器会话时只能经 Web 的 `/vnc/` 代理访问。若 Web 无法调用 API，检查反向代理和 Backend 容器网络，不要把 `BROWSER_RUNTIME_URL` 指向公网地址。

## 运行边界

Compose 文件使用命名卷保存 PostgreSQL 和工作流数据：

| 卷 | 内容 |
| --- | --- |
| `gcac_postgres` | PostgreSQL 数据库 |
| `gcac_standard_workflows` | 用户工作流目录 `/app/data/workflows` |

用户插件从宿主机 `data/plugins/<pluginId>/` 以只读方式挂载，目录需要纳入运维备份。升级前必须先备份；标准版不等于高可用集群，当前代码没有提供自动故障转移或多主复制承诺。

本地构建脚本只把镜像加载到当前 Docker 主机，不会自动推送 Docker Hub；镜像发布属于独立发布流程。
