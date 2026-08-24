import { AppError } from '../../../common/errors/app-error.js';
import type { MetricDefinition, ReportType } from '../schema/reports.schema.js';

const certificateDimensions = [
  'environment',
  'owner_id',
  'asset_id',
  'business_system',
  'tag',
  'public_exposure',
  'usage_status',
  'readiness_stage',
] as const;

const riskDimensions = [
  'environment',
  'owner_id',
  'asset_id',
  'business_system',
  'tag',
  'severity',
  'risk_type',
] as const;

const automationDimensions = [
  'environment',
  'owner_id',
  'asset_id',
  'business_system',
  'tag',
  'automation_id',
  'action_type',
  'failure_stage',
] as const;

const definitions = [
  countMetric('certificates.expiring.30d', 'incident_window', 'certificate_asset', '距离过期 16 至 30 天的证书资产数量', certificateDimensions),
  countMetric('certificates.expiring.15d', 'incident_window', 'certificate_asset', '距离过期 8 至 15 天的证书资产数量', certificateDimensions),
  countMetric('certificates.expiring.7d', 'incident_window', 'certificate_asset', '距离过期 4 至 7 天的证书资产数量', certificateDimensions),
  countMetric('certificates.expiring.3d', 'incident_window', 'certificate_asset', '距离过期 2 至 3 天的证书资产数量', certificateDimensions),
  countMetric('certificates.expiring.1d', 'incident_window', 'certificate_asset', '距离过期 0 至 1 天的证书资产数量', certificateDimensions),
  countMetric('certificates.expired.in_use', 'incident_window', 'certificate_asset', '报表截止时间已过期且仍在使用的证书资产数量', certificateDimensions),
  countMetric('certificates.missing_replacement', 'incident_window', 'certificate_asset', '进入 30 天事故窗口且没有可用替换版本的证书资产数量', certificateDimensions),
  countMetric('certificates.missing_deployment_plan', 'incident_window', 'certificate_asset', '进入 15 天事故窗口且没有有效部署计划的证书资产数量', certificateDimensions),
  countMetric('certificates.waiting_approval', 'incident_window', 'certificate_asset', '进入事故窗口且部署计划等待审批的证书资产数量', certificateDimensions),
  countMetric('certificates.execution_channel_blocked', 'incident_window', 'certificate_asset', '进入事故窗口且执行通道不可用的证书资产数量', certificateDimensions),

  eventCountMetric('risks.created', '风险首次发现时间落在统计周期内的风险数量', riskDimensions),
  eventCountMetric('risks.resolved', '风险状态首次进入已解决且发生时间落在统计周期内的风险数量', riskDimensions),
  eventCountMetric('risks.reopened', '风险从已解决重新进入未解决状态且发生时间落在统计周期内的次数', riskDimensions),
  stateCountMetric('risks.open_end_of_period', '统计周期结束时仍未解决且未忽略的风险数量', riskDimensions),
  stateCountMetric('risks.overdue_acknowledgement', '统计截止时间超过确认 SLA 且尚未有效确认的风险数量', riskDimensions),
  stateCountMetric('risks.overdue_resolution', '统计截止时间超过解决 SLA 且尚未解决的风险数量', riskDimensions),
  durationMetric('risks.tta.average_seconds', '风险首次发现到首次有效确认的平均秒数，未确认样本按截止时间计时', riskDimensions),
  durationMetric('risks.ttr.average_seconds', '风险首次发现到解决的平均秒数，未解决样本按截止时间计时', riskDimensions),
  rateMetric(
    'risks.ack_sla_rate',
    'risk_response',
    'risk_event',
    '在确认 SLA 内完成确认的风险比例',
    riskDimensions,
    '在确认 SLA 内首次有效确认的风险数',
    '需要确认且具有有效 SLA 策略的风险数',
    ['IGNORED'],
  ),
  rateMetric(
    'risks.resolve_sla_rate',
    'risk_response',
    'risk_event',
    '在解决 SLA 内完成解决的风险比例',
    riskDimensions,
    '在解决 SLA 内首次解决的风险数',
    '需要解决且具有有效 SLA 策略的风险数',
    ['IGNORED'],
  ),

  countMetric('automations.runs.total', 'automation_effectiveness', 'automation_run', '统计周期内创建的自动化运行数量', automationDimensions, 'event_occurred_in_period'),
  rateMetric(
    'automations.runs.success_rate',
    'automation_effectiveness',
    'automation_run',
    '成功自动化运行占最终完成运行的比例',
    automationDimensions,
    '最终状态为 succeeded 的自动化运行数',
    '最终完成的自动化运行数',
    ['skipped', 'cancelled', 'waiting_approval'],
  ),
  countMetric('automations.targets.total', 'automation_effectiveness', 'automation_run_target', '统计周期内进入自动化运行的目标数量', automationDimensions, 'event_occurred_in_period'),
  rateMetric(
    'automations.targets.success_rate',
    'automation_effectiveness',
    'automation_run_target',
    '成功自动化目标占最终完成且可执行目标的比例',
    automationDimensions,
    '最终状态为 succeeded 的可执行目标数',
    '最终完成的可执行目标数',
    ['skipped', 'cancelled', 'waiting_approval'],
  ),
  countMetric('automations.targets.failed', 'automation_effectiveness', 'automation_run_target', '最终失败的自动化目标数量，重试尝试不重复计数', automationDimensions, 'event_occurred_in_period'),
  countMetric('automations.targets.retried', 'automation_effectiveness', 'automation_run_target', '发生过重试的自动化目标数量', automationDimensions, 'event_occurred_in_period'),
  countMetric('automations.targets.rollback_succeeded', 'automation_effectiveness', 'automation_run_target', '回滚成功的自动化目标数量', automationDimensions, 'event_occurred_in_period'),
  countMetric('automations.targets.rollback_failed', 'automation_effectiveness', 'automation_run_target', '回滚失败的自动化目标数量', automationDimensions, 'event_occurred_in_period'),
  countMetric('automations.targets.manual_intervention', 'automation_effectiveness', 'automation_run_target', '需要人工介入的自动化目标数量', automationDimensions, 'event_occurred_in_period'),
  countMetric('automations.targets.waiting_approval', 'automation_effectiveness', 'automation_run_target', '等待审批的自动化目标数量，不进入成功率分母', automationDimensions, 'state_at_period_end'),
] as const satisfies readonly MetricDefinition[];

