import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AppError } from '../../../common/errors/app-error.js';
import type { DatabasePort } from '../../../database/database-port.js';
import type { JobPayload, JobResult } from '../../../queue/job.types.js';
import { PgJobRunner } from '../../../queue/pg-job-runner.js';
import type { QueuePort } from '../../../queue/queue-port.js';
import type { SecuritySubject } from '../../../shared/security-types.js';
import { newId } from '../../../shared/id.js';
import type { ReportArtifact, ReportQuery, ReportRun, ReportType } from '../schema/reports.schema.js';
import { ReportsRepository } from '../repository/reports.repository.js';
import { ReportsApplicationService } from './reports.application-service.js';
import { enqueueTaskBestEffort, isUnifiedTaskWorkerEnabled, type TaskEnqueuer } from '../../tasks/task-enqueue.js';

export class ReportExportService {
  private readonly queue: QueuePort;

  constructor(
    private readonly reports: ReportsApplicationService,
    private readonly repository: ReportsRepository,
    private readonly artifactRoot = resolve(process.cwd(), '../data/report-artifacts'),
    queueDb?: DatabasePort,
    queue?: QueuePort,
    private readonly tasks?: TaskEnqueuer,
  ) {
    this.queue = queue ?? new PgJobRunner((job) => this.runExportJob(job), queueDb, ['REPORT_EXPORT']);
  }

  async create(input: { reportType: ReportType; query: ReportQuery; subject: SecuritySubject; timeZone: string; columns?: string[] }): Promise<ReportRun> {
    validateTimeZone(input.timeZone);
    const overview = await this.reports.overview(input.reportType, input.query, input.subject);
    const createdAt = new Date().toISOString();
    const run: ReportRun = { id: newId('reportrun'), tenantId: input.query.tenantId, reportType: input.reportType, status: 'queued', filters: { ...input.query }, columns: input.columns ?? [], metricVersions: overview.metricVersions, timeZone: input.timeZone, dataAsOf: input.query.asOf, createdBy: input.subject.id, createdAt };
    await this.repository.createReportRun(run);
    const first = await this.reports.items(input.reportType, { ...input.query, page: 1, pageSize: 500 }, input.subject);
    if (first.total > 1000) {
      if (this.tasks && isUnifiedTaskWorkerEnabled()) {
        enqueueTaskBestEffort(this.tasks, {
          tenantId: run.tenantId,
          taskType: 'REPORT_EXPORT',
          requestedBy: input.subject.id,
          triggerSource: 'reports.export.create',
          idempotencyKey: `report-export:${run.id}`,
          payload: { runId: run.id, query: input.query, subject: input.subject, total: first.total },
          resourceRefs: [{ resourceType: 'reportRun', resourceId: run.id }],
        });
      } else {
        await this.queue.enqueue({
          jobType: 'REPORT_EXPORT',
          resourceType: 'reportRun',
          resourceId: run.id,
          idempotencyKey: `report-export:${run.id}`,
          payload: { runId: run.id, query: input.query, subject: input.subject, total: first.total },
          retryPolicy: { maxAttempts: 3, backoffSeconds: 30 },
        });
      }
      return run;
    }
    try {
      await this.generate(run, input.query, input.subject, first.total);
    } catch (error) {
      await this.markFailed(run.id, error);
      throw error;
    }
    return (await this.repository.getReportRun(run.tenantId, run.id))!;
  }

  list(tenantId: string): Promise<ReportRun[]> { return this.repository.listReportRuns(tenantId); }
  async get(tenantId: string, id: string): Promise<ReportRun> { const run = await this.repository.getReportRun(tenantId, id); if (!run) throw new AppError('RESOURCE_NOT_FOUND', '报表运行不存在', { id }); return run; }
  runNextQueuedJob(): Promise<JobResult | null> { return this.queue.runNext(); }

  async executeTask(payload: Record<string, unknown>): Promise<void> {
    const parsed = parseExportJobPayload(payload);
    const run = await this.repository.getReportRun(parsed.query.tenantId, parsed.runId);
    if (!run) throw new AppError('RESOURCE_NOT_FOUND', '报表运行不存在', { id: parsed.runId });
    try {
      await this.generate(run, parsed.query, parsed.subject, parsed.total);
    } catch (error) {
      await this.markFailed(run.id, error);
      throw error;
    }
  }

