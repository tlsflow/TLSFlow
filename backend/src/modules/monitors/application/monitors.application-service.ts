import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { ExecutionsRepository } from '../../executions/repository/executions.repository.js';
import type {
  ChangeRiskStatusInput,
  AlertRuleDto,
  CertificateObservationDto,
  CollectMonitorRisksInput,
  CreateAlertRuleInput,
  CreateMonitorTargetInput,
  ListMonitorProbeResultsQuery,
  ListMonitorTargetsQuery,
  ListRiskEventsQuery,
  MonitorDashboardDto,
  MonitorProbeResultDto,
  MonitorTargetDto,
  MonitorTargetPageDto,
  ProbeServiceAssetInput,
  ProbeServiceAssetResult,
  RiskEventDto,
  UpdateMonitorTargetInput,
} from '../dto/monitors.dto.js';
import { MonitorsDomainService } from '../domain/monitors.domain-service.js';
import { monitorMetrics, monitorTargetStatuses, type AlertRule, type MonitorMetric, type MonitorTargetStatus, type RiskEvent } from '../schema/monitors.schema.js';
import { AlertDispatcher } from './alert-dispatcher.js';
import type { NotificationPort } from '../../notifications/application/notification.port.js';
import { MonitoringScheduler } from './monitoring-scheduler.js';
import { PgMonitorsRepository, type MonitorsRepository } from '../repository/monitors.repository.js';

export interface MonitorsApplicationDependencies {
  repository?: MonitorsRepository;
  domain?: MonitorsDomainService;
  certificates: CertificatesRepository;
  bindings: BindingsRepository;
  executions: ExecutionsRepository;
  assets?: AssetsRepository;
  notifications?: NotificationPort;
}

export class MonitorsApplicationService {
  private readonly repository: MonitorsRepository;
  private readonly domain: MonitorsDomainService;
  private readonly scheduler = new MonitoringScheduler();
  private readonly alertDispatcher: AlertDispatcher;

  constructor(private readonly dependencies: MonitorsApplicationDependencies) {
    this.repository = dependencies.repository ?? new PgMonitorsRepository();
    this.domain = dependencies.domain ?? new MonitorsDomainService();
    this.alertDispatcher = new AlertDispatcher(dependencies.notifications);
  }

  async collectRisks(input: CollectMonitorRisksInput = {}): Promise<{ risks: RiskEventDto[]; dashboard: MonitorDashboardDto; matchedRuleIds: string[]; alertDispatches: Awaited<ReturnType<AlertDispatcher['dispatch']>> }> {
    const detectedAt = input.scanStartedAt ?? new Date().toISOString();
    const thresholdDays = input.certificateExpiringThresholdDays ?? 30;
    const createdOrUpdated: RiskEvent[] = [];

    const certificates = await this.dependencies.certificates.listVersions(allRowsQuery());
    for (const version of certificates.items) {
      const asset = await this.dependencies.certificates.getAsset(version.certificateAssetId);
      if (!asset || asset.status !== 'active' || version.status !== 'active') continue;
      const risk = this.domain.buildCertificateRiskEvent(asset, version, detectedAt, thresholdDays);
      if (!risk) continue;
      risk.scope.tenantId = input.tenantId;
      createdOrUpdated.push(await this.repository.upsertRiskEvent(risk));
    }

    const bindings = await this.dependencies.bindings.listCertificateBindings(input.tenantId ?? tenantFallback, allRowsQuery());
    for (const binding of bindings.items) {
      const risk = this.domain.buildBindingRiskEvent(binding);
      if (!risk) continue;
      risk.detectedAt = detectedAt;
      risk.scope.tenantId = binding.tenantId;
      createdOrUpdated.push(await this.repository.upsertRiskEvent(risk));
    }

    const runs = await this.dependencies.executions.listRuns(input.tenantId);
    for (const run of runs) {
      const risk = this.domain.buildExecutionRiskEvent(run);
      if (!risk) continue;
      risk.detectedAt = detectedAt;
      risk.scope.tenantId = run.tenantId ?? input.tenantId;
      createdOrUpdated.push(await this.repository.upsertRiskEvent(risk));
    }

    const allRisks = await this.listRiskEvents({ tenantId: input.tenantId });
    const matchedRuleIds = (await this.listAlertRules(input.tenantId))
      .filter((rule) => this.domain.evaluateRule(rule, allRisks, detectedAt))
      .map((rule) => rule.id);
    return {
      risks: createdOrUpdated,
      dashboard: this.domain.aggregateDashboard(allRisks),
      matchedRuleIds,
      alertDispatches: await this.alertDispatcher.dispatch(matchedRuleIds, createdOrUpdated),
    };
  }

