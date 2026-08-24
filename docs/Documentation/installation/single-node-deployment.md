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
  - docker/Dockerfile.small
  - docker/build-local.mjs
testRefs: []
lastVerified: 2026-08-22
---

# 单机部署

单机部署使用 `small` profile 和 PGlite（嵌入 Backend 的文件型 PostgreSQL 兼容数据库），所有服务在一个 `gcac-small` 容器中运行。它适合评估和小规模环境，不提供独立 PostgreSQL、拆分服务、高可用或 Browser Runtime 服务。

## 启动

将[部署参数](./deployment-parameters.md)中的单机变量注入当前 Shell 或 CI Secret 后，在仓库根目录执行：

```bash
node docker/build-local.mjs --architecture small
GCAC_RELEASE_VERSION="$(tr -d '\r\n' < version)" \
docker compose --env-file docker/versions.env --profile small -f docker/compose.yml up -d
```

默认地址为 `http://<主机地址>:8085/`。端口冲突时设置 `GCAC_PORT`，例如 `GCAC_PORT=8103`。单机容器使用 `gcac_small_pglite` 和 `gcac_small_workflows` 命名卷，并以只读根文件系统运行；用户插件从宿主机 `data/plugins/<pluginId>/` 只读挂载。

## 验证和限制

```bash
docker compose --profile small -f docker/compose.yml ps
docker compose --profile small -f docker/compose.yml logs small
```

确认迁移完成、登录可用后再导入测试证书。单机版不包含标准版的独立 PostgreSQL、Web 反向代理和 Browser Runtime；需要这些能力时改用[标准部署](./standard-deployment.md)，不要在运行中的 PGlite 目录上直接复制文件。备份和恢复必须先停止 `small` 容器，再按[备份与恢复](../manual/backup-and-restore.md)处理卷。
