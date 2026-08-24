import type { AssetsApplicationService } from '../../assets/application/assets.application-service.js';
import type { CertificatesApplicationService } from '../../certificates/application/certificates.application-service.js';
import type { CloudAccountAssetsApplicationService } from '../../providers/application/cloud-account-assets.application-service.js';
import type { DevicesApplicationService } from '../../devices/application/devices.application-service.js';
import type { UnifiedPluginsApplicationService } from '../../plugins/application/unified-plugins.application-service.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { GlobalSearchResponseDto, GlobalSearchResultDto } from '../dto/global-search.dto.js';

interface SearchIndex {
  builtAt: number;
  items: GlobalSearchResultDto[];
}

export interface GlobalSearchPermissions {
  certificates?: {
    assets: PageQuery;
    versions: PageQuery;
  };
  assets?: PageQuery;
  devices?: string[];
  cloudServices?: string[];
  plugins?: string[];
}

export class GlobalSearchApplicationService {
  private readonly cache = new Map<string, Promise<SearchIndex>>();

  constructor(
    private readonly dependencies: {
      certificates: CertificatesApplicationService;
      assets: AssetsApplicationService;
      devices: DevicesApplicationService;
      cloudServices: CloudAccountAssetsApplicationService;
      plugins: UnifiedPluginsApplicationService;
    },
    private readonly cacheTtlMs = 60_000,
  ) {}

