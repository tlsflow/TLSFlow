---
title: 单机部署
description: 使用 TLSFlow v1.0.0 小型版在单台主机上部署
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/compose.yml
  - docker/build-tools/Dockerfile.small
  - docker/build-tools/build-local.mjs
testRefs: []
lastVerified: 2026-08-22
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

单机部署把所有服务打包在一个容器中运行，使用内置的 PGlite（文件型 PostgreSQL 兼容数据库）保存数据。它适合评估和小规模环境，不包含独立 PostgreSQL、高可用或 Browser Runtime 等能力。

## 启动

将[部署参数](./deployment-parameters.md)中的单机变量注入当前 Shell 环境变量后，在仓库根目录执行：

```bash
node docker/build-tools/build-local.mjs --architecture small
GCAC_RELEASE_VERSION="$(tr -d '\r\n' < version)" \
docker compose --env-file docker/versions.env --profile small -f docker/compose.yml up -d
```

默认地址为 `http://<主机地址>:8085/`。端口冲突时设置 `GCAC_PORT`，例如 `GCAC_PORT=8103`。单机容器使用 `gcac_small_pglite` 和 `gcac_small_workflows` 命名卷保存数据，用户插件从宿主机 `data/plugins/` 目录只读挂载。

## 验证和限制

```bash
docker compose --profile small -f docker/compose.yml ps
docker compose --profile small -f docker/compose.yml logs small
```

确认迁移完成、登录可用后再导入测试证书。单机版不包含标准版的独立 PostgreSQL、Web 反向代理和 Browser Runtime；需要这些能力时改用[标准部署](./standard-deployment.md)，不要在运行中的 PGlite 目录上直接复制文件。备份和恢复必须先停止 `small` 容器，再按[备份与恢复](../manual/backup-and-restore.md)处理卷。
