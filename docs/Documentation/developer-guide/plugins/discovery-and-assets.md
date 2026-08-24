---
title: 发现、资产字段与证书位置
description: 插件标准发现、asset 来源和证书位置规则
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/006.2-受管目标上下文与应用执行配置管理
codeRefs:
  - backend/src/modules/plugins/discovery
  - backend/src/modules/deployment-inputs
testRefs: []
lastVerified: 2026-08-02
---

# 发现、资产字段与证书位置

插件通过标准发现输出 Framework、Site、ManagedTarget 和 Certificate。稳定键由插件资源声明，宿主负责投影、冲突和过期处理。

证书路径、KeyStore、服务名和程序路径等发现事实使用 `source.kind=asset`，并优先于插件默认值。默认路径只能为未发现目标提供兼容兜底。

发现可以对单个子对象继续并暴露 Warning；部署、变更和回滚必须失败关闭。`configFingerprint` 当前已进入输入快照，但执行前复核仍是待完成门禁。
