---
title: 日志审计
description: 查询 TLSFlow v1.0.0 的用户操作、权限和任务审计记录
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
codeRefs:
  - web/src/views/audit/AuditsView.vue
  - backend/src/modules/audits
testRefs: []
lastVerified: 2026-08-22
---

# 日志审计

进入“日志审计”后按时间、操作者、资源类型、动作、结果和请求 ID 筛选。打开记录可查看租户、资源标识、成功/失败原因和关联任务。

审计记录中的凭据、Secret、私钥和令牌只显示脱敏值。审计是追加记录，页面不提供编辑或删除入口。排查部署问题时，把执行记录中的计划 ID 与审计记录的请求 ID 对照，不要只根据容器日志下结论。

建议至少核对四类事件：登录和会话、角色/租户变更、插件导入/启停、部署计划与回滚。审计记录属于当前租户范围，审计员可以查看但不因此获得凭据读取或部署执行权限。
