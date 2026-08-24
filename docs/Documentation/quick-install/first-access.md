---
title: 首次接入
description: GCAC 首次登录和设备接入的检查顺序
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
  - specs/005-受管与非受管设备管理
codeRefs:
  - backend/src/modules/security
  - backend/src/modules/agents
  - backend/src/modules/device-assets
testRefs: []
lastVerified: 2026-08-02
---

# 首次接入

## 接入前检查

- 已有可用租户和管理员身份。
- 管理员具备设备、插件、证书和部署相关权限。
- Agent 或无代理通道的网络出口已经明确。
- 凭据已保存到 Secret/Credential 管理，而不是写入普通变量。

## 接入后的检查

1. 确认设备或目标状态可查询。
2. 执行只读发现，确认 Framework、Site、ManagedTarget 和证书绑定投影。
3. 检查发现出来的证书位置是否来自资产事实，而不是插件默认路径。
4. 只有预检通过后，才创建部署计划。

页面状态：`in_review`。真实安装和外部系统联调尚未作为本页面的发布证据。
