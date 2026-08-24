---
title: 数据库迁移
description: GCAC 数据库迁移和持久化开发约束
docStatus: implemented
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/001.2-数据库迁移与持久化治理
codeRefs:
  - backend/src/database
testRefs: []
lastVerified: 2026-08-02
---

# 数据库迁移

## 不可变历史

已经提交、共享或执行过的迁移文件是不可变历史。新增字段、索引、约束或数据修补必须新建递增版本迁移。

## Checksum 冲突

发现 `schema_migrations` checksum 不一致时，先判断是否有人修改了旧迁移。不能关闭 checksum 校验、删除校验逻辑或覆盖历史文件。

只有确认数据库实际结构与仓库迁移内容完全一致时，才允许一次性修正本地开发库的元数据；生产或共享环境必须先评估数据兼容性。
