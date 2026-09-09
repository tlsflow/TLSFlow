---
title: CA 操作
description: 查看证书颁发机构的观测数据、对象同步和内部 CA 管理入口
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/views/ca-operations/CaOperationsView.vue
  - web/src/views/internal-ca/InternalCaView.vue
  - backend/src/modules/internal-ca
testRefs: []
lastVerified: 2026-09-04
---

# CA 操作

CA（Certificate Authority，证书颁发机构）页面用于查看已接入 CA 的状态和观测对象。它适合做运营核对和同步，不是日常证书部署入口。


## 查看 CA 对象

1. 打开“证书管理 → CA 操作”，选择目标 CA。
2. 点击“刷新”加载最新树和 Agent 观测摘要。
3. 在对象视图间切换，查看请求、已签发、已吊销或模板等记录。
4. 使用搜索框按主题、标识符或状态筛选，再点击“查询”。
5. 打开 CA 状态查看 Agent 在线状态、最近心跳、最近观测时间和记录统计。

页面上的时间按浏览器本地时间显示。Agent 离线或观测时间过旧时，列表中的对象可能不是 CA 的最新状态。

## 刷新和同步

选择 CA 后点击“刷新 Agent 并查询”可要求受管 Agent 重新观测并加载记录。根据 CA 类型和权限，按钮可能只执行查询而不触发 Agent。

同步或刷新失败只表示本次观测未完成，不会删除 CA 中已有对象。打开失败详情，先处理连接、权限或 Agent 状态，再重试。


## 管理内部 CA

点击“管理内部 CA”进入内部 CA 管理窗口。管理员可以维护信任域、证书机构、证书 Profile、证书申请和信任分发等对象；创建或退休 CA、签发/吊销证书以及密钥变更等高风险操作会要求预览和再次确认。

在退休 CA 或信任域前，先到“证书资产”和“ACME 自动化”检查证书使用关系、续签策略和运行中任务。系统会拒绝缺少确认信息或仍有活动引用的高风险操作。