  createMonitorJobs(input: { tenantId?: string; scope?: import('../schema/monitors.schema.js').AlertRuleScope; now?: string } = {}) {
    return this.scheduler.createJobs(input);
  }

  async ingestRemoteTlsObservation(input: import('../dto/monitors.dto.js').RemoteTlsObservationInput): Promise<RiskEventDto[]> {
    return Promise.all(this.domain.buildRemoteTlsRiskEvents(input).map((event) => this.repository.upsertRiskEvent(event)));
  }

  async ingestAutomationHealth(input: import('../dto/monitors.dto.js').AutomationHealthInput): Promise<RiskEventDto | undefined> {
    const event = this.domain.buildAutomationHealthRiskEvent(input);
    return event ? this.repository.upsertRiskEvent(event) : undefined;
  }

  async listRiskEvents(query: ListRiskEventsQuery = {}): Promise<RiskEventDto[]> {
    return this.repository.listRiskEvents(query);
  }

  async changeRiskStatus(input: ChangeRiskStatusInput) {
    return this.repository.changeRiskStatus(input);
  }

  async listRiskStatusHistory(tenantId: string, riskEventId: string) {
    return this.repository.listRiskStatusHistory(tenantId, riskEventId);
  }

  async listMonitorTargets(query: ListMonitorTargetsQuery): Promise<MonitorTargetPageDto> {
    return this.repository.listMonitorTargets(query);
  }

  async createMonitorTarget(input: CreateMonitorTargetInput): Promise<MonitorTargetDto> {
    await this.assertServiceAssetExists(input.tenantId, input.serviceAssetId);
    return this.repository.createMonitorTarget({
      ...input,
      metrics: normalizeMonitorMetrics(input.metrics),
      intervalSeconds: normalizeMonitorInterval(input.intervalSeconds),
      status: normalizeMonitorTargetStatus(input.status),
    });
  }

  async updateMonitorTarget(input: UpdateMonitorTargetInput): Promise<MonitorTargetDto> {
    return this.repository.updateMonitorTarget({
      ...input,
      metrics: input.metrics === undefined ? undefined : normalizeMonitorMetrics(input.metrics),
      intervalSeconds: input.intervalSeconds === undefined ? undefined : normalizeMonitorInterval(input.intervalSeconds),
      status: input.status === undefined ? undefined : normalizeMonitorTargetStatus(input.status),
    });
  }

  async deleteMonitorTarget(tenantId: string, id: string): Promise<MonitorTargetDto> {
    return this.repository.deleteMonitorTarget(tenantId, id);
  }

  async listMonitorProbeResults(query: ListMonitorProbeResultsQuery = {}): Promise<MonitorProbeResultDto[]> {
    return this.repository.listMonitorProbeResults(query);
  }

  async runDueMonitorTargetProbes(input: { maxTargets?: number; now?: string } = {}): Promise<{ checkedCount: number; skippedCount: number; failedCount: number }> {
    const maxTargets = normalizeWorkerLimit(input.maxTargets);
    const now = input.now ? new Date(input.now) : new Date();
    const candidates = await this.repository.listActiveMonitorTargetsForScheduler(maxTargets * 3);
    let checkedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const target of candidates) {
      if (checkedCount >= maxTargets) break;
      const latest = await this.repository.getLatestMonitorProbeResult(target.tenantId, target.id);
      if (!isProbeDue(target, latest, now)) {
        skippedCount += 1;
        continue;
      }

      try {
        await this.probeServiceAsset({
          tenantId: target.tenantId,
          monitorTargetId: target.id,
          serviceAssetId: target.serviceAssetId,
          timeoutMs: 10_000,
        });
        checkedCount += 1;
      } catch {
        failedCount += 1;
      }
    }

