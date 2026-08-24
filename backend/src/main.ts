import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppAsync } from './app.module.js';
import { structuredLogger } from './common/logging/structured-logger.js';
import { loadEnvFile } from './config/load-env.js';
import { bootstrapDatabase } from './database/database-bootstrap.js';
import type { AgentsApplicationService } from './modules/agents/application/agents.application-service.js';
import type { ExecutionsApplicationService } from './modules/executions/application/executions.application-service.js';
import type { MonitorsApplicationService } from './modules/monitors/application/monitors.application-service.js';
import type { NotificationWorker } from './modules/notifications/application/notification-worker.js';
import type { ReportExportService } from './modules/reports/application/report-export.service.js';
import { createPersistedSecurityServices } from './modules/security/security-services.persistence.js';
import { auditSecretDecryptability } from './modules/secrets/secret-health-check.js';

const entryFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
const currentFilePath = fileURLToPath(import.meta.url);

loadEnvFile();

// 只有直接执行入口文件时才启动监听；测试和模块导入只创建应用实例，不抢占端口。
if (entryFilePath !== '' && currentFilePath === entryFilePath) {
  void start();
}

async function start(): Promise<void> {
  const database = await bootstrapDatabase();
  const securityBundle = database.config.backend === 'postgres'
    ? await createPersistedSecurityServices(database.db)
    : undefined;
  const app = await createAppAsync({
    db: database.db,
    corePersistence: {
      mode: database.config.backend === 'postgres' ? 'postgres' : 'memory',
      strict: database.config.backend === 'postgres',
    },
    security: securityBundle?.services,
  }, {
    registerFlushers: async (createdApp) => {
      for (const flusher of securityBundle?.flushers ?? []) {
        createdApp.registerPersistenceFlusher(flusher);
      }
    },
  });

  if (securityBundle) {
    app.setAuthTokenResolver((authorization, cookie) => securityBundle.services.auth.parseRequestIdentity(authorization, cookie));
    await auditSecretDecryptability(securityBundle.services.secrets);
  }

  const agentsService = app.getResource<AgentsApplicationService>('agentsService');
  if (agentsService) {
    const evaluatorIntervalMs = Number(process.env.AGENT_OFFLINE_EVALUATOR_INTERVAL_MS ?? '30000');
    const offlineTimeoutSeconds = Number(process.env.AGENT_OFFLINE_TIMEOUT_SECONDS ?? '180');
    setInterval(() => {
      void agentsService.evaluateOfflineAgents({ offlineTimeoutSeconds }).catch((error: unknown) => {
        structuredLogger.warn('Agent offline evaluator failed', {
          error: error instanceof Error ? error.message : String(error),
        }, { module: 'agents-offline-evaluator' });
      });
    }, evaluatorIntervalMs);
  }

  const executionsService = app.getResource<ExecutionsApplicationService>('executionsService');
  if (executionsService) {
    const workerIntervalMs = Number(process.env.EXECUTION_JOB_WORKER_INTERVAL_MS ?? '2000');
    const maxJobsPerTick = Number(process.env.EXECUTION_JOB_WORKER_MAX_JOBS_PER_TICK ?? '10');
    let draining = false;
    setInterval(() => {
      if (draining) return;
      draining = true;
      void drainExecutionJobs(executionsService, maxJobsPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('Execution job worker failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'execution-job-worker' });
        })
        .finally(() => {
          draining = false;
        });
    }, workerIntervalMs);
  }

  const reportExportService = app.getResource<ReportExportService>('reportExportService');
  if (reportExportService) {
    const workerIntervalMs = Number(process.env.REPORT_EXPORT_WORKER_INTERVAL_MS ?? '2000');
    const maxJobsPerTick = Number(process.env.REPORT_EXPORT_WORKER_MAX_JOBS_PER_TICK ?? '2');
    let draining = false;
    setInterval(() => {
      if (draining) return;
      draining = true;
      void drainReportExportJobs(reportExportService, maxJobsPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('Report export worker failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'report-export-worker' });
        })
        .finally(() => {
          draining = false;
        });
    }, workerIntervalMs);
  }

  const monitorsService = app.getResource<MonitorsApplicationService>('monitorsService');
  if (monitorsService) {
    const monitorIntervalMs = Number(process.env.MONITOR_PROBE_WORKER_INTERVAL_MS ?? '5000');
    const maxTargetsPerTick = Number(process.env.MONITOR_PROBE_WORKER_MAX_TARGETS_PER_TICK ?? '20');
    let probing = false;
    const tick = () => {
      if (probing) return;
      probing = true;
      void monitorsService.runDueMonitorTargetProbes({ maxTargets: maxTargetsPerTick })
        .catch((error: unknown) => {
          structuredLogger.warn('Monitor probe worker failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'monitor-probe-worker' });
        })
        .finally(() => {
          probing = false;
        });
    };
    tick();
    setInterval(tick, monitorIntervalMs);
  }

  const notificationWorker = app.getResource<NotificationWorker>('notificationWorker');
  if (notificationWorker) {
    const workerIntervalMs = Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS ?? '2000');
    const maxDeliveriesPerTick = Number(process.env.NOTIFICATION_WORKER_MAX_DELIVERIES_PER_TICK ?? '20');
    let drainingNotifications = false;
    const tickNotifications = () => {
      if (drainingNotifications) return;
      drainingNotifications = true;
      void drainNotificationDeliveries(notificationWorker, maxDeliveriesPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('Notification worker failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'notification-worker' });
        })
        .finally(() => {
          drainingNotifications = false;
        });
    };
    tickNotifications();
    setInterval(tickNotifications, workerIntervalMs);
  }

  const server = app.createNodeServer();
  server.listen(app.config.port, app.config.host, () => {
    structuredLogger.info('后端服务已启动', {
      host: app.config.host,
      port: app.config.port,
    }, { module: 'bootstrap' });
  });
}

async function drainNotificationDeliveries(worker: NotificationWorker, maxDeliveriesPerTick: number): Promise<void> {
  const limit = Number.isFinite(maxDeliveriesPerTick) && maxDeliveriesPerTick > 0 ? Math.floor(maxDeliveriesPerTick) : 1;
  for (let index = 0; index < limit; index += 1) {
    if (!await worker.runNext()) break;
  }
}

async function drainExecutionJobs(executionsService: ExecutionsApplicationService, maxJobsPerTick: number): Promise<void> {
  const limit = Number.isFinite(maxJobsPerTick) && maxJobsPerTick > 0 ? Math.floor(maxJobsPerTick) : 1;
  for (let index = 0; index < limit; index += 1) {
    const result = await executionsService.runNextQueuedJob();
    if (!result) break;
  }
}

async function drainReportExportJobs(reportExportService: ReportExportService, maxJobsPerTick: number): Promise<void> {
  const limit = Number.isFinite(maxJobsPerTick) && maxJobsPerTick > 0 ? Math.floor(maxJobsPerTick) : 1;
  for (let index = 0; index < limit; index += 1) {
    const result = await reportExportService.runNextQueuedJob();
    if (!result) break;
  }
}
