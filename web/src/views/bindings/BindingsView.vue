<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { listBindings, verifyBinding } from '@/api/modules/bindings.api'

const config: BusinessPageConfig = {
  title: '证书绑定',
  description: '域名、端口、服务、本地证书路径、远端 TLS 指纹和漂移状态。',
  readPermission: 'binding.read',
  primaryPermission: 'binding.write',
  primaryActionLabel: '新增绑定',
  moduleName: 'bindings',
  resourceName: '绑定',
  defaultStatus: 'DRIFTED',
  defaultRisk: 'HIGH',
  columns: [
    { key: 'name', title: '域名/绑定', candidates: ['domainName', 'name', 'bindingName'] },
    { key: 'status', title: '漂移状态', candidates: ['driftStatus', 'status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'port', title: '端口', candidates: ['port', 'endpoint.port'] },
    { key: 'fingerprint', title: '远端指纹', candidates: ['observedFingerprintSha256', 'remoteFingerprint', 'fingerprint'] }
  ],
  metrics: [
    { title: '绑定总数', description: '证书版本、服务实例和端口之间的实际关系。', status: 'MANAGED', risk: 'MEDIUM' },
    { title: '高危待处理', description: '本地配置和远端观测不一致的绑定。', status: 'DRIFTED', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '绑定 ID', candidates: ['id', 'bindingId'] },
    { label: '证书 ID', candidates: ['certificateId', 'certificate.id'] },
    { label: '资产 ID', candidates: ['hostId', 'assetId', 'host.id'] },
    { label: '服务实例', candidates: ['serviceInstanceId', 'service.id', 'serviceName'] },
    { label: '端点', candidates: ['endpoint', 'endpoint.host', 'domainName'] },
    { label: '远端指纹', candidates: ['observedFingerprintSha256', 'remoteFingerprint', 'fingerprint'] },
    { label: '最后验证', candidates: ['lastVerifiedAt', 'updatedAt'] }
  ],
  contextLinks: [
    { label: '查看证书', to: '/certificates', queryKey: 'certificateId', candidates: ['certificateId', 'certificate.id'] },
    { label: '查看资产', to: '/assets', queryKey: 'hostId', candidates: ['hostId', 'assetId', 'host.id'] },
    { label: '查看部署计划', to: '/deployment-plans', queryKey: 'bindingId', candidates: ['id', 'bindingId'] }
  ],
  emptyTitle: '暂无证书绑定',
  emptyDescription: '没有绑定就无法回答“证书在哪里使用”。先发现服务或手工登记绑定。',
  load: () => listBindings({ page: 1, pageSize: 20, sort: 'lastVerifiedAt:desc' }),
  actions: [
    { label: '重新验证绑定', permission: 'binding.write', danger: true, confirmText: 'VERIFY', riskText: '验证会访问目标 TLS 端口，请确认不会触发安全设备误报。', requiresSelection: true, run: (row) => verifyBinding(row?.id ?? '', { dryRun: true }) }
  ]
}
</script>

<template><BusinessResourcePage :config="config" /></template>
