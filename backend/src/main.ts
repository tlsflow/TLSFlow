import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppAsync } from './app.module.js';
import { structuredLogger } from './common/logging/structured-logger.js';
import { loadEnvFile } from './config/load-env.js';
import { bootstrapDatabase } from './database/database-bootstrap.js';
import type { AgentsApplicationService } from './modules/agents/application/agents.application-service.js';
import type { LivenessApplicationService } from './modules/liveness/application/liveness.application-service.js';
import type { MonitorsApplicationService } from './modules/monitors/application/monitors.application-service.js';
import type { AutomationScheduler } from './modules/automations/application/automation-scheduler.js';
import type { SecurityServices } from './modules/security/security.controller.js';
import { TaskRealtimeGateway, type TaskRealtimeStreamService } from './modules/tasks/task-realtime-stream.js';
import type { TasksApplicationService } from './modules/tasks/task.application-service.js';
import type { TaskWorkerSupervisor } from './modules/tasks/task-worker-supervisor.js';
import { createPersistedSecurityServices } from './modules/security/security-services.persistence.js';
import { auditSecretDecryptability } from './modules/secrets/secret-health-check.js';
import type { BrowserCredentialSessionController } from './modules/browser-runtime/browser-credential-session.controller.js';

const entryFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
const currentFilePath = fileURLToPath(import.meta.url);

loadEnvFile();

// 只有直接执行入口文件时才启动监听；测试和模块导入只创建应用实例，不抢占端口。
if (entryFilePath !== '' && currentFilePath === entryFilePath) {
  void start().catch((error: unknown) => {
    structuredLogger.error('后端启动失败', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, { module: 'bootstrap' });
    process.exitCode = 1;
  });
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

  const taskWorkerSupervisor = app.getResource<TaskWorkerSupervisor>('taskWorkerSupervisor');
  if (taskWorkerSupervisor) {
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

  const monitorsService = app.getResource<MonitorsApplicationService>('monitorsService');
  if (monitorsService) {
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

  const automationScheduler = app.getResource<AutomationScheduler>('automationScheduler');
  if (automationScheduler) {
    const automationIntervalMs = Number(process.env.AUTOMATION_SCHEDULER_INTERVAL_MS ?? '5000');
    const maxRunsPerTick = Number(process.env.AUTOMATION_SCHEDULER_MAX_RUNS_PER_TICK ?? '10');
    let scheduling = false;
    const tick = () => {
      if (scheduling) return;
      scheduling = true;
      const scheduledRuns = automationScheduler.scheduleDueRuns(maxRunsPerTick);
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

  const server = app.createNodeServer();
  const browserCredentialSessionController = app.getResource<BrowserCredentialSessionController>('browserCredentialSessionController');
  if (browserCredentialSessionController) {
    app.registerUpgradeHandler((request, socket, head) => browserCredentialSessionController.handleUpgrade(request, socket, head));
  }
  const taskRealtimeStream = app.getResource<TaskRealtimeStreamService>('taskRealtimeStream');
  const tasksService = app.getResource<TasksApplicationService>('tasksService');
  const securityServices = securityBundle?.services ?? app.getResource<SecurityServices>('securityServices');
  if (taskRealtimeStream && tasksService && securityServices) {
    const taskRealtimeGateway = new TaskRealtimeGateway(taskRealtimeStream, tasksService, securityServices);
    app.registerUpgradeHandler((request, socket, head) => taskRealtimeGateway.handleUpgrade(request, socket, head));
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
