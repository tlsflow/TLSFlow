import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GlobalSearchApplicationService, type GlobalSearchPermissions } from './global-search.application-service.js';

function permissions(overrides: Partial<GlobalSearchPermissions> = {}): GlobalSearchPermissions {
  return {
    assets: { page: 1, pageSize: 1000, filter: {} },
    devices: ['device-1'],
    cloudServices: ['cloud-1'],
    plugins: ['plugin-1'],
    ...overrides,
  };
}

function createService(cacheTtlMs = 60_000) {
  const calls = {
    certificateAssets: 0,
    certificateVersions: 0,
    roots: 0,
    assets: 0,
    devices: 0,
    clouds: 0,
    plugins: 0,
  };
  const service = new GlobalSearchApplicationService({
    certificates: {
      listAssets: async () => {
        calls.certificateAssets += 1;
        return { items: [], page: 1, pageSize: 1000, total: 0 };
      },
      listVersions: async () => {
        calls.certificateVersions += 1;
        return { items: [], page: 1, pageSize: 1000, total: 0 };
      },
      getTrustRoots: () => ({
        listRoots: async () => {
          calls.roots += 1;
          return { items: [], page: 1, pageSize: 1000, total: 0, managedSummary: {} };
        },
      }),
    } as never,
    assets: {
      getRepository: () => ({
        listServiceAssets: async () => {
          calls.assets += 1;
          return { items: [], page: 1, pageSize: 1000, total: 0 };
        },
      }),
    } as never,
    devices: {
      list: async () => {
        calls.devices += 1;
        return { items: [], page: 1, pageSize: 1000, total: 0 };
      },
    } as never,
    cloudServices: {
      list: async () => {
        calls.clouds += 1;
        return { items: [], page: 1, pageSize: 1000, total: 0 };
      },
    } as never,
    plugins: {
      listCatalog: async () => {
        calls.plugins += 1;
        return [];
      },
    } as never,
  }, cacheTtlMs);
  return { service, calls };
}

function createResultService() {
  return new GlobalSearchApplicationService({
    certificates: {
      listAssets: async () => ({
        items: [{
          id: 'certificate-1',
          name: '*.example.com',
          primaryDomain: '*.example.com',
          sans: [],
          sourceType: 'manual',
          currentVersionId: 'version-1',
          status: 'active',
          tags: [],
          createdBy: 'user-1',
          createdAt: '',
          updatedAt: '',
        }],
        page: 1,
        pageSize: 1000,
        total: 1,
      }),
      listVersions: async () => ({
        items: [{
          id: 'version-1',
          certificateAssetId: 'certificate-1',
          versionNo: 1,
          commonName: '*.example.com',
          sans: [],
          issuer: { commonName: 'Example Issuer' },
          subject: { commonName: '*.example.com' },
          serialNumber: 'serial-1',
          notBefore: '',
          notAfter: '',
          fingerprintSha256: 'fingerprint-1',
          publicKeyAlgorithm: '',
          signatureAlgorithm: '',
          leafStorageRef: '',
          hasPrivateKey: false,
          chainCertificateRefs: [],
          chainOrder: [],
          chainDiagnostics: [],
          chainStatus: 'valid',
          deployable: true,
          sourceType: 'manual',
          activationState: 'active',
          status: 'active',
          createdBy: 'user-1',
          createdAt: '',
        }],
        page: 1,
        pageSize: 1000,
        total: 1,
      }),
      getTrustRoots: () => ({
        listRoots: async () => ({ items: [], page: 1, pageSize: 1000, total: 0, managedSummary: {} }),
      }),
    } as never,
    assets: {
      getRepository: () => ({
        listServiceAssets: async () => ({
          items: [{
            id: 'application-1',
            displayName: 'Application',
            address: 'app.example.com',
            port: 443,
            environment: 'production',
            protocol: 'HTTPS',
          }],
          page: 1,
          pageSize: 1000,
          total: 1,
        }),
      }),
    } as never,
    devices: {
      list: async () => ({
        items: [{
          id: 'device-1',
          displayName: 'Device',
          category: 'SERVER',
          productFamily: 'nginx',
          managementMethod: 'AGENT',
          managementAddress: '10.0.0.10',
          health: 'HEALTHY',
          sourceStatus: 'READY',
          applicationAssetCount: 0,
          capabilities: [],
          extensionType: 'AGENT',
        }],
        page: 1,
        pageSize: 1000,
        total: 1,
      }),
    } as never,
    cloudServices: {
      list: async () => ({ items: [], page: 1, pageSize: 1000, total: 0 }),
    } as never,
    plugins: {
      listCatalog: async () => [],
    } as never,
  });
}

describe('GlobalSearchApplicationService', () => {
  it('为搜索结果生成可展示且可匹配的摘要', async () => {
    const service = createResultService();

    const byFingerprint = await service.search('tenant-1', 'zh-CN', 'fingerprint-1', {
      certificates: {
        assets: { page: 1, pageSize: 1000, filter: {} },
        versions: { page: 1, pageSize: 1000, filter: {} },
      },
    });
    const certificate = byFingerprint.items.find((item) => item.type === 'serverCertificate');
    assert.equal(certificate?.summary, 'fingerprint-1 · Example Issuer · *.example.com');

    const byEnvironment = await service.search('tenant-1', 'zh-CN', 'production', {
      assets: { page: 1, pageSize: 1000, filter: {} },
    });
    const application = byEnvironment.items.find((item) => item.type === 'application');
    assert.equal(application?.summary, 'app.example.com · 443 · production');
  });

  it('在同一租户和同一授权范围内命中缓存', async () => {
    const { service, calls } = createService();

    await service.search('tenant-1', 'zh-CN', 'certificate', permissions());
    await service.search('tenant-1', 'zh-CN', 'device', permissions());

    assert.equal(calls.assets, 1);
    assert.equal(calls.devices, 1);
    assert.equal(calls.clouds, 1);
    assert.equal(calls.plugins, 1);
  });

  it('按租户和对象授权范围隔离缓存', async () => {
    const { service, calls } = createService();
    const first = permissions({ devices: ['device-1'] });
    const second = permissions({ devices: ['device-2'] });

    await service.search('tenant-1', 'zh-CN', 'device', first);
    await service.search('tenant-2', 'zh-CN', 'device', first);
    await service.search('tenant-1', 'zh-CN', 'device', second);

    assert.equal(calls.devices, 3);
  });

  it('缓存过期后重新构建索引', async () => {
    const { service, calls } = createService(1);

    await service.search('tenant-1', 'zh-CN', 'device', permissions());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.search('tenant-1', 'zh-CN', 'device', permissions());

    assert.equal(calls.devices, 2);
  });

  it('支持按租户主动失效缓存', async () => {
    const { service, calls } = createService();

    await service.search('tenant-1', 'zh-CN', 'device', permissions());
    await service.search('tenant-2', 'zh-CN', 'device', permissions());
    service.invalidate('tenant-1');
    await service.search('tenant-1', 'zh-CN', 'device', permissions());
    await service.search('tenant-2', 'zh-CN', 'device', permissions());

    assert.equal(calls.devices, 3);
  });
});
