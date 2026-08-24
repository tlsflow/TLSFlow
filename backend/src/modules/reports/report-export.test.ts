import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PgliteDatabase } from '../../database/pglite-database.js';
import { runMigrations } from '../../database/migration-runner.js';
import type { SecuritySubject } from '../../shared/security-types.js';
import { ReportExportService, buildCsv } from './application/report-export.service.js';
import type { ReportDataPort } from './application/report-data.port.js';
import { ReportsApplicationService } from './application/reports.application-service.js';
import type { IncidentCertificateFact } from './domain/report-calculations.js';
import { ReportsRepository } from './repository/reports.repository.js';
import type { ReportQuery } from './schema/reports.schema.js';

test('CSV 防止公式注入并明确输出时区和截止时间', () => {
  const csv = buildCsv([
    { name: '=HYPERLINK("https://example.com")', owner: '+cmd', note: '-danger', tag: '@test', safe: 'normal' },
  ], 'Asia/Shanghai', '2026-07-21T12:00:00.000Z');

  assert.match(csv, /reportTimeZone/);
  assert.match(csv, /Asia\/Shanghai/);
  assert.match(csv, /2026-07-21 20:00:00/);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'\+cmd/);
  assert.match(csv, /'-danger/);
  assert.match(csv, /'@test/);
  assert.match(csv, /normal/);
});

test('CSV 对引号、逗号和换行使用标准转义', () => {
  const csv = buildCsv([{ value: 'a,"b"\nc' }], 'UTC', '2026-07-21T12:00:00.000Z');
  assert.match(csv, /"a,""b""\nc"/);
});

test('大结果持久入队并由报表 worker 分页生成 Artifact', async () => {
  const db = new PgliteDatabase();
  await runMigrations(db);
  const repository = new ReportsRepository(db);
  const facts = Array.from({ length: 1001 }, (_value, index): IncidentCertificateFact => ({
    certificateAssetId: `cert_${index}`,
    certificateVersionId: `version_${index}`,
    name: `certificate_${index}`,
    primaryDomain: `certificate-${index}.example.com`,
    notAfter: '2026-07-24T12:00:00.000Z',
    usageStatus: 'in_use',
    readinessStage: 'missing_replacement',
    tags: [],
    bindingIds: [],
  }));
  const data: ReportDataPort = {
    async listIncidentCertificates() { return facts; },
    async listRiskResponseFacts() { return []; },
    async listAutomationRuns() { return []; },
    async listAutomationTargets() { return []; },
  };
  const reports = new ReportsApplicationService(data, repository);
  const artifactRoot = await mkdtemp(join(tmpdir(), 'gcac-report-export-'));
  const exports = new ReportExportService(reports, repository, artifactRoot, db);
  const subject: SecuritySubject = { id: 'user_1', type: 'user', scope: { tenantId: 'tenant_1' } };
  const query: ReportQuery = {
    tenantId: 'tenant_1',
    dateFrom: '2026-07-01T00:00:00.000Z',
    dateTo: '2026-07-21T12:00:00.000Z',
    asOf: '2026-07-21T12:00:00.000Z',
    page: 1,
    pageSize: 100,
  };

  try {
    const queued = await exports.create({ reportType: 'incident_window', query, subject, timeZone: 'Asia/Shanghai' });
    assert.equal(queued.status, 'queued');
    assert.equal((await db.query<{ total: number }>("select count(*)::int as total from job_queue where payload->>'jobType' = 'REPORT_EXPORT'")).rows[0]?.total, 1);

    const result = await exports.runNextQueuedJob();
    assert.equal(result?.success, true);

    const succeeded = await exports.get('tenant_1', queued.id);
    assert.equal(succeeded.status, 'succeeded');
    assert.ok(succeeded.artifactId);
    const download = await exports.download('tenant_1', queued.id);
    assert.match((await readFile(join(artifactRoot, download.artifact.storageKey), 'utf8')), /reportTimeZone/);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
