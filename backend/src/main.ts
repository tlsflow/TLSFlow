import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppAsync } from './app.module.js';
import { structuredLogger } from './common/logging/structured-logger.js';
import { loadEnvFile } from './config/load-env.js';
import { bootstrapDatabase } from './database/database-bootstrap.js';
import type { AgentsApplicationService } from './modules/agents/application/agents.application-service.js';
import type { LivenessApplicationService } from './modules/liveness/application/liveness.application-service.js';
import type { ExecutionsApplicationService } from './modules/executions/application/executions.application-service.js';
import type { MonitorsApplicationService } from './modules/monitors/application/monitors.application-service.js';
import type { NotificationWorker } from './modules/notifications/application/notification-worker.js';
import type { ReportExportService } from './modules/reports/application/report-export.service.js';
import type { AutomationScheduler } from './modules/automations/application/automation-scheduler.js';
import type { CaSyncWorker } from './modules/internal-ca/application/ca-sync-worker.js';
import type { CaAutoSyncScheduler } from './modules/internal-ca/application/ca-auto-sync-scheduler.js';
import type { AcmeRenewalScheduler } from './modules/internal-ca/application/acme-renewal-scheduler.js';
import type { AcmeRenewalWorker } from './modules/internal-ca/application/acme-renewal-worker.js';
import type { SecurityServices } from './modules/security/security.controller.js';
import { TaskRealtimeGateway, type TaskRealtimeStreamService } from './modules/tasks/task-realtime-stream.js';
import type { TasksApplicationService } from './modules/tasks/task.application-service.js';
import type { TaskWorkerSupervisor } from './modules/tasks/task-worker-supervisor.js';
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

  const unifiedTaskWorkerEnabled = process.env.GCAC_UNIFIED_TASK_WORKER_ENABLED !== 'false';
  const taskWorkerSupervisor = app.getResource<TaskWorkerSupervisor>('taskWorkerSupervisor');
  if (unifiedTaskWorkerEnabled && taskWorkerSupervisor) {
    const workerIntervalMs = positiveNumber(process.env.GCAC_TASK_WORKER_INTERVAL_MS, 2_000);
    const maxTasksPerTick = positiveNumber(process.env.GCAC_TASK_WORKER_MAX_TASKS_PER_TICK, 10);
    let drainingTasks = false;
    const tickTasks = () => {
      if (drainingTasks) return;
      drainingTasks = true;
      void taskWorkerSupervisor.runOnce(maxTasksPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('统一任务 Worker 执行失败', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'task-worker-supervisor' });
        })
        .finally(() => {
          drainingTasks = false;
        });
    };
    tickTasks();
    setInterval(tickTasks, workerIntervalMs);
  }

  const agentsService = app.getResource<AgentsApplicationService>('agentsService');
  if (agentsService) {
    const evaluatorIntervalMs = positiveNumber(process.env.AGENT_OFFLINE_EVALUATOR_INTERVAL_MS, 10_000);
    const offlineTimeoutSeconds = positiveNumber(process.env.AGENT_OFFLINE_TIMEOUT_SECONDS, 180);
    const requiredConsecutiveTimeouts = positiveNumber(process.env.AGENT_OFFLINE_REQUIRED_CONSECUTIVE_TIMEOUTS, 2);
    let evaluating = false;
    const evaluateOfflineAgents = () => {
      if (evaluating) return;
      evaluating = true;
      void agentsService.evaluateOfflineAgents({ offlineTimeoutSeconds, requiredConsecutiveTimeouts })
        .catch((error: unknown) => {
          structuredLogger.warn('Agent offline evaluator failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'agents-offline-evaluator' });
        })
        .finally(() => {
          evaluating = false;
        });
    };
    evaluateOfflineAgents();
    setInterval(evaluateOfflineAgents, evaluatorIntervalMs);
  }

  const livenessService = app.getResource<LivenessApplicationService>('livenessService');
  if (livenessService) {
    const probeIntervalMs = positiveNumber(process.env.DEVICE_LIVENESS_PROBE_INTERVAL_MS, 10_000);
    const probeTimeoutMs = positiveNumber(process.env.DEVICE_LIVENESS_TCP_TIMEOUT_MS, 3_000);
    const probeConcurrency = positiveNumber(process.env.DEVICE_LIVENESS_PROBE_CONCURRENCY, 20);
    let probing = false;
    const evaluateManagementProbes = () => {
      if (probing) return;
      probing = true;
      void livenessService.evaluateManagementProbes({ timeoutMs: probeTimeoutMs, concurrency: probeConcurrency })
        .catch((error: unknown) => {
          structuredLogger.warn('Device liveness probe failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'device-liveness-probe' });
        })
        .finally(() => {
          probing = false;
        });
    };
    evaluateManagementProbes();
    setInterval(evaluateManagementProbes, probeIntervalMs);
  }

  const executionsService = app.getResource<ExecutionsApplicationService>('executionsService');
  if (!unifiedTaskWorkerEnabled && executionsService) {
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
  if (!unifiedTaskWorkerEnabled && reportExportService) {
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
  if (!unifiedTaskWorkerEnabled && monitorsService) {
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
  if (unifiedTaskWorkerEnabled && monitorsService) {
    const schedulerIntervalMs = Number(process.env.MONITOR_PROBE_SCHEDULER_INTERVAL_MS ?? '5000');
    const maxTargetsPerTick = Number(process.env.MONITOR_PROBE_WORKER_MAX_TARGETS_PER_TICK ?? '20');
    let schedulingMonitorBatches = false;
    const tick = () => {
      if (schedulingMonitorBatches) return;
      schedulingMonitorBatches = true;
      void monitorsService.scheduleMonitorBatches({ maxTargets: maxTargetsPerTick })
        .catch((error: unknown) => {
          structuredLogger.warn('Monitor batch scheduler failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'monitor-batch-scheduler' });
        })
        .finally(() => {
          schedulingMonitorBatches = false;
        });
    };
    tick();
    setInterval(tick, schedulerIntervalMs);
  }

  const notificationWorker = app.getResource<NotificationWorker>('notificationWorker');
  if (!unifiedTaskWorkerEnabled && notificationWorker) {
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

  const automationScheduler = app.getResource<AutomationScheduler>('automationScheduler');
  if (automationScheduler) {
    const automationIntervalMs = Number(process.env.AUTOMATION_SCHEDULER_INTERVAL_MS ?? '5000');
    const maxRunsPerTick = Number(process.env.AUTOMATION_SCHEDULER_MAX_RUNS_PER_TICK ?? '10');
    let scheduling = false;
    const tick = () => {
      if (scheduling) return;
      scheduling = true;
      const scheduledRuns = unifiedTaskWorkerEnabled
        ? automationScheduler.scheduleDueRuns(maxRunsPerTick)
        : automationScheduler.runOnce(maxRunsPerTick);
      void scheduledRuns
        .catch((error: unknown) => {
          structuredLogger.warn('Automation scheduler failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'automation-scheduler' });
        })
        .finally(() => {
          scheduling = false;
        });
    };
    tick();
    setInterval(tick, automationIntervalMs);
  }

  const caSyncWorker = app.getResource<CaSyncWorker>('caSyncWorker');
  if (!unifiedTaskWorkerEnabled && caSyncWorker) {
    const workerIntervalMs = Number(process.env.CA_SYNC_WORKER_INTERVAL_MS ?? '2000');
    const maxRunsPerTick = Number(process.env.CA_SYNC_WORKER_MAX_RUNS_PER_TICK ?? '4');
    let syncing = false;
    const tick = () => {
      if (syncing) return;
      syncing = true;
      void caSyncWorker.runOnce(maxRunsPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('CA sync worker failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'ca-sync-worker' });
        })
        .finally(() => {
          syncing = false;
        });
    };
    tick();
    setInterval(tick, workerIntervalMs);
  }

  const caAutoSyncScheduler = app.getResource<CaAutoSyncScheduler>('caAutoSyncScheduler');
  if (caAutoSyncScheduler) {
    const schedulerIntervalMs = Number(process.env.CA_AUTO_SYNC_SCHEDULER_INTERVAL_MS ?? '5000');
    const maxTargetsPerTick = Number(process.env.CA_AUTO_SYNC_SCHEDULER_MAX_TARGETS_PER_TICK ?? '8');
    let schedulingCaSync = false;
    const tick = () => {
      if (schedulingCaSync) return;
      schedulingCaSync = true;
      void caAutoSyncScheduler.runOnce(maxTargetsPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('CA automatic sync scheduler failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'ca-auto-sync-scheduler' });
        })
        .finally(() => {
          schedulingCaSync = false;
        });
    };
    tick();
    setInterval(tick, schedulerIntervalMs);
  }

  const acmeRenewalScheduler = app.getResource<AcmeRenewalScheduler>('acmeRenewalScheduler');
  if (acmeRenewalScheduler) {
    const schedulerIntervalMs = positiveNumber(process.env.ACME_RENEWAL_SCHEDULER_INTERVAL_MS, 60_000);
    const maxJobsPerTick = positiveNumber(process.env.ACME_RENEWAL_SCHEDULER_MAX_JOBS_PER_TICK, 50);
    let schedulingAcmeRenewals = false;
    const tick = () => {
      if (schedulingAcmeRenewals) return;
      schedulingAcmeRenewals = true;
      void acmeRenewalScheduler.runOnce(maxJobsPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('ACME renewal scheduler failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'acme-renewal-scheduler' });
        })
        .finally(() => {
          schedulingAcmeRenewals = false;
        });
    };
    tick();
    setInterval(tick, schedulerIntervalMs);
  }

  const acmeRenewalWorker = app.getResource<AcmeRenewalWorker>('acmeRenewalWorker');
  if (!unifiedTaskWorkerEnabled && acmeRenewalWorker) {
    const workerIntervalMs = positiveNumber(process.env.ACME_RENEWAL_WORKER_INTERVAL_MS, 5_000);
    const maxJobsPerTick = positiveNumber(process.env.ACME_RENEWAL_WORKER_MAX_JOBS_PER_TICK, 10);
    let runningAcmeRenewals = false;
    const tick = () => {
      if (runningAcmeRenewals) return;
      runningAcmeRenewals = true;
      void acmeRenewalWorker.runOnce(maxJobsPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('ACME renewal worker failed', {
            error: error instanceof Error ? error.message : String(error),
          }, { module: 'acme-renewal-worker' });
        })
        .finally(() => {
          runningAcmeRenewals = false;
        });
    };
    tick();
    setInterval(tick, workerIntervalMs);
  }

  const server = app.createNodeServer();
  const taskRealtimeStream = app.getResource<TaskRealtimeStreamService>('taskRealtimeStream');
  const tasksService = app.getResource<TasksApplicationService>('tasksService');
  const securityServices = securityBundle?.services ?? app.getResource<SecurityServices>('securityServices');
  if (taskRealtimeStream && tasksService && securityServices) {
    new TaskRealtimeGateway(taskRealtimeStream, tasksService, securityServices)
      .attach(server);
  }
  server.listen(app.config.port, app.config.host, () => {
    structuredLogger.info('后端服务已启动', {
      host: app.config.host,
      port: app.config.port,
    }, { module: 'bootstrap' });
  });
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
