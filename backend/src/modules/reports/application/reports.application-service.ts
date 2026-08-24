import { AppError } from '../../../common/errors/app-error.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import { getMetricDefinition, listMetricDefinitions } from '../domain/metric-definition-registry.js';
import {
  calculateRiskTiming,
  incidentWindowMetricKey,
  isAutomationRunTerminal,
  isAutomationTargetDenominator,
  type AutomationRunFact,
  type AutomationRunTargetFact,
  type IncidentCertificateFact,
  type RiskResponseFact,
} from '../domain/report-calculations.js';
import type { ReportItemPage, ReportMetricResult, ReportOverview, ReportQuery, ReportTrendPoint, ReportType } from '../schema/reports.schema.js';
import type { ReportDataPort } from './report-data.port.js';
import { ReportScopeResolver } from './report-scope-resolver.js';
import { ReportsRepository } from '../repository/reports.repository.js';

export class ReportsApplicationService {
  constructor(
    private readonly data: ReportDataPort,
    private readonly snapshots: ReportsRepository,
    private readonly scope = new ReportScopeResolver(),
  ) {}

  async overview(type: ReportType, query: ReportQuery, subject: SecuritySubject): Promise<ReportOverview> {
    const metrics = type === 'incident_window'
      ? await this.incidentMetrics(query, subject)
      : type === 'risk_response'
        ? await this.riskMetrics(query, subject)
        : await this.automationMetrics(query, subject);
    return {
      reportType: type,
      asOf: query.asOf,
      metricVersions: Object.fromEntries(metrics.map((metric) => [metric.metricKey, metric.metricVersion])),
      metrics,
      groups: [],
      warnings: type === 'automation_effectiveness' && metrics.every((item) => item.sampleCount === 0)
        ? ['AUTOMATION_FIXTURE_OR_ADAPTER_REQUIRED']
        : [],
    };
  }

  async trends(type: ReportType, query: ReportQuery): Promise<ReportTrendPoint[]> {
    const definitions = listMetricDefinitions(type);
    const snapshots = await this.snapshots.listSnapshots(query.tenantId, query.dateFrom, query.dateTo, definitions.map((item) => item.key));
    const dates = new Map<string, ReportTrendPoint>();
    for (const snapshot of snapshots.filter((item) => Object.keys(item.dimensions).length === 0)) {
      const point = dates.get(snapshot.snapshotDate) ?? { snapshotDate: snapshot.snapshotDate, metrics: [], complete: true };
      point.metrics.push({ metricKey: snapshot.metricKey, metricVersion: snapshot.metricVersion, value: snapshot.value, sampleCount: snapshot.sampleCount });
      dates.set(snapshot.snapshotDate, point);
    }
    for (const point of dates.values()) point.complete = point.metrics.length === definitions.length;
    return [...dates.values()].sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
  }

  async items(type: ReportType, query: ReportQuery, subject: SecuritySubject, metricKey?: string): Promise<ReportItemPage<unknown>> {
    if (metricKey && getMetricDefinition(metricKey).reportType !== type) throw new AppError('VALIDATION_FAILED', '指标不属于当前报表', { metricKey, type });
    const items = type === 'incident_window'
      ? await this.incidentItems(query, subject, metricKey)
      : type === 'risk_response'
        ? await this.riskItems(query, subject, metricKey)
        : await this.automationItems(query, subject, metricKey);
    const start = (query.page - 1) * query.pageSize;
    return { items: items.slice(start, start + query.pageSize), page: query.page, pageSize: query.pageSize, total: items.length, asOf: query.asOf };
  }

  private async incidentItems(query: ReportQuery, subject: SecuritySubject, metricKey?: string): Promise<IncidentCertificateFact[]> {
    const facts = await this.data.listIncidentCertificates(query);
    const scoped = await this.scope.filter(subject, facts, (item) => ({ objectType: 'certificate', objectId: item.certificateAssetId, tenantId: query.tenantId }));
    return scoped.filter((item) => !metricKey || incidentFactMetrics(item, query.asOf).includes(metricKey));
  }

  private async incidentMetrics(query: ReportQuery, subject: SecuritySubject): Promise<ReportMetricResult[]> {
    const items = await this.incidentItems(query, subject);
    return listMetricDefinitions('incident_window').map((definition) => metricResult(definition.key, items.filter((item) => incidentFactMetrics(item, query.asOf).includes(definition.key)).length));
  }

