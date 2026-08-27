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
lastVerified: 2026-08-26
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

## 准备目录

在 NAS 的共享文件夹中创建持久化目录。下面以 `/volume1/docker/tlsflow/data`
为例；威联通、Unraid 只需替换为对应的宿主机路径：

```bash
DATA_ROOT=/volume1/docker/tlsflow/data
mkdir -p \
  "$DATA_ROOT/pglite" \
  "$DATA_ROOT/workflows" \
  "$DATA_ROOT/runtime" \
  "$DATA_ROOT/tls-inspector" \
  "$DATA_ROOT/plugins"
# 容器默认以 UID/GID 10001:10001 运行；NAS 允许时提前调整目录所有权。
chown -R 10001:10001 "$DATA_ROOT"
```

## 启动容器

下面命令只有两个必填应用密钥。small 使用镜像内置的 PGlite 默认配置，不需要
PostgreSQL 用户名、密码、主机或端口参数：

```bash
docker pull your-dockerhub-namespace/gcac-small:latest
docker run -d \
  --name tlsflow-small \
  --restart unless-stopped \
  --label com.gcac.deployment.architecture=small \
  -p 8085:3003 \
  -e GCAC_TOKEN_SECRET=TLSFlow-Token-K4r8-Np2z-2026 \
  -e GCAC_SECRET_KEK=TLSFlow-KEK-H7s3-Lx6v-2026 \
  -v "$DATA_ROOT/pglite:/var/lib/gcac/pglite" \
  -v "$DATA_ROOT/workflows:/app/data/workflows" \
  -v "$DATA_ROOT/runtime:/app/data/runtime" \
  -v "$DATA_ROOT/tls-inspector:/app/data/tls-inspector" \
  -v "$DATA_ROOT/plugins:/app/data/plugins:ro" \
  your-dockerhub-namespace/gcac-small:latest
```

将 `your-dockerhub-namespace` 替换为实际 Docker Hub 命名空间。

正式环境必须把两个示例密钥替换为随机且长期保持不变的密钥。升级时只替换
镜像标签，保留所有数据目录和密钥。默认地址为 `http://<主机地址>:8085/`；
端口冲突时只修改左侧宿主机端口，例如 `-p 8103:3003`。

`GCAC_CA_CONFIRMATION_SECRET`、`GCAC_INITIAL_ADMIN_PASSWORD` 等变量不是基础启动必填项，
确有需要时再追加 `-e 变量名=值`。small 的数据库参数不要手动覆盖，除非有明确的
运行时需求。

在群晖、威联通或 Unraid 图形界面中，按同样的容器名、端口、两个环境变量和五个
Bind Mount（绑定挂载）创建容器即可；`plugins` 目录设置为只读，其余四个目录必须
允许容器写入。镜像默认使用 UID/GID `10001:10001`，若 NAS 的共享文件夹启用严格
权限控制，应提前授予该 UID/GID 读写权限。

## 验证和限制

```bash
docker ps --filter name=tlsflow-small
docker logs --tail 200 tlsflow-small
```

确认迁移完成、登录可用后再导入测试证书。small 与 standard 不允许同时运行；
切换到标准版前先执行 `docker rm -f tlsflow-small`，再按[标准部署](./standard-deployment.md)
启动。不要在运行中的 PGlite 目录上直接复制文件。备份和恢复必须先停止容器，再按
[备份与恢复](../manual/backup-and-restore.md)处理 `data/` 目录。
