import type { PageQuery } from '../../../common/pagination/pagination.js';
import type { BindingsRepository } from '../../bindings/repository/bindings.repository.js';
import type { CertificatesRepository } from '../../certificates/repository/certificates.repository.js';
import type { ExecutionsRepository } from '../../executions/repository/executions.repository.js';
import type {
  AlertRuleDto,
  CollectMonitorRisksInput,
  CreateAlertRuleInput,
  ListRiskEventsQuery,
  MonitorDashboardDto,
  RiskEventDto,
} from '../dto/monitors.dto.js';
import { MonitorsDomainService } from '../domain/monitors.domain-service.js';
import type { AlertRule, RiskEvent } from '../schema/monitors.schema.js';
import { AlertDispatcher } from './alert-dispatcher.js';
import { MonitoringScheduler } from './monitoring-scheduler.js';
import { PgMonitorsRepository, type MonitorsRepository } from '../repository/monitors.repository.js';

export interface MonitorsApplicationDependencies {
  repository?: MonitorsRepository;
  domain?: MonitorsDomainService;
  certificates: CertificatesRepository;
  bindings: BindingsRepository;
  executions: ExecutionsRepository;
}

export class MonitorsApplicationService {
  private readonly repository: MonitorsRepository;
  private readonly domain: MonitorsDomainService;
  private readonly scheduler = new MonitoringScheduler();
  private readonly alertDispatcher = new AlertDispatcher();

  constructor(private readonly dependencies: MonitorsApplicationDependencies) {
    this.repository = dependencies.repository ?? new PgMonitorsRepository();
    this.domain = dependencies.domain ?? new MonitorsDomainService();
  }

  async collectRisks(input: CollectMonitorRisksInput = {}): Promise<{ risks: RiskEventDto[]; dashboard: MonitorDashboardDto; matchedRuleIds: string[]; alertDispatches: ReturnType<AlertDispatcher['buildDispatches']> }> {
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
      alertDispatches: this.alertDispatcher.buildDispatches(matchedRuleIds),
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

  async createAlertRule(input: CreateAlertRuleInput): Promise<AlertRuleDto> {
    return this.repository.createAlertRule(this.domain.normalizeCreateAlertRule(input));
  }

  async listAlertRules(tenantId?: string): Promise<AlertRuleDto[]> {
    return this.repository.listAlertRules(tenantId);
  }

  async getDashboard(tenantId?: string): Promise<MonitorDashboardDto> {
    return this.domain.aggregateDashboard(await this.listRiskEvents({ tenantId }));
  }

  getRepository(): MonitorsRepository {
    return this.repository;
  }
}

function allRowsQuery(): PageQuery {
  return { page: 1, pageSize: 200, filter: {} };
}

const tenantFallback = '00000000-0000-0000-0000-000000000000';
