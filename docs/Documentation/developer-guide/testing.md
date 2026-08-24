---
title: 测试与验证
description: GCAC 文档、后端和前端变更的验证策略
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/010-官方文档库与多语言文档治理
codeRefs:
  - backend
  - web
  - docs/Documentation/scripts
testRefs: []
lastVerified: 2026-08-19
---

# 测试与验证

## 代码变更

根据风险选择单元、集成、组件、端到端和真实环境验收。涉及迁移、插件、工作流、部署计划或跨模块合同时，不能只跑一个局部单元测试。

### 插件测试归属

插件测试按责任分层：

- 插件自身的 Manifest、资源、Runtime、Action、产品协议和 Fixture 测试，放在内置插件包的 `tests/` 或现有 Runtime 相邻测试目录。
- 宿主的导入、Registry、Policy、权限、租户隔离、Host API、Runner 和执行控制面测试，放在 `backend/src/modules/plugins` 的宿主模块目录。
- 多插件共享的协议和故障矩阵测试，放在 `compatibility/fixtures/<family>/` 或显式测试批次中。
- 用户插件的产品测试由插件自己的源码仓库维护；宿主只执行统一包契约和隔离运行边界测试，禁止执行用户包自带的任意测试代码。

按需测试不是跳过共享边界：只改一个插件时运行该插件测试、通用包契约和受影响 Runner 测试；修改宿主 Schema、权限、Registry、Host API、Runner 或共享执行链时，必须补跑宿主安全测试和受影响插件批次；发布或共享基础设施变更运行完整 P1/P2。测试结果绑定插件版本和包/Manifest/资源摘要。

后端当前提供 `test:p1`、`test:p2` 和 `test:full` 三类编排；需要局部验证时可以直接指定编译后的测试文件或使用 P2 插件批次，但交付记录必须写明实际覆盖范围和未运行的全量门禁。

## 文档变更

文档变更至少执行：

```text
npm run docs:check
npm run docs:build
```

还要检查来源路径、语言状态、敏感信息和页面是否把 `in_review`/`todo` 写成完成。

真实协议、生产迁移、外部厂商部署和浏览器视觉回归没有证据时，保持 `TODO`。
