<script setup lang="ts">
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'
import { importCertificate, listCertificates } from '@/api/modules/certificates.api'

const config: BusinessPageConfig = {
  title: '证书资产',
  description: '证书库、格式、来源、私钥引用、使用关系和到期风险入口。',
  readPermission: 'certificate.asset.read',
  primaryPermission: 'certificate.asset.write',
  primaryActionLabel: '导入证书',
  moduleName: 'certificates',
  resourceName: '证书',
  defaultStatus: 'MANAGED',
  defaultRisk: 'HIGH',
  columns: [
    { key: 'name', title: '主域名/名称', candidates: ['primaryDomain', 'name', 'commonName'] },
    { key: 'status', title: '状态', candidates: ['status', 'state'] },
    { key: 'risk', title: '风险', candidates: ['risk', 'riskLevel'] },
    { key: 'fingerprint', title: '指纹', candidates: ['fingerprintSha256', 'fingerprint', 'currentVersion.fingerprintSha256'] },
    { key: 'expiresAt', title: '到期时间', candidates: ['notAfter', 'expiresAt', 'currentVersion.notAfter'], kind: 'date' }
  ],
  metrics: [
    { title: '证书总数', description: '按域名、SAN、指纹和来源分页查询。', status: 'MANAGED', risk: 'MEDIUM' },
    { title: '高危待处理', description: '过期、私钥缺失或链异常证书。', status: 'EXPIRED', risk: 'HIGH' }
  ],
  detailFields: [
    { label: '证书 ID', candidates: ['id', 'certificateId'] },
    { label: '主域名', candidates: ['primaryDomain', 'commonName', 'name'] },
    { label: 'SAN', candidates: ['subjectAltNames', 'sans'] },
    { label: '指纹', candidates: ['fingerprintSha256', 'fingerprint', 'currentVersion.fingerprintSha256'] },
    { label: '私钥状态', candidates: ['hasPrivateKey', 'currentVersion.hasPrivateKey'] },
    { label: '到期时间', candidates: ['notAfter', 'expiresAt', 'currentVersion.notAfter'] }
  ],
  contextLinks: [
    { label: '查看绑定', to: '/bindings', queryKey: 'certificateId', candidates: ['id', 'certificateId'] },
    { label: '查看部署计划', to: '/deployment-plans', queryKey: 'certificateId', candidates: ['id', 'certificateId'] }
  ],
  emptyTitle: '暂无证书资产',
  emptyDescription: '请通过导入证书或配置证书来源接入数据；不要把私钥明文写进 URL 或日志。',
  load: () => listCertificates({ page: 1, pageSize: 20, sort: 'notAfter:asc' }),
  actions: [
    { label: '批量导入证书', permission: 'certificate.asset.write' },
    { label: '确认导入私钥材料', permission: 'certificate.asset.write', danger: true, confirmText: 'IMPORT', riskText: '导入可能涉及私钥材料，必须只提交 SecretRef 或受保护文件。', run: () => importCertificate({ dryRun: true }) }
  ]
}
</script>

<template><BusinessResourcePage :config="config" /></template>
