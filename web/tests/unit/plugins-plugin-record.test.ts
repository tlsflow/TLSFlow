import { describe, expect, it } from 'vitest'
import type { PluginCatalogItem, PluginRuntimeMetric, PluginVersionRecord } from '@/api/generated/schemas'
import { aggregateRunnerStatus, toCatalogPluginRecord } from '@/views/plugins/plugin-record'

const catalogItem: PluginCatalogItem = {
  id: 'catalog-row-1',
  catalogType: 'UNIFIED_PLUGIN',
  pluginId: 'web.nginx',
  pluginVersionId: 'plugin-version-1',
  version: '1.2.3',
  name: 'web.nginx',
  displayNameKey: 'plugins.web.nginx.name',
  descriptionKey: 'plugins.web.nginx.description',
  displayName: 'Nginx',
  description: '通用 Web 插件',
  logoSquareUrl: '/plugin-logos/nginx-square.svg',
  tags: ['web'],
  platforms: ['LINUX'],
  stepCount: 2,
  rollbackCount: 1,
  source: 'BUILTIN',
  runtime: 'WORKFLOW_DSL',
  status: 'ENABLED',
  scope: 'BOTH',
  trust: 'OFFICIAL_SIGNED',
  support: 'OFFICIAL',
  packageSha256: 'package-digest',
  manifestSha256: 'manifest-digest',
  resourceSha256: { 'manifest.json': 'resource-digest' },
  capabilities: [{
    key: 'certificate.deploy',
    contractVersion: 'v1',
    actionContractId: 'certificate.deploy/v1',
    riskLevel: 'HIGH',
    executionLocations: ['AGENT'],
  }],
  detailRef: { pluginVersionId: 'plugin-version-1' },
}

const versionRecord: PluginVersionRecord = {
  id: 'plugin-version-1',
  tenantId: 'tenant-1',
  pluginId: 'web.nginx',
  pluginVersionId: 'plugin-version-1',
  version: '1.2.3',
  source: 'BUILTIN',
  runtime: 'WORKFLOW_DSL',
  scope: 'BOTH',
  trust: 'OFFICIAL_SIGNED',
  support: 'OFFICIAL',
  status: 'ENABLED',
  updatedAt: '2026-08-09T00:00:00.000Z',
  packageSha256: 'package-digest',
  manifestSha256: 'manifest-digest',
  resourceSha256: { 'manifest.json': 'resource-digest' },
  manifest: {
    apiVersion: 'gcac.plugin/v1',
    kind: 'PluginManifest',
    pluginId: 'web.nginx',
    version: '1.2.3',
    displayNameKey: 'plugins.web.nginx.name',
    publisher: 'GCAC',
    runtime: 'WORKFLOW_DSL',
    source: 'BUILTIN',
    scope: 'BOTH',
    trust: 'OFFICIAL_SIGNED',
    support: 'OFFICIAL',
    capabilities: [],
    permissions: ['artifact.read'],
    resources: {},
  },
  resources: {},
  permissionApprovalStatus: 'APPROVED',
  approvedPermissions: ['artifact.read'],
  validationReport: { valid: true, errors: [], warnings: [], manifestSha256: 'package-digest', resourceSha256: {} },
  createdAt: '2026-08-09T00:00:00.000Z',
}

describe('插件目录身份归一化', () => {
  it('只保留 canonical pluginId、固定 pluginVersionId 和摘要', () => {
    const legacyFields = {
      providerKey: 'legacy.provider',
      supportedProducts: ['legacy.product'],
      supportedOperations: ['legacy.operation'],
    }
    const result = toCatalogPluginRecord({ ...catalogItem, ...legacyFields } as PluginCatalogItem, versionRecord)

    expect(result).toMatchObject({
      pluginId: 'web.nginx',
      pluginVersionId: 'plugin-version-1',
      id: 'plugin-version-1',
      packageSha256: 'package-digest',
      manifestSha256: 'manifest-digest',
      resourceSha256: { 'manifest.json': 'resource-digest' },
      permissions: ['artifact.read'],
      metadata: { logoSquareUrl: '/plugin-logos/nginx-square.svg' },
    })
    expect(result).not.toHaveProperty('providerKey')
    expect(result).not.toHaveProperty('supportedProducts')
    expect(result).not.toHaveProperty('supportedOperations')
  })

  it('拒绝缺少固定版本身份、摘要或交叉身份不一致的目录记录', () => {
    expect(toCatalogPluginRecord({ ...catalogItem, pluginVersionId: '' }, versionRecord)).toBeUndefined()
    expect(toCatalogPluginRecord({ ...catalogItem, packageSha256: '' }, versionRecord)).toBeUndefined()
    expect(toCatalogPluginRecord(catalogItem, { ...versionRecord, pluginId: 'web.apache' })).toBeUndefined()
  })

  it('聚合同一版本的全部 capability Runner 指标，不被后一个指标覆盖', () => {
    const metrics = [
      { pluginVersionId: 'plugin-version-1', capabilityKey: 'certificate.deploy', inFlight: 0, circuitState: 'CLOSED' },
      { pluginVersionId: 'plugin-version-1', capabilityKey: 'certificate.rollback', inFlight: 2, circuitState: 'CLOSED' },
    ] as PluginRuntimeMetric[]

    expect(aggregateRunnerStatus(metrics)).toBe('busy')
    expect(aggregateRunnerStatus([
      ...metrics,
      { pluginVersionId: 'plugin-version-1', capabilityKey: 'certificate.verify', inFlight: 0, circuitState: 'OPEN' },
    ] as PluginRuntimeMetric[])).toBe('unavailable')
  })
})
