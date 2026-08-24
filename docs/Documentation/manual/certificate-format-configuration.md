---
title: 证书格式配置
description: 配置证书部署所需的输出格式和密钥材料
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/003-证书资产与CA生命周期管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - web/src/views/bindings/BindingsView.vue
  - backend/src/modules/bindings
testRefs: []
lastVerified: 2026-08-22
---

# 证书格式配置

格式配置决定部署时如何生成 Artifact（可部署制品），例如 PEM、PFX/P12、JKS 或 P7B/P7C。它不是证书本身，也不会单独触发部署。

1. 进入“证书管理 → 证书格式配置”，点击“新建”。
2. 选择系统平台和运行平台，按模板填写配置名称、文件后缀、密码来源和链顺序。
3. 需要密码时选择凭据或 Secret 引用，不要把密码直接写入工作流变量。
4. 保存后在列表确认格式状态；应用资产或工作流选择该格式后才会生成对应制品。

编辑会影响后续计划，历史执行仍使用其输入快照。删除前确认没有活动绑定；平台会阻止正在使用的格式被误删。

输出格式的边界如下：PEM 由叶子证书、私钥和有序链组成；PFX/P12 还需要密码和 alias；JKS 需要密码和 alias；P7B/P7C/SPC 只携带证书链，不能替代私钥。密码只能来自 Secret/Credential 引用，平台会在制品写入前回读校验，错误密码不会生成可部署制品。
