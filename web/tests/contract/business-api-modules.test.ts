import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCertificateFormat,
  deleteCertificateFormat,
  importCertificate,
  listCertificateFormats,
  listCertificateVersions,
  listCertificates,
  updateCertificateFormat,
} from '@/api/modules/certificates.api'
import { createHost, createServiceInstance, deleteHost, deleteServiceInstance, evaluateCapabilityCompatibility, listAssets, matchCapabilityRequirement, previewDiscoveryMerge, updateHost, updateServiceInstance } from '@/api/modules/assets.api'
import { createBinding, deleteBinding, detectBindingDrift, listBindingUsages, listBindings, patchBindingStatus, persistBindingDriftResult } from '@/api/modules/bindings.api'
import { executeDeploymentPlan, listDeploymentPlans } from '@/api/modules/deployments.api'
import { rollbackExecution } from '@/api/modules/executions.api'
import { listAudits } from '@/api/modules/audits.api'
import { disablePlugin, listPlugins } from '@/api/modules/plugins.api'
import { listGateways, probeGateway, routeGateway, updateGatewayStatus } from '@/api/modules/gateways.api'

function mockPage() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    data: { items: [], page: 1, pageSize: 20, total: 0 },
    requestId: 'req_contract',
    timestamp: '2026-06-08T00:00:00.000Z'
  }), { status: 200 })))
}

