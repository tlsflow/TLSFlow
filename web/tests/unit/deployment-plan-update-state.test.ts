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
})
