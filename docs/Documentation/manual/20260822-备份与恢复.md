---
title: 备份与恢复
description: 备份 TLSFlow 数据卷、工作流和用户插件并执行恢复演练
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/compose.yml
  - backend/src/database/migration-runner.ts
testRefs: []
lastVerified: 2026-08-22
---

# 备份与恢复

v1.0.0 没有平台级备份/恢复按钮，备份由运维系统负责。标准版备份 PostgreSQL 数据、工作流卷和 `data/plugins`；单机版备份 `gcac_small_pglite`、`gcac_small_workflows`。数据库可使用 `pg_dump`/`pg_restore`，但不要在容器运行时覆盖 PGlite 目录。

恢复顺序：停止 Backend/Web → 保留原卷 → 恢复数据库或 PGlite → 恢复工作流和插件目录 → 用同一版本和同一密钥启动 → 检查迁移、租户、许可证、插件和只读发现 → 再恢复写操作。

`GCAC_SECRET_KEK`、数据库密码和许可证签名材料必须单独保密备份。密钥丢失时不能靠重新设置环境变量恢复历史 Secret 明文。备份完成不等于可恢复，至少在隔离环境做一次读取、启动、发现和测试部署演练。

SSH 工作流若声明了 `BackupManifest`（远端备份清单），可以在目标写入前保存旧文件并在失败时按清单恢复；这只覆盖声明的目标文件，不等于平台数据库灾备。回滚失败必须同时保留原始失败、回滚结果和远端路径证据。