  private async riskItems(query: ReportQuery, subject: SecuritySubject, metricKey?: string): Promise<Array<RiskResponseFact & { timing: ReturnType<typeof calculateRiskTiming> }>> {
    const facts = await this.data.listRiskResponseFacts(query);
    const scoped = await this.scope.filter(subject, facts, (item) => ({ objectType: 'risk', objectId: item.risk.id, tenantId: item.risk.scope.tenantId ?? query.tenantId }));
    return scoped.map((fact) => ({ ...fact, timing: calculateRiskTiming(fact, query.asOf) })).filter((fact) => !metricKey || riskFactMetrics(fact, query).includes(metricKey));
  }

  private async riskMetrics(query: ReportQuery, subject: SecuritySubject): Promise<ReportMetricResult[]> {
    const facts = await this.riskItems(query, subject);
    const created = facts.filter((item) => inRange(item.risk.firstDetectedAt, query)).length;
    const resolved = facts.filter((item) => item.history.some((history) => history.action === 'resolved' && inRange(history.occurredAt, query))).length;
    const reopened = facts.reduce((sum, item) => sum + item.history.filter((history) => history.action === 'reopened' && inRange(history.occurredAt, query)).length, 0);
    const active = facts.filter((item) => !['RESOLVED', 'IGNORED'].includes(item.risk.status));
    const ackSamples = facts.filter((item) => item.risk.status !== 'IGNORED');
    const resolveSamples = ackSamples;
    return [
      metricResult('risks.created', created), metricResult('risks.resolved', resolved), metricResult('risks.reopened', reopened),
      metricResult('risks.open_end_of_period', active.length),
      metricResult('risks.overdue_acknowledgement', active.filter((item) => !item.timing.acknowledgementComplete && item.timing.acknowledgementSeconds > item.slaPolicy.acknowledgementSeconds).length),
      metricResult('risks.overdue_resolution', active.filter((item) => item.timing.resolutionSeconds > item.slaPolicy.resolutionSeconds).length),
      averageMetric('risks.tta.average_seconds', ackSamples.map((item) => item.timing.acknowledgementSeconds), ackSamples.filter((item) => !item.timing.acknowledgementComplete).length),
      averageMetric('risks.ttr.average_seconds', resolveSamples.map((item) => item.timing.resolutionSeconds), resolveSamples.filter((item) => !item.timing.resolutionComplete).length),
      rateMetric('risks.ack_sla_rate', ackSamples.filter((item) => item.timing.acknowledgementWithinSla).length, ackSamples.length),
      rateMetric('risks.resolve_sla_rate', resolveSamples.filter((item) => item.timing.resolutionWithinSla).length, resolveSamples.length),
    ];
  }

  private async automationItems(query: ReportQuery, subject: SecuritySubject, metricKey?: string): Promise<Array<AutomationRunFact | AutomationRunTargetFact>> {
    const [runs, targets] = await Promise.all([this.data.listAutomationRuns(query), this.data.listAutomationTargets(query)]);
    const scopedRuns = await this.scope.filter(subject, runs, (item) => ({ objectType: 'automation', objectId: item.automationId, tenantId: query.tenantId }));
    const scopedTargets = await this.scope.filter(subject, targets, (item) => ({ objectType: 'automation', objectId: item.automationId, tenantId: query.tenantId }));
    if (!metricKey || metricKey.startsWith('automations.runs.')) return scopedRuns.filter((item) => !metricKey || automationRunMetrics(item).includes(metricKey));
    return scopedTargets.filter((item) => automationTargetMetrics(item).includes(metricKey));
  }

