---
title: 开发文档
description: TLSFlow v1.0.0 插件和工作流扩展开发入口
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - backend/src/modules/plugins
  - backend/src/modules/workflow-templates
  - backend/src/modules/agents/security
  - backend/src/modules/application-onboarding
  - backend/src/modules/browser-runtime
testRefs:
  - backend/src/modules/plugins/plugins-openapi.contract.test.ts
  - backend/src/modules/plugins/plugin-workflow-publisher.test.ts
  - backend/src/modules/application-onboarding/controller/application-onboarding.controller.test.ts
  - backend/src/modules/browser-runtime/browser-credential-session.service.test.ts
  - backend/src/modules/agents/security/agent-security.contract.test.ts
  - backend/src/modules/executions/workflow-executor-adapter.test.ts
lastVerified: 2026-08-24
---

# 开发文档

开发文档只描述 v1.0.0 已实现的宿主边界。它不是内部 Spec、测试夹具或未完成能力清单。先看[宿主插件能力清单](./host-plugin-capabilities.md)了解全部能力和合同，再按[插件开发](./plugin-development.md)完成交付；需要一个完整设备和证书部署案例时看[插件示例](./plugin-example-nginx-proxy-manager.md)，工作流模板开发看[工作流开发规范](./workflow-development.md)。

开发测试必须使用脱敏数据和独立租户；真实目标验收、外部 CA 行为和生产发布仍需在对应环境单独完成。

## 三条开发边界

- 插件只通过 Manifest、Host API 和 Grant 使用宿主能力；租户、权限、Secret、Artifact、审计、锁、快照和回滚由宿主负责。
- 宿主能力以[宿主插件能力清单](./host-plugin-capabilities.md)为唯一开发入口；没有列出的接口、权限或步骤都不能作为插件合同使用。
- 工作流只使用 `gcac.workflow/v1` 和 `CurlSshWorkflow`；模板来源只有内置目录与 `data/workflows`，每次发布都固定具体版本和输入快照。
- 证书部署的最终成功条件是目标回读验证，不是本地上传成功；没有外部厂商或现场证据的能力不会写成兼容承诺。

## 合同导航

- [宿主插件能力清单](./host-plugin-capabilities.md)：Manifest、能力注册表、USER/BUILTIN/Agent Plan 权限门禁、Runner Host API、`credential.acquire`、Onboarding、Full Agent 事实和 Agent 安全合同。
- [插件开发](./plugin-development.md)：插件包目录、Manifest、Workflow/Agent Plan 选择、按能力类型的测试矩阵和版本升级。
- [工作流开发规范](./workflow-development.md)：完整 Step 类型、Browser/Plugin Action、TLS ExecutionGrant、DeploymentInput/Artifact 和机器 Schema 索引。
- [插件示例](./plugin-example-nginx-proxy-manager.md)：Nginx Proxy Manager 的真实代码边界与验证状态。

后端请求必须沿“Controller → Application Service → Domain Service → Repository”链路，并携带租户、操作者和请求 ID；前端用户文案、ARIA（无障碍标签）和时间展示遵循项目既有国际化、语义主题变量和浏览器本地时区规范。这些是宿主工程边界，不是插件可以绕过的接口。