    return { checkedCount, skippedCount, failedCount };
  }

  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRuleDto> {
    return this.repository.createAlertRule(this.domain.normalizeCreateAlertRule(input));
  }

  async listAlertRules(tenantId?: string): Promise<AlertRuleDto[]> {
    return this.repository.listAlertRules(tenantId);
  }

  async getDashboard(tenantId?: string): Promise<MonitorDashboardDto> {
    return this.domain.aggregateDashboard(await this.listRiskEvents({ tenantId }));
  }

  async probeServiceAsset(input: ProbeServiceAssetInput): Promise<ProbeServiceAssetResult> {
    const tenantId = input.tenantId ?? tenantFallback;
    const asset = await this.dependencies.assets?.getServiceAsset(tenantId, input.serviceAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '应用资产不存在', { serviceAssetId: input.serviceAssetId });

    const url = buildProbeUrl(asset);
    const timeoutMs = normalizeTimeoutMs(input.timeoutMs);
    const result = await probeFromControlPlane(asset, url, timeoutMs);
    await this.saveCertificateObservationIfChanged(tenantId, result);
    if (input.monitorTargetId) {
      await this.repository.saveMonitorProbeResult({
        tenantId,
        monitorTargetId: input.monitorTargetId,
        result,
      });
    }
    return result;
  }

  async listCertificateObservations(query: import('../dto/monitors.dto.js').ListCertificateObservationsQuery = {}) {
    return this.repository.listCertificateObservations(query);
  }

  getRepository(): MonitorsRepository {
    return this.repository;
  }

  private async saveCertificateObservationIfChanged(tenantId: string | undefined, result: ProbeServiceAssetResult): Promise<void> {
    const certificate = result.certificate;
    const fingerprint = normalizeFingerprint(certificate?.fingerprintSha256);
    if (!certificate || !fingerprint) return;

    const latest = await this.repository.getLatestCertificateObservation(tenantId, result.serviceAssetId);
    if (isUnchangedObservation(latest, fingerprint)) return;

    await this.repository.saveCertificateObservation({
      tenantId,
      serviceAssetId: result.serviceAssetId,
      source: result.source,
      url: result.url,
      observedAt: result.checkedAt,
      fingerprintSha256: fingerprint,
      subject: certificate.subject,
      issuer: certificate.issuer,
      serialNumber: certificate.serialNumber,
      notBefore: certificate.notBefore,
      notAfter: certificate.notAfter,
      dnsNames: certificate.dnsNames,
      verified: certificate.verified,
      verificationError: certificate.verificationError,
      rawResult: { certificate, httpStatus: result.httpStatus, message: result.message },
    });
  }

  private async assertServiceAssetExists(tenantId: string, serviceAssetId: string): Promise<void> {
    const asset = await this.dependencies.assets?.getServiceAsset(tenantId, serviceAssetId);
    if (!asset) throw new AppError('RESOURCE_NOT_FOUND', '应用资产不存在', { serviceAssetId });
  }
}

function allRowsQuery(): PageQuery {
  return { page: 1, pageSize: 200, filter: {} };
}

const tenantFallback = '00000000-0000-0000-0000-000000000000';

type ProbeAsset = {
  id: string;
  address: string;
  port: number;
  protocol: string;
  verifyUrl?: string;
  sniName?: string;
  metadata?: Record<string, unknown>;
  deploymentStrategy?: unknown;
};

function buildProbeUrl(asset: ProbeAsset): string {
  const target = readWorkflowTarget(asset);
  const verifyUrl = readString(asset.verifyUrl) ?? readString(target?.verifyUrl);
  if (verifyUrl) return verifyUrl;
  const protocolText = readString(target?.protocol) ?? asset.protocol;
  const protocol = protocolText.toLowerCase() === 'http' ? 'http' : 'https';
  const defaultPort = protocol === 'https' ? 443 : 80;
  const targetPort = readNumber(target?.port);
  const port = targetPort ?? (Number.isFinite(asset.port) && asset.port > 0 ? asset.port : defaultPort);
  const portText = port === defaultPort ? '' : `:${port}`;
  return `${protocol}://${readProbeHost(asset, target)}${portText}/`;
}

function normalizeTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) return 10_000;
  return Math.min(30_000, Math.max(1_000, Math.trunc(timeoutMs!)));
}

