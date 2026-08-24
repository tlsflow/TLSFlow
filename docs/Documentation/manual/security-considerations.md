---
title: 安全注意事项
description: TLSFlow v1.0.0 生产使用中的密钥、权限、网络和审计要求
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/002-统一安全管理与访问控制
codeRefs:
  - backend/src/modules/security
  - backend/src/modules/secrets
  - backend/src/modules/audits
  - docker/compose.yml
testRefs: []
lastVerified: 2026-08-22
---

# 安全注意事项

- 生产环境显式设置并托管 `GCAC_TOKEN_SECRET`、`GCAC_SECRET_KEK`、CA 确认密钥、数据库密码和 Browser Runtime 共享密钥，不写入 Git、镜像、截图或日志。
- 对用户、角色、凭据、插件、审批、执行和回滚分别授予最小权限；菜单可见性不是安全边界。
- 控制台通过 HTTPS 对外提供；Compose 不自动配置公网 TLS 证书，反向代理需由运维单独配置。
- Browser Runtime `8787` 只允许 Docker 内网访问，不要把 CDP、RFB 或调试端口映射到公网。
- 证书私钥、PFX/JKS 密码、SSH Key、API Token 和 Webhook 密钥只能通过 Credential/Secret 引用传递。
- 外部 Webhook、DNS Provider 和目标主机按租户网络策略限制；不要为了排障长期关闭 TLS 校验。
- 保留审计事件、执行快照和回滚清单；发生外部状态未知时先确认目标事实，再决定重试或补偿。

另外，标准版的 Web 端口（默认 `8085`）和 Backend 端口（默认 `3003`）职责不同；公网只应发布经过 HTTPS 保护的 Web。Browser Runtime 仅通过 Web 的 `/vnc/` 代理访问，任何直接暴露调试端口的做法都不属于 TLSFlow Compose 的安全配置。
