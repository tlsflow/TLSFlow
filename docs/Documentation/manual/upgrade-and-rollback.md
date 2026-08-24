---
title: 升级与回滚
description: 升级 TLSFlow v1.0.0 镜像、Agent 和证书部署计划
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - docker/compose.yml
  - docker/20260806-公开仓库与私有发布仓库说明.md
  - backend/src/modules/agents
  - backend/src/modules/executions
testRefs: []
lastVerified: 2026-08-22
---

# 升级与回滚

平台升级、Agent 升级和证书部署回滚是三件不同的事。

## 平台升级

1. 备份数据库/数据卷、工作流、用户插件和密钥材料。
2. 按目标版本构建镜像，版本标签取根目录 `version`。
3. 维护窗口先启动数据库和 Backend，确认迁移完成，再启动 Web 和 Browser Runtime。
4. 登录检查许可证、插件市场和只读发现，最后在测试目标上执行 Dry Run。

迁移失败时保留容器日志和原卷，不修改历史迁移文件，也不要让旧版本直接写入未知的新数据库结构。

## 回滚

v1.0.0 没有通用的平台回滚按钮。发布回退需要停止新版本、保留证据、按备份恢复兼容的数据卷，再用匹配旧镜像启动。证书部署回滚只能在计划声明了备份清单和回滚步骤时执行，并在回滚后重新验证服务/TLS。

Agent 升级是独立事务：设备详情中的“升级计划检查”只验证当前版本、目标 Release 和传输条件；发送升级事务后根据事务 ID 查看状态。代码可以记录 `rollbackVersion`，但能否自动回退取决于 Agent 发布物，不能理解为任意版本都可回滚。