  async download(tenantId: string, id: string): Promise<{ run: ReportRun; artifact: ReportArtifact; content: Buffer }> {
    const run = await this.get(tenantId, id);
    if (run.status !== 'succeeded' || !run.artifactId) throw new AppError('VALIDATION_FAILED', '报表尚未生成完成', { id, status: run.status });
    const artifact = await this.repository.getReportArtifact(tenantId, run.artifactId);
    if (!artifact) throw new AppError('RESOURCE_NOT_FOUND', '报表产物不存在', { id });
    if (Date.parse(artifact.expiresAt) <= Date.now()) throw new AppError('RESOURCE_NOT_FOUND', '报表产物已过期', { id });
    return { run, artifact, content: await readFile(resolve(this.artifactRoot, artifact.storageKey)) };
  }

  private async generate(run: ReportRun, query: ReportQuery, subject: SecuritySubject, total: number): Promise<void> {
    const startedAt = new Date().toISOString();
    await this.repository.updateReportRun(run.id, { status: 'running', startedAt });
    const rows: unknown[] = [];
    for (let page = 1; rows.length < total; page += 1) {
      const result = await this.reports.items(run.reportType, { ...query, page, pageSize: 500 }, subject);
      rows.push(...result.items);
      if (result.items.length === 0) break;
    }
    const csv = buildCsv(rows, run.timeZone, run.dataAsOf);
    await mkdir(this.artifactRoot, { recursive: true });
    const storageKey = `${run.tenantId}/${run.id}.csv`;
    const path = resolve(this.artifactRoot, storageKey);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, csv, 'utf8');
    const content = Buffer.from(csv, 'utf8');
    const createdAt = new Date().toISOString();
    const artifact: ReportArtifact = { id: newId('reportartifact'), tenantId: run.tenantId, storageKey, fileName: `${run.reportType}-${run.createdAt.slice(0, 10)}.csv`, contentType: 'text/csv; charset=utf-8', byteSize: content.byteLength, checksumSha256: createHash('sha256').update(content).digest('hex'), expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), createdAt };
    await this.repository.createReportArtifact(artifact);
    await this.repository.updateReportRun(run.id, { status: 'succeeded', artifactId: artifact.id, finishedAt: createdAt });
  }

  private async runExportJob(job: JobPayload): Promise<JobResult> {
    if (job.jobType !== 'REPORT_EXPORT') return { jobId: job.jobId, success: false, errorCode: 'REPORT_EXPORT_JOB_TYPE_INVALID' };
    const payload = parseExportJobPayload(job.payload);
    const run = await this.repository.getReportRun(payload.query.tenantId, payload.runId);
    if (!run) return { jobId: job.jobId, success: false, errorCode: 'REPORT_RUN_NOT_FOUND' };
    try {
      await this.generate(run, payload.query, payload.subject, payload.total);
      return { jobId: job.jobId, success: true };
    } catch (error) {
      const finalAttempt = job.attempt >= job.retryPolicy.maxAttempts;
      await this.repository.updateReportRun(run.id, {
        status: finalAttempt ? 'failed' : 'queued',
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: finalAttempt ? new Date().toISOString() : undefined,
      });
      return { jobId: job.jobId, success: false, errorCode: 'REPORT_EXPORT_GENERATION_FAILED' };
    }
  }

  private markFailed(runId: string, error: unknown): Promise<void> {
    return this.repository.updateReportRun(runId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    });
  }
}

interface ReportExportJobPayload extends Record<string, unknown> {
  runId: string;
  query: ReportQuery;
  subject: SecuritySubject;
  total: number;
}

function parseExportJobPayload(payload: Record<string, unknown>): ReportExportJobPayload {
  const candidate = payload as Partial<ReportExportJobPayload>;
  if (!candidate.runId || !candidate.query || !candidate.subject || !Number.isFinite(candidate.total)) {
    throw new AppError('VALIDATION_FAILED', '报表导出任务载荷不完整');
  }
  return candidate as ReportExportJobPayload;
}

export function buildCsv(rows: unknown[], timeZone: string, dataAsOf: string): string {
  const records = rows.map(flattenRecord);
  const columns = [...new Set(records.flatMap((item) => Object.keys(item)))].sort();
  const header = ['reportTimeZone', 'dataAsOf', ...columns].map(csvCell).join(',');
  const body = records.map((record) => [timeZone, formatInTimeZone(dataAsOf, timeZone), ...columns.map((column) => record[column] ?? '')].map(csvCell).join(','));
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`;
}

function flattenRecord(value: unknown): Record<string, string | number | boolean> { const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { value }; return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, item === null || item === undefined ? '' : typeof item === 'object' ? JSON.stringify(item) : item as string | number | boolean])); }
function csvCell(value: unknown): string { let text = String(value ?? ''); if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
function validateTimeZone(timeZone: string): void { try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date()); } catch { throw new AppError('VALIDATION_FAILED', 'CSV 时区不合法', { timeZone }); } }
function formatInTimeZone(value: string, timeZone: string): string { return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value)); }
