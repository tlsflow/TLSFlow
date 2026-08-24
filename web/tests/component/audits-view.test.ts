import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AuditsView from '@/views/audit/AuditsView.vue'
import { usePermissionStore } from '@/stores/permission.store'

const apiMocks = vi.hoisted(() => ({
  listAudits: vi.fn(),
  exportAuditEvidence: vi.fn(),
}))

vi.mock('@/api/modules/audits.api', () => ({
  listAudits: apiMocks.listAudits,
  exportAuditEvidence: apiMocks.exportAuditEvidence,
}))

describe('AuditsView', () => {
  beforeEach(() => {
    apiMocks.listAudits.mockReset()
    apiMocks.exportAuditEvidence.mockReset()
    setActivePinia(createPinia())
    usePermissionStore().setPermissions(['audit.read', 'audit.export'])
  })

  it('审计列表展示中文摘要并隐藏原始事件、风险和明细', async () => {
    apiMocks.listAudits.mockResolvedValue({
      data: {
        items: [
          {
            id: 'aud-1',
            eventType: 'deployment.executed',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'execution.apply.enqueue',
            resourceType: 'executionRun',
            resourceId: 'run_1',
            result: 'success',
            riskLevel: 'high',
            requestId: 'req_001',
            createdAt: '2026-07-06T08:34:00.000Z',
            summary: '用户 user_admin完成“执行部署”，部署计划：生产 NGINX 证书更新，资产：生产 API 网关。',
            detail: {
              deploymentPlanId: 'pln_1',
              jobId: 'job_1',
              stepCount: 4,
              secretRef: 'secret://password/sec-prod-db-password/1',
            },
          },
        ],
        page: 1,
        pageSize: 50,
        total: 1,
      },
      requestId: 'req_audits',
      timestamp: '2026-07-06T08:34:00.000Z',
    })

    const wrapper = mount(AuditsView)

    await vi.waitFor(() => expect(wrapper.text()).toContain('执行部署'))
    const auditList = wrapper.find('.audit-list__items')
    const auditText = auditList.text()
    expect(auditText).toContain('成功')
    expect(auditText).toContain('部署')
    expect(auditText).toContain('部署计划：生产 NGINX 证书更新')
    expect(auditText).toContain('资产：生产 API 网关')
    expect(auditText).not.toContain('deployment.executed')
    expect(auditText).not.toContain('高风险')
    expect(auditText).not.toContain('pln_1')
    expect(auditText).not.toContain('job_1')
    expect(auditText).not.toContain('secret://password/sec-prod-db-password/1')
  })

  it('审计列表按创建时间从新到旧展示', async () => {
    apiMocks.listAudits.mockResolvedValue({
      data: {
        items: [
          {
            id: 'old',
            eventType: 'auth.login.success',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'auth.login',
            resourceType: 'authSession',
            result: 'success',
            createdAt: '2026-06-18T01:27:00.000Z',
          },
          {
            id: 'new',
            eventType: 'secret.created',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'secret.create',
            resourceType: 'secret',
            result: 'success',
            createdAt: '2026-06-18T03:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 50,
        total: 2,
      },
      requestId: 'req_audits',
      timestamp: '2026-07-06T08:34:00.000Z',
    })

    const wrapper = mount(AuditsView)

    await vi.waitFor(() => expect(wrapper.findAll('.audit-list__items li')).toHaveLength(2))
    const items = wrapper.findAll('.audit-list__items li').map((item) => item.text())
    expect(items[0]).toContain('创建 Secret')
    expect(items[1]).toContain('用户登录')
  })
})
