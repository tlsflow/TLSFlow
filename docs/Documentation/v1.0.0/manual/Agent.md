---
title: Agent
description: 接入、检查和升级 TLSFlow Agent 受管主机
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - web/src/views/assets/AssetsView.vue
  - backend/src/modules/agents
  - backend/src/modules/devices
testRefs: []
lastVerified: 2026-08-22
---

# Agent

Agent 是安装在目标主机上的管理程序。接入后，平台可以读取主机能力、发现站点和证书位置，并在授权范围内执行证书任务。Agent 不会自动修改业务配置；所有变更都要从平台创建并执行任务。

## 接入一台主机

1. 打开“资产中心”，点击“添加资产”。
2. 选择目标主机的操作系统和 Agent 接入方式，填写名称和页面要求的信息。
3. 生成安装或注册材料，在目标主机完成安装并启动 Agent 服务。
4. 回到资产中心，等待状态变为“在线”，确认最近心跳时间持续更新。
5. 点击“发现”，检查平台识别出的系统、站点、证书位置和能力版本。
6. 创建应用资产时选择兼容目标，检查页面提示后提交部署。

## 升级 Agent

1. 在资产列表找到带有升级提示的 Agent，点击“升级 Agent”。
2. 核对当前版本和目标版本，确认升级时间不会影响业务。
3. 提交升级并等待状态回到在线；升级期间不要重复点击或删除设备。
4. 升级完成后重新运行发现，确认框架和证书位置仍可读取。

平台只提供已发布且经过校验的升级版本，不会因为出现提示就自动升级。

## 离线或材料泄露时

- Agent 离线时，平台无法确认远端任务是否执行完成。先在主机检查 Agent 服务和网络，再查看资产详情。
- 注册信息或升级材料泄露时，立即停用旧 Agent、重新生成材料并重新注册。
- Gateway 是独立的转发节点，不能使用 Gateway 安装材料注册 Agent。
