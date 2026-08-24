---
title: CA 操作
description: 查看 CA 层级、同步对象和内部 CA 管理入口
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/003-证书资产与CA生命周期管理
codeRefs:
  - web/src/views/ca-operations/CaOperationsView.vue
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-08-22
---

# CA 操作

CA（证书颁发机构）页面用于查看证书签发来源、同步 CA 中的对象，并进入内部 CA 管理入口。页面左侧是 CA 树，右侧是对象列表和同步状态。

1. 进入“证书管理 → CA 操作”，点击“刷新”加载 CA 树。
2. 在左侧选择 CA，在右侧切换“请求、签发、吊销、模板”等对象类型。
3. 使用搜索框按名称、编号或状态筛选记录，点击“查询”。
4. 需要更新数据时点击“同步”，选择对象范围和同步模式后确认。
5. 在同步记录中查看“排队、执行、成功、失败”状态，失败时打开详情查看原因。

> 【截图占位：CA 操作页面，显示左侧 CA 树、对象类型切换和查询区域】
>
> 【截图占位：同步确认窗口，显示同步范围和同步模式】

点击“管理内部 CA”可以进入内部 CA 管理窗口。涉及签发、吊销或密钥变更的操作会要求再次确认；同步失败只表示本次更新未完成，不代表 CA 中的数据被删除。

停用或退休 CA 前，请到“证书资产”查看使用关系，确认没有正在部署或等待续签的证书。高风险操作缺少确认信息时会被系统拒绝。

> 【截图占位：同步记录详情，显示开始时间、对象范围、状态和失败原因】
