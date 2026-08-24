import { describe, expect, it } from 'vitest'
import type { ApiRecord } from '@/api/modules/common'
import { enrichDeploymentPlanRecord } from '@/views/deployments/deployment-plan-update-state'

describe('deployment-plan-update-state', () => {
  const versions: ApiRecord[] = [
    {
      id: 'certver_old',
      certificateAssetId: 'cert_asset_1',
      notAfter: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
      deployable: true,
      fingerprintSha256: 'a'.repeat(64),
    },
    {
      id: 'certver_latest',
      certificateAssetId: 'cert_asset_1',
      notAfter: '2100-01-01T00:00:00.000Z',
      createdAt: '2026-02-01T00:00:00.000Z',
      status: 'active',
      deployable: true,
      fingerprintSha256: 'b'.repeat(64),
    },
  ]
  const plan: ApiRecord = {
    id: 'plan_1',
    certificateVersionId: 'certver_old',
    selectionMode: 'LATEST_AUTO',
    targets: [
      {
        applicationAssetId: 'app_asset_1',
        certificateBindingId: 'binding_1',
      },
    ],
  }
  const assets: ApiRecord[] = [{ id: 'app_asset_1' }]

  it('执行后快照已经指向最新证书时，不再显示需更新', () => {
    const enriched = enrichDeploymentPlanRecord(plan, versions, assets, new Map([
      ['app_asset_1', {
        targetBindingDetail: {
          certificateBindings: [
            {
              id: 'binding_1',
              certificateVersionId: 'certver_old',
              observedFingerprintSha256: 'a'.repeat(64),
            },
          ],
        },
        targetSnapshots: [
          {
            id: 'snapshot_after_deploy',
            certificateBindingId: 'binding_1',
            certificateVersionId: 'certver_latest',
            fingerprintSha256: 'b'.repeat(64),
            capturedAt: '2026-07-07T10:00:00.000Z',
            metadata: {
              detail: {
                verify: {
                  notAfter: '2100-01-01T00:00:00.000Z',
                  remoteCertificateSha256: 'b'.repeat(64),
                },
              },
            },
          },
        ],
      }],
    ]))

    expect(enriched.updateNeeded).toBe('UP_TO_DATE')
    expect(enriched.needsUpdate).toBe(false)
    expect(enriched.currentAssetCertificateVersionId).toBe('certver_latest')
  })

  it('没有执行后观测数据时，旧绑定版本仍会显示需更新', () => {
    const enriched = enrichDeploymentPlanRecord(plan, versions, assets, new Map([
      ['app_asset_1', {
        targetBindingDetail: {
          certificateBindings: [
            {
              id: 'binding_1',
              certificateVersionId: 'certver_old',
              observedFingerprintSha256: 'a'.repeat(64),
            },
          ],
        },
        targetSnapshots: [],
      }],
    ]))

    expect(enriched.updateNeeded).toBe('UPDATE_REQUIRED')
    expect(enriched.needsUpdate).toBe(true)
    expect(enriched.currentAssetCertificateVersionId).toBe('certver_old')
  })

  it('工作流资产优先使用监控实测证书到期时间判断是否需要更新', () => {
    const workflowPlan: ApiRecord = {
      id: 'plan_workflow_1',
      certificateVersionId: 'certver_old',
      selectionMode: 'LATEST_AUTO',
      targets: [
        {
          applicationAssetId: 'app_asset_1',
        },
      ],
    }
    const observations = new Map<string, ApiRecord>([
      ['app_asset_1', {
        serviceAssetId: 'app_asset_1',
        fingerprintSha256: 'b'.repeat(64),
        notAfter: '2100-01-01T00:00:00.000Z',
        observedAt: '2026-07-07T10:00:00.000Z',
      }],
    ])

    const enriched = enrichDeploymentPlanRecord(workflowPlan, versions, assets, new Map(), observations)

    expect(enriched.updateNeeded).toBe('UP_TO_DATE')
    expect(enriched.needsUpdate).toBe(false)
    expect(enriched.currentAssetCertificateNotAfter).toBe('2100-01-01T00:00:00.000Z')
  })

  it('工作流旧计划可以从 strategyPayload 解析应用资产并读取实测状态', () => {
    const workflowPlan: ApiRecord = {
      id: 'plan_workflow_legacy',
      certificateVersionId: 'certver_old',
      selectionMode: 'LATEST_AUTO',
      targets: [
        {
          executionTargetId: 'workflow_runner_target',
          strategyPayload: {
            workflowRequest: {
              applicationAssetId: 'app_asset_1',
            },
          },
        },
      ],
    }
    const observations = new Map<string, ApiRecord>([
      ['app_asset_1', {
        serviceAssetId: 'app_asset_1',
        fingerprintSha256: 'b'.repeat(64),
        notAfter: '2100-01-01T00:00:00.000Z',
        observedAt: '2026-07-07T10:00:00.000Z',
      }],
    ])

    const enriched = enrichDeploymentPlanRecord(workflowPlan, versions, assets, new Map(), observations)

    expect(enriched.updateNeeded).toBe('UP_TO_DATE')
    expect(enriched.currentAssetCertificateNotAfter).toBe('2100-01-01T00:00:00.000Z')
  })
})
