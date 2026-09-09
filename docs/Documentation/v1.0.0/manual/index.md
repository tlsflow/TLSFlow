---
title: 用户手册
description: 按 TLSFlow v1.0.0 控制台工作流组织的产品使用指南
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
  - web/src/views/dashboard/DashboardView.vue
  - web/src/views/application-onboarding/ApplicationOnboardingView.vue
  - backend/src/modules/application-onboarding/application/application-onboarding.service.ts
  - backend/src/modules/application-onboarding/application/onboarding-commit.service.ts
testRefs: []
lastVerified: 2026-09-04
---

# 用户手册

本手册帮助你使用 TLSFlow 完成证书和应用资产的日常管理。内容按实际工作流组织，不要求你一次读完；从当前任务对应的章节开始即可。

## 先了解三个核心概念

- **证书**：安装到网站或服务上的数字证书。TLSFlow 会保存证书材料，并按域名管理不同的证书版本。
- **资产**：TLSFlow 连接和管理的对象，例如设备、网络设备、网关或已发现的服务。首次更新时，资产是证书实际要安装到的资源来源。
- **应用**：需要使用证书的网站、API 或其他 TLS 服务。应用会记录访问域名、目标站点、所用证书以及更新方式。

完成首次更新只需要先准备证书，再把证书关联到应用。下面这些是日常管理中可能用到的进阶概念：

- **凭据**：平台加密保存、供连接和部署任务引用的密码、密钥或令牌。
- **工作流**：按步骤执行证书检查、备份、写入、验证和回滚的部署方案。
- **自动化**：按照证书产生新版本或预设时间，自动创建和执行更新任务的规则。
- **执行记录**：一次更新任务的实际过程和结果，包括提交、审批、执行和验证信息。
- **租户**：人员、资产、证书和应用相互隔离的工作空间。不同租户之间的数据和权限互不相通。

## 从零完成一次证书更新

首次部署不需要逐页配置底层对象，直接从仪表盘的“从这里快速开始”开始即可。最基本的证书更新配置只有两步：

1. **导入或创建证书**：导入已有证书材料，或在向导中使用已配置的 ACME 申请证书。确认新版本状态为可用，并核对域名、有效期和证书指纹。
2. **创建应用和更新计划**：点击“部署到网站或应用”，按向导选择业务平台、设备或服务、发现出的站点、访问域名以及证书版本。确认后，系统会创建应用；使用已有证书版本时还会自动创建一个待执行的更新计划。

应用和计划创建后，进入[证书部署](./certificate-deployment.md)，按页面提示提交并执行，再在[执行记录](./execution-records.md)确认结果。

如果向导中没有可选设备或站点，再按[资产中心](./asset-center.md)的说明接入资源并完成发现；不需要为了首次更新预先打开所有高级页面。

> **完成标准**：执行记录显示成功，并确认目标服务正在使用所选证书。

## 按任务查找文档

| 你要完成的任务 | 从这里开始 | 相关页面 |
| --- | --- | --- |
| 查看今天有哪些证书、资产或任务需要处理 | [仪表盘](./dashboard.md) | [仪表盘快速开始](./dashboard-quick-start.md) |
| 申请并导入产品授权 | [授权申请与导入](./license-request-and-import.md) | [许可证](./licenses.md)、[首次登录](../installation/first-login.md) |
| 接入主机、网络设备或云服务 | [资产中心](./asset-center.md) | [设备](./devices.md)、[Agent](./Agent.md)、[Gateway](./Gateway.md)、[云账号](./cloud-accounts.md)、[凭据](./credentials.md) |
| 导入证书并维护证书版本 | [证书管理](./certificate-management.md) | [证书资产](./certificate-assets.md)、[证书格式配置](./certificate-format-configuration.md)、[ACME 自动化](./acme-automation.md)、[CA 操作](./ca-operations.md) |
| 把证书部署到目标服务 | [证书部署](./certificate-deployment.md) | [工作流模板](./workflow-templates.md)、[执行记录](./execution-records.md)、[升级与回滚](./upgrade-and-rollback.md) |
| 重复执行或按条件执行更新 | [自动化](./automation.md) | [监控分析](./monitoring.md)、[通知](./notifications.md)、[报表](./reports.md) |
| 管理人员、权限和安全设置 | [系统设置](./system-settings.md) | [用户](./users.md)、[角色](./roles.md)、[租户与 RBAC](./tenant-and-rbac.md)、[安全注意事项](./security-considerations.md) |
| 备份、恢复或处理异常 | [备份与恢复](./backup-and-restore.md) | [故障排查](./troubleshooting.md)、[升级与回滚](./upgrade-and-rollback.md) |
| 管理插件和许可证 | [插件中心](./plugin-center.md) | [许可证](./licenses.md) |

遇到问题时，先记下租户、页面、时间、计划编号或运行编号，再按[故障排查](./troubleshooting.md)的证据顺序定位。