  async search(
    tenantId: string,
    locale: string,
    query: string,
    permissions: GlobalSearchPermissions,
  ): Promise<GlobalSearchResponseDto> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return { query: normalizedQuery, items: [] };
    const index = await this.getIndex(tenantId, locale, permissions);
    const needle = normalize(normalizedQuery, locale);
    return {
      query: normalizedQuery,
      items: index.items
        .filter((item) => [item.title, ...item.keywords].some((value) => normalize(value, locale).includes(needle)))
        .slice(0, 100),
    };
  }

  invalidate(tenantId?: string): void {
    for (const key of this.cache.keys()) {
      if (!tenantId || key.startsWith(`${tenantId}:`)) this.cache.delete(key);
    }
  }

  private async getIndex(tenantId: string, locale: string, permissions: GlobalSearchPermissions): Promise<SearchIndex> {
    const key = `${tenantId}:${locale}:${permissionKey(permissions)}`;
    const existing = this.cache.get(key);
    if (existing) {
      const index = await existing;
      if (Date.now() - index.builtAt < this.cacheTtlMs) return index;
      this.cache.delete(key);
    }
    const building = this.buildIndex(tenantId, locale, permissions);
    this.cache.set(key, building);
    try {
      return await building;
    } catch (error) {
      if (this.cache.get(key) === building) this.cache.delete(key);
      throw error;
    }
  }

  private async buildIndex(tenantId: string, locale: string, permissions: GlobalSearchPermissions): Promise<SearchIndex> {
    const items: GlobalSearchResultDto[] = [];
    const tasks: Array<Promise<void>> = [];

    if (permissions.certificates) tasks.push(this.appendCertificates(items, tenantId, permissions.certificates));
    if (permissions.assets) tasks.push(this.appendAssets(items, tenantId, permissions.assets));
    if (permissions.devices) tasks.push(this.appendDevices(items, tenantId, permissions.devices));
    if (permissions.cloudServices) tasks.push(this.appendCloudServices(items, tenantId, permissions.cloudServices));
    if (permissions.plugins) tasks.push(this.appendPlugins(items, tenantId, locale, permissions.plugins));
    await Promise.all(tasks);
    return { builtAt: Date.now(), items };
  }

  private async appendCertificates(
    items: GlobalSearchResultDto[],
    tenantId: string,
    permissions: NonNullable<GlobalSearchPermissions['certificates']>,
  ): Promise<void> {
    const [assets, versions, roots] = await Promise.all([
      this.dependencies.certificates.listAssets(permissions.assets, tenantId),
      this.dependencies.certificates.listVersions(permissions.versions, tenantId),
      this.dependencies.certificates.getTrustRoots().listRoots({ page: 1, pageSize: 1000, filter: {} }),
    ]);
    const versionsByAsset = new Map<string, typeof versions.items>();
    for (const version of versions.items) {
      const current = versionsByAsset.get(version.certificateAssetId) ?? [];
      current.push(version);
      versionsByAsset.set(version.certificateAssetId, current);
    }
    for (const asset of assets.items) {
      const assetVersions = versionsByAsset.get(asset.id) ?? [];
      const currentVersionId = asset.currentVersionId ?? assetVersions[0]?.id;
      items.push({
        id: `certificate-asset:${asset.id}`,
        title: asset.name || asset.primaryDomain || asset.id,
        type: 'serverCertificate',
        category: 'certificates',
        path: '/certificates',
        query: { versionsModal: '1', assetId: asset.id },
        keywords: [
          asset.primaryDomain,
          ...asset.sans,
          asset.sourceType,
          ...asset.tags,
          asset.id,
          currentVersionId ?? '',
          ...assetVersions.flatMap((version) => [
            version.commonName ?? '',
            version.subject.commonName ?? '',
            version.issuer.commonName ?? '',
            version.fingerprintSha256,
            version.serialNumber,
            ...version.sans,
            ...version.chainCertificateRefs,
          ]),
        ].filter(Boolean),
      });
      for (const version of assetVersions) {
        const chainRefs = version.chainCertificateRefs.filter(Boolean);
        chainRefs.forEach((fingerprint, index) => {
          items.push({
            id: `certificate-intermediate:${version.id}:${fingerprint}`,
            title: fingerprint,
            type: 'intermediateCertificate',
            category: 'certificates',
            path: '/certificates',
            query: { versionsModal: '1', assetId: asset.id },
            keywords: [
              fingerprint,
              version.issuer.commonName ?? '',
              version.issuer.organization ?? '',
              ...version.chainDiagnostics,
              version.id,
              String(index + 1),
            ].filter(Boolean),
          });
        });
      }
    }
    for (const root of roots.items) {
      items.push({
        id: `certificate-root:${root.id}`,
        title: root.subject.commonName || root.fingerprintSha256 || root.id,
        type: 'rootCertificate',
        category: 'certificates',
        path: '/certificates',
        query: { rootId: root.id },
        keywords: [
          root.fingerprintSha256,
          root.subject.organization ?? '',
          root.issuer.commonName ?? '',
          root.serialNumber,
          root.validationStatus,
          root.id,
        ].filter(Boolean),
      });
    }
  }

  private async appendAssets(items: GlobalSearchResultDto[], tenantId: string, query: PageQuery): Promise<void> {
    const result = await this.dependencies.assets.getRepository().listServiceAssets(tenantId, query);
    for (const asset of result.items) {
      const record = asset as unknown as Record<string, unknown>;
      const id = String(record.id ?? '');
      if (!id) continue;
      items.push({
        id: `application:${id}`,
        title: stringValue(record, ['displayName', 'address', 'domainName', 'id'], id),
        type: 'application',
        category: 'assets',
        path: '/assets',
        query: { detailModal: '1', assetId: id },
        keywords: values(record, ['address', 'environment', 'status', 'protocol', 'sniName', 'id']),
      });
    }
  }

  private async appendDevices(items: GlobalSearchResultDto[], tenantId: string, authorizedHostIds?: string[]): Promise<void> {
    const result = await this.dependencies.devices.list(tenantId, {
      page: 1,
      pageSize: 1000,
      filter: {},
      ...(authorizedHostIds ? { authorizedHostIds } : {}),
    });
    for (const device of result.items) {
      items.push({
        id: `device:${device.id}`,
        title: device.displayName || device.managementAddress || device.id,
        type: 'device',
        category: 'assets',
        path: '/assets/devices',
        query: { detailModal: '1', deviceId: device.id },
        keywords: [
          device.displayName,
          device.category,
          device.productFamily,
          device.managementMethod,
          device.managementAddress ?? '',
          device.softwareVersion ?? '',
          device.controlVersion ?? '',
          device.id,
        ].filter(Boolean),
      });
    }
  }

  private async appendCloudServices(items: GlobalSearchResultDto[], tenantId: string, authorizedIds?: string[]): Promise<void> {
    const result = await this.dependencies.cloudServices.list(tenantId);
    for (const asset of result.items.filter((item) => !authorizedIds || authorizedIds.includes(item.id))) {
      items.push({
        id: `cloud:${asset.id}`,
        title: asset.displayName || asset.accountId || asset.providerKey || asset.id,
        type: 'cloudService',
        category: 'assets',
        path: '/providers',
        query: { detailModal: '1', cloudAssetId: asset.id },
        keywords: [
          asset.displayName,
          asset.providerKey,
          asset.accountId ?? '',
          asset.status,
          asset.id,
        ].filter(Boolean),
      });
    }
  }

  private async appendPlugins(items: GlobalSearchResultDto[], tenantId: string, locale: string, authorizedIds?: string[]): Promise<void> {
    const catalog = await this.dependencies.plugins.listCatalog(tenantId, locale);
    for (const plugin of catalog.filter((item) => !authorizedIds || authorizedIds.includes(item.pluginVersionId))) {
      items.push({
        id: `plugin:${plugin.pluginVersionId}`,
        title: plugin.displayName || plugin.name || plugin.pluginId,
        type: 'plugin',
        category: 'plugins',
        path: '/plugins',
        query: { detailModal: '1', pluginVersionId: plugin.pluginVersionId },
        keywords: [
          plugin.displayName ?? '',
          plugin.description ?? '',
          plugin.pluginId,
          plugin.version,
          ...plugin.tags,
          ...plugin.capabilities.map((capability) => capability.key),
          plugin.pluginVersionId,
        ].filter(Boolean),
      });
    }
  }
}

function permissionKey(permissions: GlobalSearchPermissions): string {
  return [
    permissions.certificates ? 'c' : '',
    permissions.assets ? 'a' : '',
    permissions.devices ? 'd' : '',
    permissions.cloudServices ? 's' : '',
    permissions.plugins ? 'p' : '',
  ].join('');
}

function normalize(value: string, locale: string): string {
  return value.trim().toLocaleLowerCase(locale);
}

function stringValue(record: Record<string, unknown>, fields: string[], fallback: string): string {
  for (const field of fields) {
    const value = record[field];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return fallback;
}

function values(record: Record<string, unknown>, fields: string[]): string[] {
  return fields.flatMap((field) => {
    const value = record[field];
    if (Array.isArray(value)) return value.map(String);
    return value === undefined || value === null ? [] : [String(value)];
  });
}