const registry = new Map(definitions.map((definition) => [definition.key, definition]));

export const metricDefinitions: readonly MetricDefinition[] = definitions;

export function getMetricDefinition(metricKey: string): MetricDefinition {
  const definition = registry.get(metricKey);
  if (!definition) {
    throw new AppError('RESOURCE_NOT_FOUND', `未找到报表指标：${metricKey}`, { metricKey });
  }
  return definition;
}

export function listMetricDefinitions(reportType?: ReportType): readonly MetricDefinition[] {
  return reportType ? definitions.filter((definition) => definition.reportType === reportType) : definitions;
}

function countMetric(
  key: string,
  reportType: ReportType,
  objectType: MetricDefinition['objectType'],
  description: string,
  dimensions: MetricDefinition['dimensions'],
  timeSemantic: MetricDefinition['timeSemantic'] = 'as_of',
): MetricDefinition {
  return { key, version: 1, reportType, valueType: 'count', objectType, timeSemantic, description, dimensions };
}

function eventCountMetric(key: string, description: string, dimensions: MetricDefinition['dimensions']): MetricDefinition {
  return countMetric(key, 'risk_response', 'risk_event', description, dimensions, 'event_occurred_in_period');
}

function stateCountMetric(key: string, description: string, dimensions: MetricDefinition['dimensions']): MetricDefinition {
  return countMetric(key, 'risk_response', 'risk_event', description, dimensions, 'state_at_period_end');
}

function durationMetric(key: string, description: string, dimensions: MetricDefinition['dimensions']): MetricDefinition {
  return {
    key,
    version: 1,
    reportType: 'risk_response',
    valueType: 'duration_seconds',
    objectType: 'risk_event',
    timeSemantic: 'event_occurred_in_period',
    description,
    dimensions,
  };
}

function rateMetric(
  key: string,
  reportType: ReportType,
  objectType: MetricDefinition['objectType'],
  description: string,
  dimensions: MetricDefinition['dimensions'],
  numerator: string,
  denominator: string,
  excludedStatuses: readonly string[],
): MetricDefinition {
  return {
    key,
    version: 1,
    reportType,
    valueType: 'rate',
    objectType,
    timeSemantic: 'event_occurred_in_period',
    description,
    dimensions,
    ratio: { numerator, denominator, excludedStatuses },
  };
}
