import { createHash } from 'node:crypto';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { RepositoryPort } from '../../../persistence/repositories/repository-port.js';
import { MemoryRepository } from '../../../persistence/repositories/memory-repository.js';
import { createPageResponse, type PageResponse } from '../../../shared/dto/page-response.js';
import { canonicalize } from '../../../shared/canonical-json.js';
import type {
  CertificateAssetEntity,
  CertificateVersionEntity,
  CertificateVersionFormatEntity,
} from '../schema/certificates.schema.js';

export interface CertificatesRepository {
  readonly moduleName: 'certificates';
  createAsset(entity: CertificateAssetEntity): CertificateAssetEntity;
  updateAsset(id: string, patch: Partial<CertificateAssetEntity>): CertificateAssetEntity;
  getAsset(id: string): CertificateAssetEntity | undefined;
  deleteOrUpdateAsset(id: string, patch: Partial<CertificateAssetEntity>): CertificateAssetEntity;
  listVersionsByAsset(certificateAssetId: string): CertificateVersionEntity[];
  updateVersion(id: string, patch: Partial<CertificateVersionEntity>): CertificateVersionEntity;
  deleteOrUpdateVersion(id: string, patch: Partial<CertificateVersionEntity>): CertificateVersionEntity;
  listFormatsByVersion(certificateVersionId: string): CertificateVersionFormatEntity[];
  listAssets(query: PageQuery): PageResponse<CertificateAssetEntity>;
  createVersion(entity: CertificateVersionEntity): CertificateVersionEntity;
  getVersion(id: string): CertificateVersionEntity | undefined;
  getVersionByFingerprint(fingerprintSha256: string): CertificateVersionEntity | undefined;
  countVersionsByAsset(certificateAssetId: string): number;
  listVersions(query: PageQuery): PageResponse<CertificateVersionEntity>;
  createFormat(entity: CertificateVersionFormatEntity): CertificateVersionFormatEntity;
  listFormats(query: PageQuery): PageResponse<CertificateVersionFormatEntity>;
  getFormatByNaturalKey(certificateVersionId: string, format: string, parameterHash: string): CertificateVersionFormatEntity | undefined;
}

export class InMemoryCertificatesRepository implements CertificatesRepository {
  readonly moduleName = 'certificates' as const;

  constructor(
    private readonly assets: RepositoryPort<CertificateAssetEntity> = new MemoryRepository<CertificateAssetEntity>(),
    private readonly versions: RepositoryPort<CertificateVersionEntity> = new MemoryRepository<CertificateVersionEntity>(),
    private readonly formats: RepositoryPort<CertificateVersionFormatEntity> = new MemoryRepository<CertificateVersionFormatEntity>(),
  ) {}

  createAsset(entity: CertificateAssetEntity): CertificateAssetEntity {
    return this.assets.create(entity);
  }

  updateAsset(id: string, patch: Partial<CertificateAssetEntity>): CertificateAssetEntity {
    return this.assets.update(id, patch);
  }

  getAsset(id: string): CertificateAssetEntity | undefined {
    return this.assets.get(id);
  }

  deleteOrUpdateAsset(id: string, patch: Partial<CertificateAssetEntity>): CertificateAssetEntity {
    return this.assets.update(id, patch);
  }

  listVersionsByAsset(certificateAssetId: string): CertificateVersionEntity[] {
    return this.versions.list((version) => version.certificateAssetId === certificateAssetId);
  }

  updateVersion(id: string, patch: Partial<CertificateVersionEntity>): CertificateVersionEntity {
    return this.versions.update(id, patch);
  }

  deleteOrUpdateVersion(id: string, patch: Partial<CertificateVersionEntity>): CertificateVersionEntity {
    return this.versions.update(id, patch);
  }

  listFormatsByVersion(certificateVersionId: string): CertificateVersionFormatEntity[] {
    return this.formats.list((format) => format.certificateVersionId === certificateVersionId);
  }

  listAssets(query: PageQuery): PageResponse<CertificateAssetEntity> {
    return page(sortRows(filterRows(this.assets.list(), query.filter), query), query);
  }

