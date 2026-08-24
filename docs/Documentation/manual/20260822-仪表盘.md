---
title: 仪表盘
description: 查看 TLSFlow v1.0.0 证书、资产、执行和审计概况
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - web/src/views/dashboard/DashboardView.vue
  - backend/src/modules/dashboard
testRefs: []
lastVerified: 2026-08-22
---

# 仪表盘

进入“仪表盘”后，页面会加载当前租户的资源概况、风险状态、近期执行和审计摘要。时间显示按浏览器本地时区格式化。

## 日常查看顺序

1. 先看资源卡片，确认应用资产、证书版本和可用目标数量是否符合预期。
2. 再看风险和状态热力图，点击异常项进入对应详情。
3. 查看近期执行和审计摘要；失败任务进入“证书部署 → 执行记录”继续排查。
4. 页面数据过期时使用刷新操作；刷新只重新读取数据，不会触发部署。

仪表盘中的聚合数字受当前账号权限和租户范围限制。看不到某个资源不等于资源不存在，先检查角色和当前租户。
