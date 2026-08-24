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

CA（证书颁发机构）页面按树状关系展示 CA、请求、证书和账户等对象。

1. 进入“证书管理 → CA 操作”，点击刷新加载 CA 树。
2. 选择一个 CA 或对象类型，使用搜索条件查看记录。
3. 需要同步时选择 CA、对象类型和同步模式，再点击“开始同步”。
4. 在同步记录中查看排队、执行、成功或失败状态。

页面提供“管理内部 CA”入口。内部 CA 的高风险写操作需要确认密钥和相应权限；同步失败不等于外部 CA 数据丢失，先查看失败原因和审计记录。

停用或退休 CA 前，先在证书资产的使用关系中确认没有仍在部署的证书版本。高风险操作必须配置 `GCAC_CA_CONFIRMATION_SECRET`，并由后端执行权限和审计检查；缺少确认密钥时操作会失败关闭。