  private async automationMetrics(query: ReportQuery, subject: SecuritySubject): Promise<ReportMetricResult[]> {
    const [runsRaw, targetsRaw] = await Promise.all([this.data.listAutomationRuns(query), this.data.listAutomationTargets(query)]);
    const runs = await this.scope.filter(subject, runsRaw, (item) => ({ objectType: 'automation', objectId: item.automationId, tenantId: query.tenantId }));
    const targets = await this.scope.filter(subject, targetsRaw, (item) => ({ objectType: 'automation', objectId: item.automationId, tenantId: query.tenantId }));
    const terminalRuns = runs.filter((item) => isAutomationRunTerminal(item.status));
    const denominatorTargets = targets.filter((item) => isAutomationTargetDenominator(item.status));
    return [
      metricResult('automations.runs.total', runs.length), rateMetric('automations.runs.success_rate', terminalRuns.filter((item) => item.status === 'succeeded').length, terminalRuns.length),
      metricResult('automations.targets.total', targets.length), rateMetric('automations.targets.success_rate', denominatorTargets.filter((item) => item.status === 'succeeded').length, denominatorTargets.length),
      metricResult('automations.targets.failed', targets.filter((item) => item.status === 'failed').length), metricResult('automations.targets.retried', targets.filter((item) => item.attemptCount > 1).length),
      metricResult('automations.targets.rollback_succeeded', targets.filter((item) => item.rollbackStatus === 'succeeded').length), metricResult('automations.targets.rollback_failed', targets.filter((item) => item.rollbackStatus === 'failed').length),
      metricResult('automations.targets.manual_intervention', targets.filter((item) => item.manualIntervention).length), metricResult('automations.targets.waiting_approval', targets.filter((item) => item.status === 'waiting_approval').length),
    ];
  }
}

function incidentFactMetrics(item: IncidentCertificateFact, asOf: string): string[] {
  const metrics: string[] = [];
  const window = incidentWindowMetricKey(item.notAfter, asOf, item.usageStatus);
  if (window) metrics.push(window);
  if (item.readinessStage === 'missing_replacement') metrics.push('certificates.missing_replacement');
  if (item.readinessStage === 'plan_missing') metrics.push('certificates.missing_deployment_plan');
  if (item.readinessStage === 'waiting_approval') metrics.push('certificates.waiting_approval');
  if (item.readinessStage === 'blocked') metrics.push('certificates.execution_channel_blocked');
  return metrics;
}

function riskFactMetrics(item: RiskResponseFact & { timing: ReturnType<typeof calculateRiskTiming> }, query: ReportQuery): string[] {
  const keys: string[] = [];
  if (inRange(item.risk.firstDetectedAt, query)) keys.push('risks.created');
  if (item.history.some((history) => history.action === 'resolved' && inRange(history.occurredAt, query))) keys.push('risks.resolved');
  if (item.history.some((history) => history.action === 'reopened' && inRange(history.occurredAt, query))) keys.push('risks.reopened');
  if (!['RESOLVED', 'IGNORED'].includes(item.risk.status)) keys.push('risks.open_end_of_period');
  if (!item.timing.acknowledgementComplete && item.timing.acknowledgementSeconds > item.slaPolicy.acknowledgementSeconds) keys.push('risks.overdue_acknowledgement');
  if (!item.timing.resolutionComplete && item.timing.resolutionSeconds > item.slaPolicy.resolutionSeconds) keys.push('risks.overdue_resolution');
  return keys;
}

function automationRunMetrics(item: AutomationRunFact): string[] { return ['automations.runs.total', ...(item.status === 'succeeded' ? ['automations.runs.success_rate'] : [])]; }
function automationTargetMetrics(item: AutomationRunTargetFact): string[] {
  return ['automations.targets.total', ...(item.status === 'succeeded' ? ['automations.targets.success_rate'] : []), ...(item.status === 'failed' ? ['automations.targets.failed'] : []), ...(item.attemptCount > 1 ? ['automations.targets.retried'] : []), ...(item.rollbackStatus === 'succeeded' ? ['automations.targets.rollback_succeeded'] : []), ...(item.rollbackStatus === 'failed' ? ['automations.targets.rollback_failed'] : []), ...(item.manualIntervention ? ['automations.targets.manual_intervention'] : []), ...(item.status === 'waiting_approval' ? ['automations.targets.waiting_approval'] : [])];
}
function metricResult(metricKey: string, value: number): ReportMetricResult { const definition = getMetricDefinition(metricKey); return { metricKey, metricVersion: definition.version, labelKey: `reports.metrics.${metricKey}`, value, sampleCount: value }; }
function averageMetric(metricKey: string, values: number[], incomplete: number): ReportMetricResult { const value = values.length ? Math.round(values.reduce((sum, item) => sum + item, 0) / values.length) : 0; return { ...metricResult(metricKey, value), sampleCount: values.length, incompleteSampleCount: incomplete }; }
function rateMetric(metricKey: string, numerator: number, denominator: number): ReportMetricResult { return { ...metricResult(metricKey, denominator ? numerator / denominator : 0), sampleCount: denominator, numerator, denominator }; }
function inRange(value: string, query: ReportQuery): boolean { const time = Date.parse(value); return time >= Date.parse(query.dateFrom) && time <= Date.parse(query.dateTo); }
