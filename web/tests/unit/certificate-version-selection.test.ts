import { describe, expect, it } from 'vitest'
import { selectLatestDeployableCertificateVersion, sortDeployableCertificateVersions } from '@/views/deployments/certificate-version-selection'

describe('certificate-version-selection', () => {
  it('只选择同一证书资产中后端标记可部署且未过期的版本', () => {
    const now = Date.parse('2026-07-29T00:00:00.000Z')
    const versions = [
      { id: 'wrong-asset', certificateAssetId: 'asset-2', status: 'active', deployable: true, notAfter: '2027-01-01T00:00:00.000Z' },
      { id: 'not-deployable', certificateAssetId: 'asset-1', status: 'active', deployable: false, notAfter: '2027-01-01T00:00:00.000Z' },
      { id: 'expired', certificateAssetId: 'asset-1', status: 'active', deployable: true, notAfter: '2026-07-28T00:00:00.000Z' },
      { id: 'latest', certificateAssetId: 'asset-1', status: 'active', deployable: true, notAfter: '2026-10-25T00:00:00.000Z' },
      { id: 'older', certificateAssetId: 'asset-1', status: 'active', deployable: true, notAfter: '2026-09-25T00:00:00.000Z' },
    ]

    expect(sortDeployableCertificateVersions(versions, now).map((item) => item.id)).toEqual(['wrong-asset', 'latest', 'older'])
    expect(selectLatestDeployableCertificateVersion(versions, 'asset-1', now)?.id).toBe('latest')
  })
})
