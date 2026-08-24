---
title: Agent
description: 接入、检查和升级 TLSFlow Agent 受管主机
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/005-受管与非受管设备管理
codeRefs:
  - web/src/views/devices/DevicesView.vue
  - backend/src/modules/agents
  - backend/src/modules/devices
testRefs: []
lastVerified: 2026-08-22
---

# Agent

Agent 是安装在目标主机上的管理程序。它负责保持在线、上报主机能力，并按平台下发的任务执行发现和证书操作。

## 接入主机

1. 打开“资产中心 → 设备”，点击“新增”。
2. 选择目标主机的操作系统和 Agent 接入方式。
3. 按向导生成安装或注册材料，在目标主机完成安装。
4. 回到设备页面等待状态显示“在线”，并确认最近心跳时间持续更新。
5. 点击“发现”，检查运行框架、站点、证书位置和能力版本。
6. 在应用资产向导中选择兼容目标，先完成预检再部署。

> 【截图占位：设备新增向导中的 Agent 平台选择和安装材料步骤】
>
> 【截图占位：Agent 设备详情，标出在线状态、最近心跳、发现和版本信息】

## 升级 Agent

1. 在设备列表找到带有升级提示的 Agent，点击“升级”。
2. 核对当前版本和目标版本，确认升级时间不会影响业务。
3. 提交升级并等待状态回到在线；升级期间不要重复点击或删除设备。
4. 升级完成后重新运行发现，确认框架和证书位置仍可读取。

平台只提供已发布且经过校验的升级版本，不会因为出现提示就自动升级。

## 离线或材料泄露时

- Agent 离线时，平台无法确认远端任务是否执行完成。先在主机检查服务状态和网络，再查看设备详情。
- 注册信息或升级材料泄露时，立即停用旧 Agent、重新生成材料并注册。
- Gateway 是独立的转发角色，不能把 Gateway 的安装信息当作 Agent 使用。
