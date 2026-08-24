---
title: 自动化、设置与凭据
description: GCAC 自动化、系统设置和全局凭据操作
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - backend/src/modules/automations
  - backend/src/modules/credentials
  - backend/src/modules/notifications
testRefs: []
lastVerified: 2026-08-02
---

# 自动化、设置与凭据

## 自动化配置

1. 选择触发事件或周期。
2. 配置目标范围和最小执行权限。
3. 绑定工作流、通知或报表动作。
4. 先用只读或测试范围验证，再扩大目标。

## 凭据管理

全局凭据只保存稳定引用和版本信息。部署计划固定使用的凭据版本，不能因为当前凭据轮换而改变历史计划。

当前稳定基线没有独立通用系统配置模块，文档只描述已经存在的通知设置、凭据和管理入口。
