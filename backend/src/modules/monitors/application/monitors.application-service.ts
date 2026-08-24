import { createHash } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { AppError } from '../../../common/errors/app-error.js';
import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { AssetsRepository } from '../../assets/repository/assets.repository.js';
import type { CertificateBindingDto } from '../../bindings/dto/bindings.dto.js';
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
  CertificateChainCertificate,
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
    // 中文说明：先用已持久化的最新观测恢复状态，再生成本轮风险，避免扫描把已恢复的漂移重新写成活动风险。
    await this.reconcileMonitorCertificateRisks({
      tenantId: input.tenantId,
      occurredAt: detectedAt,
    });

    for (const version of certificates.items) {
      const asset = await this.dependencies.certificates.getAsset(version.certificateAssetId);
      if (!asset || asset.status !== 'active' || version.status !== 'active') continue;
      const risk = this.domain.buildCertificateRiskEvent(asset, version, detectedAt, thresholdDays);
      if (!risk) continue;
      risk.scope.tenantId = input.tenantId;
      createdOrUpdated.push(await this.repository.upsertRiskEvent(risk));
    }

    const bindings = await this.dependencies.bindings.listCertificateBindings(input.tenantId ?? tenantFallback, allRowsQuery());
    const unknownCertificateBindingIds = new Set<string>();
    for (const binding of bindings.items) {
      const risk = this.domain.buildBindingRiskEvent(binding);
      if (!risk) continue;
      if (risk.type === 'binding_unknown_certificate') unknownCertificateBindingIds.add(binding.id);
      risk.detectedAt = detectedAt;
      risk.scope.tenantId = binding.tenantId;
      createdOrUpdated.push(await this.repository.upsertRiskEvent(risk));
    }
    await this.resolveClearedBindingMappingRisks(
      input.tenantId ?? tenantFallback,
      unknownCertificateBindingIds,
      detectedAt,
    );

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
    // 中文说明：风险恢复使用已有最新观测，必须独立于本轮是否执行实际探测。
    await this.reconcileMonitorCertificateRisks({ occurredAt: now.toISOString() });
    const candidates = await this.repository.listActiveMonitorTargetsForScheduler(maxTargets * 3);
    let checkedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const target of candidates) {
      const latest = await this.repository.getLatestMonitorProbeResult(target.tenantId, target.id);

      try {
        if (checkedCount >= maxTargets) continue;
        if (!isProbeDue(target, latest, now)) {
          skippedCount += 1;
          continue;
        }

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
    const probeResult = await probeFromControlPlane(asset, url, timeoutMs);
    await this.saveCertificateObservationIfChanged(tenantId, probeResult);
    await this.reconcileMonitorCertificateApplication(tenantId, probeResult);
    await this.reconcileMonitorTlsRisk(tenantId, asset.address, probeResult);
    const result = await this.applyActiveAssetRisksToProbeResult(tenantId, probeResult);
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
    if (isUnchangedObservation(latest, fingerprint, certificate)) return;

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
      chain: certificate.chain,
      chainStatus: certificate.chainStatus,
      rawResult: { certificate, httpStatus: result.httpStatus, message: result.message },
    });
  }

  private async resolveClearedBindingMappingRisks(
    tenantId: string,
    unknownCertificateBindingIds: ReadonlySet<string>,
    occurredAt: string,
  ): Promise<void> {
    const risks = await this.repository.listRiskEvents({ tenantId });
    for (const risk of risks) {
      const bindingId = risk.scope.bindingId;
      if (
        risk.type !== 'binding_unknown_certificate'
        || !bindingId
        || unknownCertificateBindingIds.has(bindingId)
        || !['OPEN', 'ACKED'].includes(risk.status)
      ) continue;
      await this.repository.changeRiskStatus({
        tenantId,
        riskEventId: risk.id,
        action: 'resolved',
        reason: '绑定已具备证书映射或已不在当前监控范围',
        actorType: 'system',
        occurredAt,
        metadata: { trigger: 'binding_mapping_reconciled', bindingId },
      });
    }
  }

  private async reconcileMonitorTlsRisk(
    tenantId: string | undefined,
    domainName: string,
    result: ProbeServiceAssetResult,
  ): Promise<void> {
    const verificationError = result.certificate?.verificationError;
    const detailVerificationError = readString(result.detail?.tlsVerificationError);
    if (result.certificate?.verified === false || verificationError || detailVerificationError) {
      const event = this.domain.buildMonitorTlsProbeRiskEvent({
        tenantId,
        serviceAssetId: result.serviceAssetId,
        domainName,
        url: result.url,
        verificationError: verificationError || detailVerificationError || 'UNKNOWN_TLS_VERIFICATION_ERROR',
        checkedAt: result.checkedAt,
      });
      if (event) await this.repository.upsertRiskEvent(event);
      return;
    }

    const risks = await this.repository.listRiskEvents({ tenantId });
    for (const risk of risks) {
      if (
        risk.type !== 'tls_chain_invalid'
        || risk.source !== 'monitor'
        || risk.scope.serviceAssetId !== result.serviceAssetId
        || !['OPEN', 'ACKED'].includes(risk.status)
      ) continue;
      await this.repository.changeRiskStatus({
        tenantId: tenantId ?? tenantFallback,
        riskEventId: risk.id,
        action: 'resolved',
        reason: '最新系统探测已通过证书链验证',
        actorType: 'system',
        occurredAt: result.checkedAt,
        metadata: { trigger: 'monitor_tls_chain_recovered', serviceAssetId: result.serviceAssetId },
      });
    }
  }

  private async reconcileMonitorCertificateApplication(
    tenantId: string,
    result: Pick<ProbeServiceAssetResult, 'serviceAssetId' | 'checkedAt' | 'certificate'>,
  ): Promise<void> {
    const observedFingerprint = normalizeFingerprint(result.certificate?.fingerprintSha256);
    if (!observedFingerprint) return;

    const bindings = (await this.dependencies.bindings.listCertificateBindings(tenantId, allRowsQuery())).items
      .filter((binding) => binding.serviceAssetId === result.serviceAssetId);

    const matchedBindingIds = new Set<string>();
    for (const binding of bindings) {
      const expectedFingerprints = await this.latestBindingFingerprints(binding);
      if (!expectedFingerprints.has(observedFingerprint)) continue;

      matchedBindingIds.add(binding.id);
      const shouldUpdateBinding = normalizeFingerprint(binding.observedFingerprintSha256) !== observedFingerprint
        || binding.driftStatus !== 'synced'
        || binding.status === 'DRIFTED';
      if (!shouldUpdateBinding) continue;

      await this.dependencies.bindings.updateCertificateBinding(tenantId, binding.id, {
        observedFingerprintSha256: observedFingerprint,
        lastVerifiedAt: result.checkedAt,
        driftStatus: 'synced',
        ...(binding.status === 'DRIFTED' ? { status: 'MANAGED' } : {}),
      });
    }

    const risks = await this.repository.listRiskEvents({ tenantId });
    for (const risk of risks) {
      if (
        !isCertificateApplicationRisk(risk)
        || !['OPEN', 'ACKED'].includes(risk.status)
        || risk.scope.serviceAssetId !== result.serviceAssetId
      ) continue;

      const riskExpectedFingerprint = await this.latestRiskExpectedFingerprint(risk);
      const matchedRiskBinding = risk.scope.bindingId !== undefined
        && matchedBindingIds.has(risk.scope.bindingId);
      const matchedRiskFingerprint = riskExpectedFingerprint === observedFingerprint;
      if (
        (risk.scope.bindingId !== undefined && !matchedRiskBinding)
        || (risk.scope.bindingId === undefined && !matchedRiskFingerprint)
      ) continue;

      await this.repository.changeRiskStatus({
        tenantId,
        riskEventId: risk.id,
        action: 'resolved',
        reason: '最新系统探测已确认站点使用证书最新版本',
        actorType: 'system',
        occurredAt: result.checkedAt,
        metadata: {
          trigger: 'monitor_certificate_application_recovered',
          serviceAssetId: result.serviceAssetId,
          observedFingerprintSha256: observedFingerprint,
        },
      });
    }
  }

  private async reconcileMonitorCertificateRisks(input: {
    tenantId?: string;
    serviceAssetIds?: readonly string[];
    occurredAt: string;
  }): Promise<void> {
    const risks = await this.repository.listRiskEvents({ tenantId: input.tenantId });
    const requestedServiceAssetIds = input.serviceAssetIds
      ? new Set(input.serviceAssetIds.filter(Boolean))
      : undefined;
    const groupedTargets = new Map<string, Set<string>>();
    for (const risk of risks) {
      const serviceAssetId = risk.scope.serviceAssetId;
      if (!serviceAssetId || (requestedServiceAssetIds && !requestedServiceAssetIds.has(serviceAssetId))) continue;
      const tenantId = risk.scope.tenantId ?? input.tenantId ?? tenantFallback;
      const serviceAssetIds = groupedTargets.get(tenantId) ?? new Set<string>();
      serviceAssetIds.add(serviceAssetId);
      groupedTargets.set(tenantId, serviceAssetIds);
    }

    for (const [tenantId, serviceAssetIds] of groupedTargets) {
      for (const serviceAssetId of serviceAssetIds) {
        const observation = await this.repository.getLatestCertificateObservation(tenantId, serviceAssetId);
        if (!observation) continue;
        await this.reconcileMonitorCertificateApplication(tenantId, {
          serviceAssetId,
          checkedAt: observation.observedAt || input.occurredAt,
          certificate: observation,
        });
      }
    }
  }

  private async latestRiskExpectedFingerprint(risk: RiskEvent): Promise<string | undefined> {
    const metadataFingerprint = normalizeFingerprint(
      readString(risk.metadata.latestFingerprintSha256)
        ?? readString(risk.metadata.desiredFingerprintSha256)
        ?? readString(risk.metadata.targetFingerprintSha256),
    );
    if (metadataFingerprint) return metadataFingerprint;

    const versionId = risk.scope.certificateVersionId
      ?? readString(risk.metadata.latestCertificateVersionId)
      ?? readString(risk.metadata.certificateVersionId);
    if (!versionId) return undefined;

    const version = await this.dependencies.certificates.getVersion(versionId);
    if (!version) return undefined;
    const asset = await this.dependencies.certificates.getAsset(version.certificateAssetId);
    const latestVersion = asset?.currentVersionId
      ? await this.dependencies.certificates.getVersion(asset.currentVersionId)
      : (await this.dependencies.certificates.listVersionsByAsset(version.certificateAssetId))
        .sort((left, right) => right.versionNo - left.versionNo)[0];
    return normalizeFingerprint(latestVersion?.fingerprintSha256);
  }

  private async latestBindingFingerprints(binding: CertificateBindingDto): Promise<Set<string>> {
    const fingerprints = new Set<string>();
    const versionIds = [...new Set([
      binding.certificateVersionId,
      binding.targetCertificateVersionId,
      binding.localCertificateVersionId,
    ].filter((value): value is string => Boolean(value)))];
    let resolvedVersionFingerprint = false;
    for (const versionId of versionIds) {
      const version = await this.dependencies.certificates.getVersion(versionId);
      if (!version) continue;
      const asset = await this.dependencies.certificates.getAsset(version.certificateAssetId);
      const latestVersion = asset?.currentVersionId
        ? await this.dependencies.certificates.getVersion(asset.currentVersionId)
        : (await this.dependencies.certificates.listVersionsByAsset(version.certificateAssetId))
          .sort((left, right) => right.versionNo - left.versionNo)[0];
      const fingerprint = normalizeFingerprint(latestVersion?.fingerprintSha256);
      if (!fingerprint) continue;
      resolvedVersionFingerprint = true;
      fingerprints.add(fingerprint);
    }

    if (!resolvedVersionFingerprint) {
      for (const value of [binding.desiredFingerprintSha256, binding.targetFingerprintSha256]) {
        const fingerprint = normalizeFingerprint(value);
        if (fingerprint) fingerprints.add(fingerprint);
      }
    }
    return fingerprints;
  }

  private async applyActiveAssetRisksToProbeResult(
    tenantId: string,
    result: ProbeServiceAssetResult,
  ): Promise<ProbeServiceAssetResult> {
    if (result.status === 'ERROR') return result;
    const activeRisks = (await this.repository.listRiskEvents({ tenantId }))
      .filter((risk) => risk.scope.serviceAssetId === result.serviceAssetId)
      .filter((risk) => ['OPEN', 'ACKED'].includes(risk.status));
    if (activeRisks.length === 0) return result;

    const summaries = [...new Set(activeRisks.map((risk) => risk.summary).filter(Boolean))];
    return {
      ...result,
      status: 'WARNING',
      message: summaries.length > 0 ? `${result.message}；存在监控警告：${summaries.join('；')}` : result.message,
      detail: {
        ...(result.detail ?? {}),
        activeRiskIds: activeRisks.map((risk) => risk.id),
        activeRiskTypes: [...new Set(activeRisks.map((risk) => risk.type))],
        warningSummaries: summaries,
      },
    };
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
      return await requestProbe(asset.id, parsed, timeoutMs, { rejectUnauthorized: false }, resolveTrustRoots(asset));
    } catch (cause) {
      return failedProbeResult(asset.id, url, timeoutMs, cause);
    }
  }

  try {
    return await requestProbe(asset.id, parsed, timeoutMs, {
      rejectUnauthorized: true,
      servername: readTlsServerName(asset, parsed),
    }, resolveTrustRoots(asset));
  } catch (cause) {
    if (!isTlsCertificateProbeError(cause)) {
      return failedProbeResult(asset.id, url, timeoutMs, cause);
    }

    const verificationError = errorMessage(cause);
    try {
      const insecureResult = await requestProbe(asset.id, parsed, timeoutMs, {
        rejectUnauthorized: false,
        servername: readTlsServerName(asset, parsed),
      }, resolveTrustRoots(asset));
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
  trustRoots: readonly string[],
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
      const certificate = parsed.protocol === 'https:' ? readPeerCertificate(response.socket, trustRoots) : undefined;
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

function readPeerCertificate(socket: unknown, trustRoots: readonly string[]): ProbeServiceAssetResult['certificate'] | undefined {
  const candidate = socket as { getPeerCertificate?: (detailed?: boolean) => Record<string, unknown>; authorized?: boolean; authorizationError?: unknown };
  const peer = candidate.getPeerCertificate?.(true);
  if (!peer || Object.keys(peer).length === 0) return undefined;
  const raw = peer.raw;
  const servedChain = readPeerCertificateChain(peer);
  const chainValidation = validateServedCertificateChain(servedChain, trustRoots);
  return {
    fingerprintSha256: Buffer.isBuffer(raw) ? createHash('sha256').update(raw).digest('hex').toUpperCase() : undefined,
    subject: stringifyCertificateName(peer.subject),
    issuer: stringifyCertificateName(peer.issuer),
    serialNumber: readString(peer.serialNumber),
    notBefore: readString(peer.valid_from),
    notAfter: readString(peer.valid_to),
    dnsNames: parseSubjectAltName(readString(peer.subjectaltname)),
    verified: chainValidation.verified && candidate.authorized === true,
    verificationError: chainValidation.error ?? (candidate.authorizationError ? String(candidate.authorizationError) : undefined),
    chain: chainValidation.chain,
    chainStatus: chainValidation.status,
  };
}

function resolveTrustRoots(asset: ProbeAsset): string[] {
  const configured = readString(readRecord(asset.metadata)?.tlsTrustStorePem);
  if (!configured) return [...tls.rootCertificates];
  return configured.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
}

type PeerCertificateRecord = Record<string, unknown> & { issuerCertificate?: PeerCertificateRecord };

function readPeerCertificateChain(peer: Record<string, unknown>): PeerCertificateRecord[] {
  const chain: PeerCertificateRecord[] = [];
  const seen = new Set<string>();
  let current: PeerCertificateRecord | undefined = peer as PeerCertificateRecord;
  while (current) {
    const raw = current.raw;
    const fingerprint = Buffer.isBuffer(raw) ? createHash('sha256').update(raw).digest('hex').toUpperCase() : '';
    if (!fingerprint || seen.has(fingerprint)) break;
    seen.add(fingerprint);
    chain.push(current);
    current = current.issuerCertificate;
  }
  return chain;
}

function validateServedCertificateChain(
  served: PeerCertificateRecord[],
  trustRoots: readonly string[],
): { verified: boolean; status: 'valid' | 'incomplete' | 'invalid' | 'untrusted'; error?: string; chain: NonNullable<ProbeServiceAssetResult['certificate']>['chain'] } {
  const chain = served.map(toChainCertificate);
  if (served.length === 0) return { verified: false, status: 'incomplete', error: '未收到服务端证书链', chain };

  const trustAnchors = trustRoots.map((pem) => new X509Certificate(pem));
  for (let index = 0; index < served.length; index += 1) {
    const current = toX509Certificate(served[index]!);
    if (current.subject === current.issuer) {
      const trusted = trustAnchors.some((root) => normalizeFingerprint(root.fingerprint256) === normalizeFingerprint(current.fingerprint256));
      return current.verify(current.publicKey)
        ? { verified: trusted, status: trusted ? 'valid' : 'untrusted', error: trusted ? undefined : '服务端根证书不在指定信任库中', chain }
        : { verified: false, status: 'invalid', error: `证书自签名校验失败：${current.subject}`, chain };
    }

    const next = served[index + 1];
    if (!next) return { verified: false, status: 'incomplete', error: `服务端未发送签发者证书：${current.issuer}`, chain };
    const issuer = toX509Certificate(next);
    if (current.issuer !== issuer.subject) return { verified: false, status: 'invalid', error: `证书链签发者不匹配：${current.subject}`, chain };
    if (!current.verify(issuer.publicKey)) return { verified: false, status: 'invalid', error: `证书签名校验失败：${current.subject}`, chain };
    if (index === served.length - 2) {
      const trusted = trustAnchors.some((root) => currentIssuerMatchesTrustAnchor(issuer, root));
      return { verified: trusted, status: trusted ? 'valid' : 'untrusted', error: trusted ? undefined : '服务端链未连接到指定信任库中的根证书', chain };
    }
  }
  return { verified: false, status: 'incomplete', error: '服务端证书链未到达指定信任锚', chain };
}

function currentIssuerMatchesTrustAnchor(certificate: X509Certificate, trustAnchor: X509Certificate): boolean {
  return certificate.issuer === trustAnchor.subject && certificate.verify(trustAnchor.publicKey);
}

function toX509Certificate(value: PeerCertificateRecord): X509Certificate {
  if (!Buffer.isBuffer(value.raw)) throw new Error('TLS 对端证书缺少 DER 内容');
  return new X509Certificate(value.raw);
}

function toChainCertificate(value: PeerCertificateRecord): CertificateChainCertificate {
  const certificate = toX509Certificate(value);
  return {
    fingerprintSha256: normalizeFingerprint(certificate.fingerprint256) ?? '',
    subject: stringifyCertificateName(value.subject),
    issuer: stringifyCertificateName(value.issuer),
    serialNumber: readString(value.serialNumber),
    notBefore: readString(value.valid_from),
    notAfter: readString(value.valid_to),
    isCa: certificate.ca,
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

function isCertificateApplicationRisk(risk: RiskEvent): boolean {
  if (risk.type === 'binding_drift' || risk.type === 'tls_fingerprint_mismatch') return true;
  if (risk.type === 'certificate_update_pending') return true;
  if (risk.type !== 'certificate_expiring') return false;
  if (risk.metadata.applicationMismatch === true) return true;
  const text = `${risk.title} ${risk.summary}`.toLowerCase();
  return ['最新版本', '未应用', '未切换', '未生效'].some((marker) => text.includes(marker));
}

function isUnchangedObservation(
  latest: CertificateObservationDto | undefined,
  fingerprint: string,
  certificate: NonNullable<ProbeServiceAssetResult['certificate']>,
): boolean {
  return normalizeFingerprint(latest?.fingerprintSha256) === fingerprint
    && latest?.verified === certificate.verified
    && (latest?.verificationError ?? '') === (certificate.verificationError ?? '')
    && JSON.stringify(latest?.chain ?? []) === JSON.stringify(certificate.chain ?? [])
    && (latest?.chainStatus ?? '') === (certificate.chainStatus ?? '');
}
