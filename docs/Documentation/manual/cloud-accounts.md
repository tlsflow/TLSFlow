---
title: 云账号
description: 管理云服务连接并运行云资产发现
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - web/src/views/providers/CloudProvidersView.vue
  - backend/src/modules/providers
testRefs: []
lastVerified: 2026-08-22
---

# 云账号

云账号是云服务的连接档案，不等同于证书资产或设备。

1. 进入“资产中心 → 云账号”，点击“新增”。
2. 选择提供商，填写账号标识、区域和凭据引用；敏感字段使用“系统设置 → 凭据”中已保存的 Secret。
3. 保存后执行“连接测试”，确认返回成功。
4. 需要同步云资源时执行发现，查看发现到的服务资产并选择要纳入管理的对象。

连接测试只验证平台当前实现的提供商协议。云账号可用于云服务连接和发现；证书部署仍需要应用资产和对应的工作流能力。

云账号的 Secret 只以凭据引用进入连接测试或工作流。连接测试超时只能说明状态未知，先到提供商侧核对请求，再决定是否重试；不要在页面普通字段或日志中粘贴访问密钥。