  createVersion(entity: CertificateVersionEntity): CertificateVersionEntity {
    return this.versions.create(entity);
  }

  getVersion(id: string): CertificateVersionEntity | undefined {
    return this.versions.get(id);
  }

  getVersionByFingerprint(fingerprintSha256: string): CertificateVersionEntity | undefined {
    const normalized = fingerprintSha256.toLowerCase();
    return this.versions.list((version) => version.fingerprintSha256.toLowerCase() === normalized)[0];
  }

  countVersionsByAsset(certificateAssetId: string): number {
    return this.versions.list((version) => version.certificateAssetId === certificateAssetId).length;
  }

  listVersions(query: PageQuery): PageResponse<CertificateVersionEntity> {
    return page(sortRows(filterCertificateVersions(this.versions.list(), this.assets.list(), query.filter), query), query);
  }

  createFormat(entity: CertificateVersionFormatEntity): CertificateVersionFormatEntity {
    return this.formats.create(entity);
  }

  listFormats(query: PageQuery): PageResponse<CertificateVersionFormatEntity> {
    return page(sortRows(filterRows(this.formats.list(), query.filter), query), query);
  }

  getFormatByNaturalKey(certificateVersionId: string, format: string, parameterHash: string): CertificateVersionFormatEntity | undefined {
    return this.formats.list((row) => row.certificateVersionId === certificateVersionId && row.format === format && row.parameterHash === parameterHash)[0];
  }
}

function filterRows<T extends object>(rows: T[], filter: Record<string, string>): T[] {
  return rows.filter((row) => Object.entries(filter).every(([field, expected]) => {
    const actual = (row as Record<string, unknown>)[field];
    if (Array.isArray(actual)) return actual.some((item) => String(item).toLowerCase().includes(expected.toLowerCase()));
    if (actual === undefined || actual === null) return false;
    return String(actual).toLowerCase().includes(expected.toLowerCase());
  }));
}

function filterCertificateVersions(
  versions: CertificateVersionEntity[],
  assets: CertificateAssetEntity[],
  filter: Record<string, string>,
): CertificateVersionEntity[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  return versions.filter((version) => Object.entries(filter).every(([field, expected]) => {
    const needle = expected.toLowerCase();
    const asset = assetsById.get(version.certificateAssetId);
    switch (field) {
      case 'primaryDomain':
        return includesValue(asset?.primaryDomain, needle);
      case 'sans':
      case 'san':
        return includesValue(version.sans, needle) || includesValue(asset?.sans, needle);
      case 'fingerprint':
        return includesValue(version.fingerprintSha256, needle);
      default:
        return includesValue((version as unknown as Record<string, unknown>)[field], needle);
    }
  }));
}

function includesValue(actual: unknown, needle: string): boolean {
  if (Array.isArray(actual)) return actual.some((item) => String(item).toLowerCase().includes(needle));
  if (actual === undefined || actual === null) return false;
  return String(actual).toLowerCase().includes(needle);
}

function sortRows<T extends object>(rows: T[], query: PageQuery): T[] {
  if (!query.sort) return rows;
  const { field, direction } = query.sort;
  return [...rows].sort((left, right) => {
    const a = comparable((left as Record<string, unknown>)[field]);
    const b = comparable((right as Record<string, unknown>)[field]);
    if (a < b) return direction === 'asc' ? -1 : 1;
    if (a > b) return direction === 'asc' ? 1 : -1;
    return 0;
  });
}

function comparable(value: unknown): string {
  if (value === undefined || value === null) return '';
  return Array.isArray(value) ? value.join(',') : String(value);
}

function page<T>(rows: T[], query: PageQuery): PageResponse<T> {
  const start = (query.page - 1) * query.pageSize;
  return createPageResponse(rows.slice(start, start + query.pageSize), query.page, query.pageSize, rows.length);
}

export function buildParameterHash(parameters: unknown): string {
  return createHash('sha256').update(canonicalize(parameters ?? {})).digest('hex');
}