function normalizeMonitorInterval(value: number): number {
  if (!Number.isFinite(value)) return 60;
  return Math.min(3600, Math.max(10, Math.trunc(value)));
}

function normalizeMonitorMetrics(value: MonitorMetric[] | undefined): MonitorMetric[] {
  const normalized = (value ?? [...monitorMetrics]).filter((item): item is MonitorMetric => monitorMetrics.includes(item));
  return normalized.length > 0 ? [...new Set(normalized)] : [...monitorMetrics];
}

function normalizeMonitorTargetStatus(value: MonitorTargetStatus | undefined): MonitorTargetStatus {
  return value && monitorTargetStatuses.includes(value) ? value : 'active';
}

function normalizeWorkerLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(1, Math.trunc(value!)));
}

function isProbeDue(target: MonitorTargetDto, latest: MonitorProbeResultDto | undefined, now: Date): boolean {
  if (!latest) return true;
  const latestCheckedAt = Date.parse(latest.checkedAt);
  if (!Number.isFinite(latestCheckedAt)) return true;
  return now.getTime() - latestCheckedAt >= normalizeMonitorInterval(target.intervalSeconds) * 1000;
}

async function probeFromControlPlane(asset: ProbeAsset, url: string, timeoutMs: number): Promise<ProbeServiceAssetResult> {
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AppError('VALIDATION_FAILED', '监控探测只支持 HTTP/HTTPS URL', { url });
  }
  if (parsed.username || parsed.password) {
    return failedProbeResult(
      asset.id,
      url,
      timeoutMs,
      new Error(`监控 URL 包含用户信息或 @ 字符，实际解析主机为 ${parsed.hostname}；如需探测子域名请使用 ${suggestHostnameWithoutUserInfo(parsed)}`),
      { parsedHost: parsed.hostname, username: parsed.username, invalidUrlUserInfo: true },
    );
  }

  if (parsed.protocol !== 'https:') {
    try {
      return await requestProbe(asset.id, parsed, timeoutMs, { rejectUnauthorized: false });
    } catch (cause) {
      return failedProbeResult(asset.id, url, timeoutMs, cause);
    }
  }

  try {
    return await requestProbe(asset.id, parsed, timeoutMs, {
      rejectUnauthorized: true,
      servername: readTlsServerName(asset, parsed),
    });
  } catch (cause) {
    if (!isTlsCertificateProbeError(cause)) {
      return failedProbeResult(asset.id, url, timeoutMs, cause);
    }

    const verificationError = errorMessage(cause);
    try {
      const insecureResult = await requestProbe(asset.id, parsed, timeoutMs, {
        rejectUnauthorized: false,
        servername: readTlsServerName(asset, parsed),
      });
      const certificateError = insecureResult.certificate?.verificationError || verificationError || '证书不受系统信任';
      return {
        ...insecureResult,
        status: 'WARNING',
        success: true,
        message: `站点可达，但证书存在错误：${certificateError}`,
        detail: {
          ...(insecureResult.detail ?? {}),
          reachable: true,
          tlsVerificationError: certificateError,
        },
      };
    } catch (fallbackCause) {
      return failedProbeResult(asset.id, url, timeoutMs, fallbackCause, {
        strictTlsError: verificationError,
      });
    }
  }
}

function requestProbe(
  serviceAssetId: string,
  parsed: URL,
  timeoutMs: number,
  tls: { rejectUnauthorized: boolean; servername?: string },
): Promise<ProbeServiceAssetResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(parsed, {
      method: 'GET',
      timeout: timeoutMs,
      rejectUnauthorized: tls.rejectUnauthorized,
      servername: tls.servername,
      headers: {
        'user-agent': 'GCAC-MonitorProbe/1.0',
        accept: '*/*',
      },
    }, (response) => {
      const latencyMs = Math.max(1, Date.now() - startedAt);
      const certificate = parsed.protocol === 'https:' ? readPeerCertificate(response.socket) : undefined;
      response.resume();
      response.on('end', () => {
        resolve({
          serviceAssetId,
          source: 'control_plane',
          url: parsed.toString(),
          status: 'READY',
          success: true,
          latencyMs,
          checkedAt,
          message: `平台探测成功，HTTP ${response.statusCode ?? 0}`,
          httpStatus: response.statusCode,
          certificate,
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error(`探测超时：${timeoutMs}ms`));
    });
    request.on('error', (error) => {
      reject(error);
    });
    request.end();
  });
}

