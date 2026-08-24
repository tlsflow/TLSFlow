import assert from 'node:assert/strict';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import type { ReportDataPort } from './application/report-data.port.js';
import { ReportsApplicationService } from './application/reports.application-service.js';
import type { AutomationRunFact, AutomationRunTargetFact, IncidentCertificateFact, RiskResponseFact } from './domain/report-calculations.js';
import { ReportsRepository } from './repository/reports.repository.js';
import type { ReportQuery } from './schema/reports.schema.js';

const query: ReportQuery = { tenantId: 'tenant_1', dateFrom: '2026-07-01T00:00:00Z', dateTo: '2026-07-21T23:59:59Z', asOf: '2026-07-21T12:00:00Z', page: 1, pageSize: 100 };
const subject: SecuritySubject = { id: 'user_1', type: 'user', scope: { tenantId: 'tenant_1' } };

test('事故窗口区分在用、闲置和未知且摘要与下钻一致', async () => {
  const service = await createService({ incidents: [
    certificate('in_use', '2026-07-20T00:00:00Z'),
    certificate('idle', '2026-07-25T00:00:00Z'),
    certificate('unknown', '2026-08-05T00:00:00Z'),
  ] });
  const overview = await service.overview('incident_window', query, subject);
  const expired = overview.metrics.find((item) => item.metricKey === 'certificates.expired.in_use');
  const items = await service.items('incident_window', query, subject, 'certificates.expired.in_use');
  assert.equal(expired?.value, 1);
  assert.equal(items.total, 1);
  assert.equal(groupTotal(overview, 'usage_status'), 3);
  assert.equal(groupCount(overview, 'usage_status', 'in_use'), 1);
  assert.equal(groupCount(overview, 'usage_status', 'idle'), 1);
  assert.equal(groupCount(overview, 'usage_status', 'unknown'), 1);
});

test('风险报表使用历史计算 TTA/TTR、未完成样本、reopen 和 SLA', async () => {
  const service = await createService({ risks: [
    riskFact('risk_done', 'RESOLVED', ['acknowledged', 'resolved']),
    riskFact('risk_open', 'OPEN', []),
    riskFact('risk_reopen', 'OPEN', ['resolved', 'reopened']),
  ] });
  const overview = await service.overview('risk_response', query, subject);
  assert.equal(metric(overview, 'risks.reopened').value, 1);
  assert.equal(metric(overview, 'risks.open_end_of_period').value, 2);
  assert.equal(metric(overview, 'risks.tta.average_seconds').sampleCount, 3);
  assert.equal(metric(overview, 'risks.tta.average_seconds').incompleteSampleCount, 2);
  assert.equal((await service.items('risk_response', query, subject, 'risks.reopened')).total, 1);
  assert.equal(groupTotal(overview, 'severity'), 3);
});

test('自动化运行级和目标级成功率独立，排除等待审批、跳过和取消', async () => {
  const runs: AutomationRunFact[] = [run('run_ok', 'succeeded'), run('run_fail', 'failed'), run('run_wait', 'waiting_approval'), run('run_cancel', 'cancelled')];
  const targets: AutomationRunTargetFact[] = [
    target('target_ok', 'succeeded'), target('target_fail', 'failed', { failureStage: 'verification' }),
    target('target_retry', 'succeeded', { attemptCount: 2 }), target('target_wait', 'waiting_approval'),
    target('target_skip', 'skipped'), target('target_cancel', 'cancelled'),
    target('target_rollback_fail', 'failed', { failureStage: 'rollback', rollbackStatus: 'failed', manualIntervention: true }),
    target('target_notification', 'failed', { actionType: 'send_notification', failureStage: 'notification' }),
  ];
  const service = await createService({ runs, targets });
  const overview = await service.overview('automation_effectiveness', query, subject);
  assert.equal(metric(overview, 'automations.runs.success_rate').value, 0.5);
  assert.equal(metric(overview, 'automations.targets.success_rate').value, 2 / 5);
  assert.equal(metric(overview, 'automations.targets.retried').value, 1);
  assert.equal(metric(overview, 'automations.targets.rollback_failed').value, 1);
  assert.equal((await service.items('automation_effectiveness', query, subject, 'automations.targets.failed')).total, 3);
  assert.equal(groupTotal(overview, 'action_type'), targets.length);
  assert.equal(groupCount(overview, 'failure_stage', 'notification'), 1);
});

test('四种查询路径使用相同租户 Scope', async () => {
  const foreign = { ...certificate('in_use', '2026-07-20T00:00:00Z'), certificateAssetId: 'foreign' };
  const service = await createService({ incidents: [foreign] });
  const denied = { ...subject, scope: { tenantId: 'tenant_2' } };
  assert.equal(metric(await service.overview('incident_window', query, denied), 'certificates.expired.in_use').value, 0);
  assert.equal((await service.items('incident_window', query, denied, 'certificates.expired.in_use')).total, 0);
});

