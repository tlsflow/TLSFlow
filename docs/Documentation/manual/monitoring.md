---
title: 监控分析
description: 查看证书、目标、TLS、部署风险和通知投递
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - web/src/views/monitoring/MonitorsView.vue
  - backend/src/modules/monitors
  - backend/src/modules/notifications
  - backend/src/modules/reports
testRefs: []
lastVerified: 2026-08-22
---

# 监控分析

监控分析页面聚合证书到期、目标连接、TLS（传输层安全）和部署结果风险。探测结果是观察事实，不会自动修改证书或目标配置。

## 查看风险

1. 进入“监控分析”，按状态、目标或风险等级筛选。
2. 打开目标详情查看最近探测、证书信息、TLS 握手结果和历史变化。
3. 对已处理风险执行确认、抑制、忽略或重新打开；状态变更会写入审计。
4. 通知异常时转到“系统设置 → 通知”检查渠道和投递记录。

## 报表路由

当前代码提供事件窗口、风险响应、自动化效果三类报表路由，均要求 `report.read` 权限，但它们不在当前主菜单中，也没有由“监控分析”页面自动显示的菜单项。具备权限的用户可通过应用内已有链接或直接访问以下路径：

- `/reports/incident-window`
- `/reports/risk-response`
- `/reports/automation-effectiveness`

报表是当前租户范围的结果，不代表跨租户汇总。导出还需要 `report.export` 权限。

监控结果、通知投递和证书部署是三个独立事实：通知发送失败不会改变已经完成的部署；部署失败也不会自动把风险标记为已解决。监控风险可以确认、抑制、忽略、解决和重新打开，状态历史保留在审计中。通知渠道支持 Email、Webhook、企业微信、飞书、钉钉、Slack 和 Telegram，凭据只保存为 Secret/Credential 引用。

## TLS 深度监控

“监控分析”中的 TLS 深度入口读取独立的 TLS Inspector（TLS 深度检测服务）摘要；详情可以查看证书认证路径、协议与密码套件、客户端兼容性模拟和协议细节。路由 `/monitors/tls` 打开深度监控入口，`/monitors/tls/:id` 打开指定目标详情。摘要中的 `partial` 或 `unsupported` 表示采集范围受限，不应直接当作安全风险；排查时同时查看具体错误和快照。

兼容性模拟使用版本化客户端画像和已探测事实推导，不等于真实终端实测。当前部分信任视角可能返回 `unsupported`，这表示运行环境缺少对应信任根，不是证书已被判定为不可信。
