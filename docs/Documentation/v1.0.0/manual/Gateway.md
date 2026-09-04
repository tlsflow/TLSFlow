---
title: Gateway
description: 管理 Gateway 网络转发节点并查看其状态
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/views/gateways/GatewaysView.vue
  - backend/src/modules/gateways
testRefs: []
lastVerified: 2026-08-22
---

# Gateway

Gateway 是部署在隔离网络中的转发节点。当控制平面无法直接连接目标设备时，Gateway 负责转发连接。它不安装证书，也不能替代目标主机上的 Agent。

## 安装 Gateway

1. 进入“资产中心 → Gateway”，点击“添加 Gateway Agent”。
2. 选择运行平台（Linux 或 Windows）。
3. 填写服务区域；如需限制转发范围，填写允许访问的目标地址和端口。
4. 点击“生成安装材料”，按弹窗中的说明在目标主机完成安装。
5. 安装完成后回到列表，等待状态变为“在线”，确认最近心跳时间正常。


## 查看状态并用于连接

1. 点击 Gateway 名称打开详情，查看连接状态、所在区域、当前任务数、可用容量、成功率和最近联系时间。
2. 在设备或应用连接配置中选择这个 Gateway 作为转发节点。
3. 先运行连接测试，再执行发现；确认目标可达后再创建应用资产或提交部署。
4. 可从详情快捷进入关联的应用资产和执行记录。

Gateway 离线时，依赖它的连接、发现和部署可能失败或等待。先恢复 Gateway，再确认目标设备状态并重试。当前版本不提供自动故障转移或集群能力。