function failedProbeResult(
  serviceAssetId: string,
  url: string,
  timeoutMs: number,
  cause: unknown,
  detail: Record<string, unknown> = {},
): ProbeServiceAssetResult {
  const message = errorMessage(cause) || `探测超时：${timeoutMs}ms`;
  return {
    serviceAssetId,
    source: 'control_plane',
    url,
    status: 'ERROR',
    success: false,
    latencyMs: 1,
    checkedAt: new Date().toISOString(),
    message,
    detail,
  };
}

function readTlsServerName(asset: ProbeAsset, parsed: URL): string | undefined {
  const target = readWorkflowTarget(asset);
  const explicit = readString(asset.sniName) ?? readString(target?.sniName) ?? readString(target?.hostHeader);
  if (explicit) return explicit;
  return isIpAddress(parsed.hostname) ? undefined : parsed.hostname;
}

function readProbeHost(asset: ProbeAsset, target: Record<string, unknown> | undefined): string {
  const address = readString(asset.address) ?? '';
  if (address && !address.includes('@')) return address;
  return readString(target?.hostHeader) ?? readString(target?.sniName) ?? address;
}

function readWorkflowTarget(asset: ProbeAsset): Record<string, unknown> | undefined {
  const metadata = readRecord(asset.metadata);
  const storedStrategy = readRecord(metadata?.deploymentStrategy);
  const directStrategy = readRecord(asset.deploymentStrategy);
  return readRecord(metadata?.workflowTarget)
    ?? readRecord(readRecord(storedStrategy?.workflow)?.target)
    ?? readRecord(readRecord(directStrategy?.workflow)?.target);
}

function suggestHostnameWithoutUserInfo(parsed: URL): string {
  const prefix = parsed.username ? `${parsed.username}.` : '';
  return `${parsed.protocol}//${prefix}${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}`;
}

function isIpAddress(value: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) || value.includes(':');
}

function isTlsCertificateProbeError(cause: unknown): boolean {
  const code = typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code?: unknown }).code ?? '') : '';
  if ([
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(code)) return true;

  const message = errorMessage(cause);
  return /certificate|self signed|unable to verify|unable to get issuer|hostname\/IP does not match|altname|cert_|secure TLS connection/i.test(message);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause ?? '');
}

function readPeerCertificate(socket: unknown): ProbeServiceAssetResult['certificate'] | undefined {
  const candidate = socket as { getPeerCertificate?: (detailed?: boolean) => Record<string, unknown>; authorized?: boolean; authorizationError?: unknown };
  const peer = candidate.getPeerCertificate?.(true);
  if (!peer || Object.keys(peer).length === 0) return undefined;
  const raw = peer.raw;
  return {
    fingerprintSha256: Buffer.isBuffer(raw) ? createHash('sha256').update(raw).digest('hex').toUpperCase() : undefined,
    subject: stringifyCertificateName(peer.subject),
    issuer: stringifyCertificateName(peer.issuer),
    serialNumber: readString(peer.serialNumber),
    notBefore: readString(peer.valid_from),
    notAfter: readString(peer.valid_to),
    dnsNames: parseSubjectAltName(readString(peer.subjectaltname)),
    verified: candidate.authorized === true,
    verificationError: candidate.authorizationError ? String(candidate.authorizationError) : undefined,
  };
}

function stringifyCertificateName(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}=${Array.isArray(item) ? item.join('/') : String(item)}`)
    .join(', ');
}

function parseSubjectAltName(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const names = value
    .split(',')
    .map((item) => item.trim().replace(/^DNS:/iu, ''))
    .filter(Boolean);
  return names.length ? names : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeFingerprint(value: string | undefined): string | undefined {
  const normalized = value?.replace(/[^a-f0-9]/giu, '').toUpperCase();
  return normalized ? normalized : undefined;
}

function isUnchangedObservation(
  latest: CertificateObservationDto | undefined,
  fingerprint: string,
): boolean {
  return normalizeFingerprint(latest?.fingerprintSha256) === fingerprint;
}
