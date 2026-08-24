---
title: Gateway
description: 管理 Gateway 网络转发节点并查看其状态
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
codeRefs:
  - web/src/views/gateways/GatewaysView.vue
  - backend/src/modules/gateways
testRefs: []
lastVerified: 2026-08-22
---

# Gateway

Gateway 是部署在隔离网络中的转发节点。它帮助平台访问无法直接连通的设备，但不负责安装证书，也不能替代目标主机上的 Agent。

## 安装 Gateway

1. 进入“资产中心 → Gateway”，点击“新增 Gateway Agent”。
2. 选择运行平台（Linux 或 Windows）。
3. 填写服务区域；如需限制转发范围，再填写允许访问的目标地址和端口。
4. 点击“生成安装材料”，按弹窗中的说明在目标主机完成安装。
5. 安装完成后回到列表，等待状态变为在线，并确认最近心跳时间正常。

> 【截图占位：Gateway 安装材料弹窗，标出平台、区域、允许目标/端口和生成按钮】

## 查看状态并用于连接

1. 点击 Gateway 名称打开详情，查看连接状态、所在区域、当前任务数、可用容量、成功率和最近联系时间。
2. 在设备或应用连接配置中选择这个 Gateway 作为转发节点。
3. 先运行连接测试，再执行发现；确认目标可达后再创建应用资产或提交部署。
4. 可从详情快捷进入关联的应用资产和执行记录。

Gateway 离线时，依赖它的连接、发现和部署可能失败或等待。先恢复 Gateway，再确认目标设备状态并重试。当前版本未提供自动故障转移或集群能力。

> 【截图占位：Gateway 详情弹窗，标出在线状态、区域、负载、容量、成功率和最近心跳】