describe('业务 API modules', () => {
  afterEach(() => vi.restoreAllMocks())

  it('列表接口使用 apiClient 的 /api/v1 规范路径', async () => {
    mockPage()
    await listCertificates()
    await listCertificateVersions({ filters: { certificateAssetId: 'cert-1' } })
    await listCertificateFormats({ filters: { certificateVersionId: 'certver-1' } })
    await listAssets()
    await listBindings()
    await listDeploymentPlans()
    await listAudits()
    await listPlugins()
    await listGateways()

    const urls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]))
    expect(urls).toEqual(expect.arrayContaining([
      '/api/v1/certificate-assets?page=1&pageSize=20',
      '/api/v1/certificate-versions?page=1&pageSize=20&filter%5BcertificateAssetId%5D=cert-1',
      '/api/v1/certificate-version-formats?page=1&pageSize=20&filter%5BcertificateVersionId%5D=certver-1',
      '/api/v1/service-assets?page=1&pageSize=20',
      '/api/v1/certificate-bindings?page=1&pageSize=20',
      '/api/v1/deployment-plans?page=1&pageSize=20',
      '/api/v1/audit-events?page=1&pageSize=20',
      '/api/v1/plugins/packages?page=1&pageSize=20',
      '/api/v1/gateways?page=1&pageSize=20'
    ]))
    expect(urls).not.toContain('/api/v1/plugins?page=1&pageSize=20')
  })

  it('部署、回滚、插件禁用和证书导入动作使用后端真实动作路径', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { id: 'ok' },
      requestId: 'req_action',
      timestamp: '2026-06-08T00:00:00.000Z'
    }), { status: 200 })))

    await executeDeploymentPlan('plan-1', { approvalId: 'approval-1' })
    await rollbackExecution('run-1', { dryRun: true })
    await disablePlugin('pluginpkg-1', { dryRun: true })
    await importCertificate({ certificatePem: '-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----' })
    const executeCall = vi.mocked(fetch).mock.calls[0]
    const rollbackCall = vi.mocked(fetch).mock.calls[1]
    const disablePluginCall = vi.mocked(fetch).mock.calls[2]
    const importCertificateCall = vi.mocked(fetch).mock.calls[3]
    expect(executeCall?.[0]).toBe('/api/v1/deployment-plans/execute')
    expect(rollbackCall?.[0]).toBe('/api/v1/execution-runs/rollback')
    expect(disablePluginCall?.[0]).toBe('/api/v1/plugins/disable')
    expect(importCertificateCall?.[0]).toBe('/api/v1/certificate-versions/import')
    expect(JSON.parse(String(executeCall?.[1]?.body))).toMatchObject({ planId: 'plan-1', approvalId: 'approval-1' })
    expect(JSON.parse(String(executeCall?.[1]?.body))).not.toHaveProperty('dryRun')
    expect(JSON.parse(String(rollbackCall?.[1]?.body))).toMatchObject({ runId: 'run-1', dryRun: true })
    expect(JSON.parse(String(disablePluginCall?.[1]?.body))).toMatchObject({ pluginPackageId: 'pluginpkg-1', dryRun: true })
    expect(JSON.parse(String(importCertificateCall?.[1]?.body))).toMatchObject({ certificatePem: expect.stringContaining('BEGIN CERTIFICATE') })
    const headers = executeCall?.[1]?.headers as Headers
    expect(headers.get('X-Idempotency-Key')).toMatch(/^deployment_execute_/)
    const importHeaders = importCertificateCall?.[1]?.headers as Headers
    expect(importHeaders.get('X-Idempotency-Key')).toMatch(/^certificate_import_/)
  })

  it('证书产物配置文件的新增、更新、删除使用真实 CRUD 路径', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { id: 'certfmt-1' },
      requestId: 'req_certificate_format_crud',
      timestamp: '2026-06-23T00:00:00.000Z',
    }), { status: 200 })))

    await createCertificateFormat({
      format: 'pfx',
      parameters: { configName: 'Nginx-PFX-标准模板' },
    })
    await updateCertificateFormat({
      id: 'certfmt-1',
      alias: 'ignored-by-backend',
      parameters: { alias: 'gcac-cert' },
    })
    await deleteCertificateFormat('certfmt-1')

    const calls = vi.mocked(fetch).mock.calls
    expect(calls[0]?.[0]).toBe('/api/v1/certificate-version-formats')
    expect(calls[1]?.[0]).toBe('/api/v1/certificate-version-formats')
    expect(calls[2]?.[0]).toBe('/api/v1/certificate-version-formats/delete')
    expect(calls[0]?.[1]?.method).toBe('POST')
    expect(calls[1]?.[1]?.method).toBe('PATCH')
    expect(calls[2]?.[1]?.method).toBe('POST')
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({
      format: 'pfx',
      parameters: { configName: 'Nginx-PFX-标准模板' },
    })
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({
      id: 'certfmt-1',
      parameters: { alias: 'gcac-cert' },
    })
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toMatchObject({ id: 'certfmt-1' })
    expect((calls[0]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^certificate_format_create_/)
    expect((calls[1]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^certificate_format_update_/)
    expect((calls[2]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^certificate_format_delete_/)
  })

  it('资产登记调用 Host 创建接口并携带幂等键', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { id: 'host-1' },
      requestId: 'req_host_create',
      timestamp: '2026-06-09T00:00:00.000Z'
    }), { status: 201 })))

    await createHost({ hostname: 'web-01', osType: 'LINUX' })

    const call = vi.mocked(fetch).mock.calls[0]
    expect(call?.[0]).toBe('/api/v1/hosts')
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({ hostname: 'web-01', osType: 'LINUX' })
    expect((call?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^host_create_/)
  })

  it('Gateway 模块使用稳定动作路径，不再拼不存在的 path params', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { id: 'ok' },
      requestId: 'req_gateway_action',
      timestamp: '2026-06-09T00:00:00.000Z'
    }), { status: 200 })))

    await routeGateway({ zoneId: 'zone-dmz', targetId: 'target-1', protocols: ['https'], requiredCapabilities: ['curl'], destructive: true })
    await probeGateway({ gatewayId: 'gw-1', targetId: 'target-1', protocol: 'https', port: 443 })
    await updateGatewayStatus({ gatewayId: 'gw-1', action: 'disable', status: 'disabled' })

    const calls = vi.mocked(fetch).mock.calls
    expect(calls.map((call) => call[0])).toEqual([
      '/api/v1/gateways/route',
      '/api/v1/gateways/probe',
      '/api/v1/gateways/status'
    ])
    expect(calls.map((call) => String(call[0]))).not.toContain('/api/v1/gateways/gw-1:probe')
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({
      zoneId: 'zone-dmz',
      targetId: 'target-1',
      protocols: ['https'],
      requiredCapabilities: ['curl'],
      destructive: true
    })
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toMatchObject({ gatewayId: 'gw-1', targetId: 'target-1', protocol: 'https', port: 443 })
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toMatchObject({ gatewayId: 'gw-1', action: 'disable', status: 'disabled' })
    expect((calls[0]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^gateway_route_/)
    expect((calls[1]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^gateway_probe_/)
    expect((calls[2]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^gateway_status_/)
  })


  it('资产、服务实例、绑定和发现冲突动作使用真实集合路径', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { id: 'ok', conflicts: [], actions: [] },
      requestId: 'req_spec028_assets',
      timestamp: '2026-06-09T00:00:00.000Z'
    }), { status: 200 })))

    await updateHost('host-1', { hostname: 'web-01', zoneId: 'zone-a', arch: 'arm64' })
    await deleteHost('host-1')
    await createServiceInstance({ hostId: 'host-1', providerType: 'NGINX', displayName: 'nginx-main' })
    await updateServiceInstance('svc-1', { configPath: '/etc/nginx/nginx.conf' })
    await deleteServiceInstance('svc-1', { reason: 'manual' })
    await matchCapabilityRequirement({ targetId: 'host-1', requiredCapabilities: ['service.reload'] })
    await evaluateCapabilityCompatibility({ targetId: 'host-1', operation: 'deploy' })
    await createBinding({ serviceInstanceId: 'svc-1', bindingType: 'FILE_PATH', certPath: '/etc/nginx/site.pem', verifyMethod: 'TLS_CONNECT' })
    await detectBindingDrift({ remoteFingerprintSha256: 'a'.repeat(64), desiredFingerprintSha256: 'a'.repeat(64) })
    await persistBindingDriftResult({ bindingId: 'binding-1', remoteFingerprintSha256: 'a'.repeat(64) })
    await patchBindingStatus('binding-1', 'MANAGED')
    await deleteBinding('binding-1', { reason: 'manual' })
    await listBindingUsages({ filters: { bindingId: 'binding-1' } })
    await previewDiscoveryMerge({ normalizedHash: 'hash-ui', normalizedPayload: { hosts: [] } })

    const calls = vi.mocked(fetch).mock.calls
    expect(calls.map((call) => String(call[0]))).toEqual([
      '/api/v1/hosts',
      '/api/v1/hosts/delete',
      '/api/v1/service-instances',
      '/api/v1/service-instances',
      '/api/v1/service-instances/delete',
      '/api/v1/capabilities/match',
      '/api/v1/capabilities/compatibility/evaluate',
      '/api/v1/certificate-bindings',
      '/api/v1/certificate-bindings/drift',
      '/api/v1/certificate-bindings/drift-results',
      '/api/v1/certificate-bindings/status',
      '/api/v1/certificate-bindings/delete',
      '/api/v1/certificate-bindings/usage?page=1&pageSize=20&filter%5BbindingId%5D=binding-1',
      '/api/v1/discovery-snapshots/merge-preview'
    ])
    expect(calls[0]?.[1]?.method).toBe('PATCH')
    expect(calls[3]?.[1]?.method).toBe('PATCH')
    expect(calls[10]?.[1]?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toMatchObject({ id: 'host-1', hostname: 'web-01', zoneId: 'zone-a', arch: 'arm64' })
    expect(JSON.parse(String(calls[4]?.[1]?.body))).toMatchObject({ id: 'svc-1', reason: 'manual' })
    expect(JSON.parse(String(calls[7]?.[1]?.body))).toMatchObject({ serviceInstanceId: 'svc-1', bindingType: 'FILE_PATH', certPath: '/etc/nginx/site.pem' })
    expect(JSON.parse(String(calls[10]?.[1]?.body))).toMatchObject({ bindingId: 'binding-1', status: 'MANAGED' })
    expect(JSON.parse(String(calls[11]?.[1]?.body))).toMatchObject({ bindingId: 'binding-1', reason: 'manual' })
    expect((calls[7]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^binding_create_/)
    expect((calls[13]?.[1]?.headers as Headers).get('X-Idempotency-Key')).toMatch(/^discovery_merge_preview_/)
  })

})
