import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import AuditsView from '@/views/audit/AuditsView.vue'
import { usePermissionStore } from '@/stores/permission.store'
import { i18n } from '@/i18n'

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
    i18n.global.locale.value = 'zh-CN'
  })

  it('当前语言为英文时使用英文生成审计摘要，而不是沿用后端固定文案', async () => {
    i18n.global.locale.value = 'en-US'
    apiMocks.listAudits.mockResolvedValue({
      data: {
        items: [{
          id: 'aud-en',
          eventType: 'deployment.executed',
          actorType: 'user',
          actorId: 'user_admin',
          action: 'execution.apply.enqueue',
          resourceType: 'executionRun',
          result: 'success',
          createdAt: '2026-08-25T12:00:00.000Z',
          presentation: {
            kind: 'deployment',
            params: {
              planName: 'Production NGINX renewal',
              targetNames: ['Production API gateway'],
              targetCount: 1,
              deploymentAction: 'execute',
            },
          },
          summary: '管理员完成“执行部署”。',
        }],
        page: 1,
        pageSize: 50,
        total: 1,
      },
    })

    const wrapper = mount(AuditsView)

    await vi.waitFor(() => expect(wrapper.find('.audit-list__items').text()).toContain('deployment plan: Production NGINX renewal'))
    expect(wrapper.text()).toContain('Administrator')
    expect(wrapper.text()).toContain('assets: Production API gateway')
    expect(wrapper.text()).not.toContain('管理员完成')
  })

  it('切换当前语言后即时更新已有审计摘要，不重新请求数据', async () => {
    apiMocks.listAudits.mockResolvedValue({
      data: {
        items: [{
          id: 'aud-switch',
          eventType: 'auth.login.success',
          actorType: 'user',
          actorId: 'user_admin',
          action: 'auth.login',
          resourceType: 'authSession',
          result: 'success',
          createdAt: '2026-08-25T12:00:00.000Z',
          presentation: { kind: 'authLoginSuccess', params: {} },
        }],
        page: 1,
        pageSize: 50,
        total: 1,
      },
    })

    const wrapper = mount(AuditsView)

    await vi.waitFor(() => expect(wrapper.text()).toContain('管理员登录成功'))
    i18n.global.locale.value = 'en-US'
    await nextTick()

    expect(wrapper.text()).toContain('Administrator signed in successfully.')
    expect(wrapper.text()).not.toContain('管理员登录成功')
    expect(apiMocks.listAudits).toHaveBeenCalledTimes(1)
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
            presentation: {
              kind: 'deployment',
              params: {
                planName: '生产 NGINX 证书更新',
                targetNames: ['生产 API 网关'],
                targetCount: 1,
                deploymentAction: 'execute',
              },
            },
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

  it('防御性隐藏 Secret 和默认权限拒绝，但保留权限阻断与其他失败', async () => {
    apiMocks.listAudits.mockResolvedValue({
      data: {
        items: [
          {
            id: 'secret-used',
            eventType: 'secret.used',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'secret.resolve.service',
            resourceType: 'secret',
            resourceId: 'sec_http',
            result: 'success',
            riskLevel: 'high',
            detail: { purpose: 'http.header' },
            createdAt: '2026-08-18T03:00:00.000Z',
          },
          {
            id: 'permission-default',
            eventType: 'permission.denied',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'task.read',
            resourceType: 'task',
            result: 'denied',
            detail: { reason: 'no allow policy' },
            createdAt: '2026-08-18T02:00:00.000Z',
          },
          {
            id: 'permission-explicit',
            eventType: 'permission.denied',
            actorType: 'user',
            actorId: 'user_admin',
            action: 'task.delete',
            resourceType: 'task',
            result: 'denied',
            detail: { reason: 'explicit deny' },
            createdAt: '2026-08-18T01:30:00.000Z',
          },
          {
            id: 'agent-observation-failed',
            eventType: 'agent.observation.failed',
            actorType: 'system',
            actorId: 'agent-observation',
            action: 'agent.observe',
            resourceType: 'agent',
            result: 'failure',
            createdAt: '2026-08-18T01:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 50,
        total: 4,
      },
      requestId: 'req_audits',
      timestamp: '2026-08-18T03:00:00.000Z',
    })

    const wrapper = mount(AuditsView)

    await vi.waitFor(() => expect(wrapper.findAll('.audit-list__items li')).toHaveLength(2))
    expect(wrapper.text()).not.toContain('服务读取 Secret')
    expect(wrapper.text()).not.toContain('HTTP 请求头凭据')
    expect(wrapper.text()).toContain('权限拒绝')
    expect(wrapper.text()).toContain('失败')
  })
})