test('常用维度筛选同时约束摘要、分组和下钻', async () => {
  const incidents: IncidentCertificateFact[] = [
    { ...certificate('in_use', '2026-07-20T00:00:00Z'), environment: 'prod', ownerId: 'owner_1', tags: ['critical'] },
    { ...certificate('idle', '2026-07-25T00:00:00Z'), environment: 'test', ownerId: 'owner_2', tags: ['normal'] },
  ];
  const service = await createService({ incidents });
  const filteredQuery = { ...query, environment: 'prod', ownerId: 'owner_1', tag: 'critical' };
  const overview = await service.overview('incident_window', filteredQuery, subject);

  assert.equal(metric(overview, 'certificates.expired.in_use').value, 1);
  assert.equal(groupTotal(overview, 'usage_status'), 1);
  assert.equal((await service.items('incident_window', filteredQuery, subject)).total, 1);
});

test('风险和自动化专用筛选不会污染其他样本', async () => {
  const risks = [
    riskFact('risk_critical', 'OPEN', []),
    { ...riskFact('risk_high', 'OPEN', []), risk: { ...riskFact('risk_high', 'OPEN', []).risk, severity: 'high' as const } },
  ];
  const targets = [
    target('target_verify', 'failed', { automationId: 'auto_1', failureStage: 'verification' }),
    target('target_notify', 'failed', { automationId: 'auto_2', actionType: 'send_notification', failureStage: 'notification' }),
  ];
  const runs = [run('run_verify', 'failed'), { ...run('run_notify', 'failed'), id: 'run_notify', automationId: 'auto_2' }];
  targets[0]!.runId = 'run_verify';
  targets[1]!.runId = 'run_notify';
  const service = await createService({ risks, runs, targets });

  const riskOverview = await service.overview('risk_response', { ...query, severity: 'critical' }, subject);
  assert.equal(metric(riskOverview, 'risks.open_end_of_period').value, 1);

  const automationQuery = { ...query, automationId: 'auto_2', failureStage: 'notification' as const };
  const automationOverview = await service.overview('automation_effectiveness', automationQuery, subject);
  assert.equal(metric(automationOverview, 'automations.runs.total').value, 1);
  assert.equal(metric(automationOverview, 'automations.targets.failed').value, 1);
  assert.equal((await service.items('automation_effectiveness', automationQuery, subject, 'automations.targets.failed')).total, 1);
});

async function createService(fixtures: { incidents?: IncidentCertificateFact[]; risks?: RiskResponseFact[]; runs?: AutomationRunFact[]; targets?: AutomationRunTargetFact[] }) {
  const db = new PgliteDatabase(); await runMigrations(db);
  const port: ReportDataPort = {
    async listIncidentCertificates() { return fixtures.incidents ?? []; },
    async listRiskResponseFacts() { return fixtures.risks ?? []; },
    async listAutomationRuns() { return fixtures.runs ?? []; },
    async listAutomationTargets() { return fixtures.targets ?? []; },
  };
  return new ReportsApplicationService(port, new ReportsRepository(db));
}

function certificate(usageStatus: IncidentCertificateFact['usageStatus'], notAfter: string): IncidentCertificateFact { return { certificateAssetId: `cert_${usageStatus}`, certificateVersionId: `ver_${usageStatus}`, name: usageStatus, primaryDomain: `${usageStatus}.example.com`, notAfter, usageStatus, readinessStage: 'missing_replacement', tags: [], bindingIds: [] }; }
function riskFact(id: string, status: RiskResponseFact['risk']['status'], actions: Array<'acknowledged' | 'resolved' | 'reopened'>): RiskResponseFact { return { risk: { id, dedupKey: id, type: 'certificate_expired', source: 'certificate', status, severity: 'critical', title: id, summary: id, scope: { tenantId: 'tenant_1' }, metadata: {}, firstDetectedAt: '2026-07-01T00:00:00Z', lastDetectedAt: '2026-07-21T00:00:00Z', occurrenceCount: 1 }, history: actions.map((action, index) => ({ id: `${id}_${action}`, tenantId: 'tenant_1', riskEventId: id, action, fromStatus: 'OPEN', toStatus: action === 'resolved' ? 'RESOLVED' : action === 'reopened' ? 'OPEN' : 'ACKED', actorType: 'user', occurredAt: `2026-07-0${index + 1}T01:00:00Z`, metadata: {} })), slaPolicy: { version: 1, severity: 'critical', acknowledgementSeconds: 900, resolutionSeconds: 14400 } }; }
function run(id: string, status: AutomationRunFact['status']): AutomationRunFact { return { id, automationId: 'auto_1', automationVersion: 1, automationNameSnapshot: '自动化', triggerType: 'schedule', status, createdAt: '2026-07-10T00:00:00Z' }; }
function target(id: string, status: AutomationRunTargetFact['status'], patch: Partial<AutomationRunTargetFact> = {}): AutomationRunTargetFact { return { id, runId: 'run_1', automationId: 'auto_1', targetSnapshot: {}, status, actionType: 'execute_deployment_plan', notificationRequestIds: [], attemptCount: 1, manualIntervention: false, createdAt: '2026-07-10T00:00:00Z', ...patch }; }
function metric(overview: Awaited<ReturnType<ReportsApplicationService['overview']>>, key: string) { return overview.metrics.find((item) => item.metricKey === key)!; }
function groupTotal(overview: Awaited<ReturnType<ReportsApplicationService['overview']>>, dimension: string) { return overview.groups.filter((item) => item.dimension === dimension).reduce((sum, item) => sum + item.count, 0); }
function groupCount(overview: Awaited<ReturnType<ReportsApplicationService['overview']>>, dimension: string, value: string) { return overview.groups.find((item) => item.dimension === dimension && item.value === value)?.count ?? 0; }
