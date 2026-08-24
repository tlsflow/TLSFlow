---
title: 凭据
description: 创建、轮换和安全使用 TLSFlow 凭据
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - web/src/views/settings/CredentialsView.vue
  - backend/src/modules/credentials
  - backend/src/modules/secrets
testRefs: []
lastVerified: 2026-08-22
---

# 凭据

进入“系统设置 → 凭据”，创建用户名密码、API Token（接口令牌）、私钥或浏览器会话凭据。平台只在加密 Secret 中保存敏感值，部署绑定保存的是凭据 ID 和版本引用。

1. 点击“新增凭据”，选择类型和作用域，填写非敏感名称与账号。
2. 在 Secret 区域录入密码、令牌或私钥，保存后确认状态为可用。
3. 在设备、云账号或工作流输入中选择该凭据，运行连接测试。
4. 轮换时编辑当前凭据并生成新版本；历史执行仍使用原快照。

凭据被应用资产或任务使用时不能直接删除。浏览器会话凭据只在临时地址有效，关闭或过期后需重新获取。

凭据轮换不会改写已经批准的部署计划：计划保存的是凭据版本和脱敏快照。遇到 `secret.resolve` 或权限错误，先检查凭据状态、租户和角色，再重新运行预检，不要把明文复制到工作流变量。
