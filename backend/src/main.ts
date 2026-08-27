import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppAsync } from './app.module.js';
import { structuredLogger } from './common/logging/structured-logger.js';
import { loadEnvFile } from './config/load-env.js';
import { ensureProductionRuntimeSecurityEnvironment } from './config/production-runtime-secrets.js';
import { loadAppConfig } from './config/app-config.js';
import { bootstrapDatabase } from './database/database-bootstrap.js';
import type { AgentsApplicationService } from './modules/agents/application/agents.application-service.js';
import type { LivenessApplicationService } from './modules/liveness/application/liveness.application-service.js';
import type { MonitorsApplicationService } from './modules/monitors/application/monitors.application-service.js';
import type { AutomationScheduler } from './modules/automations/application/automation-scheduler.js';
import type { AcmeRenewalScheduler } from './modules/internal-ca/application/acme-renewal-scheduler.js';
import { CaOperationsRealtimeGateway, type CaOperationsRealtimeStreamService } from './modules/internal-ca/application/ca-operations-realtime.js';
import type { SecurityServices } from './modules/security/security.controller.js';
import { TaskRealtimeGateway, type TaskRealtimeStreamService } from './modules/tasks/task-realtime-stream.js';
import type { TasksApplicationService } from './modules/tasks/task.application-service.js';
import type { TaskWorkerSupervisor } from './modules/tasks/task-worker-supervisor.js';
import { assertUnifiedTaskWorkerConfiguration } from './modules/tasks/task-enqueue.js';
import { createPersistedSecurityServices } from './modules/security/security-services.persistence.js';
import { auditSecretDecryptability } from './modules/secrets/secret-health-check.js';
import type { BrowserCredentialSessionController } from './modules/browser-runtime/browser-credential-session.controller.js';
import type { CredentialHealthService } from './modules/credentials/health/credential-health.service.js';
import type { CookieSessionStore } from './modules/executors/curl/cookie-session.js';

const entryFilePath = process.argv[1] ? resolve(process.argv[1]) : '';
const currentFilePath = fileURLToPath(import.meta.url);

loadEnvFile();
ensureProductionRuntimeSecurityEnvironment();

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
  const startupConfig = loadAppConfig();
  assertUnifiedTaskWorkerConfiguration(process.env);
  const releasePortLock = startupConfig.env === 'development'
    ? acquirePortLock(startupConfig.port)
    : () => {};
  if (!releasePortLock) {
    structuredLogger.warn('后端端口已有 GCAC 热重载实例占用，跳过重复启动', {
      host: startupConfig.host,
      port: startupConfig.port,
    }, { module: 'bootstrap' });
    return;
  }

  try {
    await startWithPortLock(releasePortLock);
  } catch (error) {
    releasePortLock();
    throw error;
  }
}

async function startWithPortLock(releasePortLock: () => void): Promise<void> {
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

  const credentialHealthService = app.getResource<CredentialHealthService>('credentialHealthService');
  if (credentialHealthService) {
    const healthIntervalMs = positiveNumber(process.env.GCAC_CREDENTIAL_HEALTH_INTERVAL_MS, 15 * 60_000);
    let schedulingHealth = false;
    const scheduleCredentialHealth = () => {
      if (schedulingHealth) return;
      schedulingHealth = true;
      void credentialHealthService.scheduleDue()
        .catch((error: unknown) => {
          structuredLogger.warn('凭据有效性检测调度失败', { error: error instanceof Error ? error.message : String(error) }, { module: 'credential-health' });
        })
        .finally(() => { schedulingHealth = false; });
    };
    scheduleCredentialHealth();
    setInterval(scheduleCredentialHealth, healthIntervalMs);
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
          structuredLogger.error('Monitor batch scheduler failed', {
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

  // ACME 策略既负责到期续签，也负责补偿“申请已落库但续签任务未落库”的首次签发。
  // 调度器只创建任务；实际签发由统一任务 Worker 串行执行。
  const acmeRenewalScheduler = app.getResource<AcmeRenewalScheduler>('acmeRenewalScheduler');
  if (acmeRenewalScheduler) {
    const schedulerIntervalMs = positiveNumber(process.env.ACME_RENEWAL_SCHEDULER_INTERVAL_MS, 60_000);
    const maxPoliciesPerTick = positiveNumber(process.env.ACME_RENEWAL_SCHEDULER_MAX_POLICIES_PER_TICK, 50);
    let schedulingAcmeRenewals = false;
    const tick = () => {
      if (schedulingAcmeRenewals) return;
      schedulingAcmeRenewals = true;
      void acmeRenewalScheduler.runOnce(maxPoliciesPerTick)
        .catch((error: unknown) => {
          structuredLogger.warn('ACME 续签调度失败', {
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

  const server = app.createNodeServer();
  const cookieSessionStore = app.getResource<CookieSessionStore>('cookieSessionStore');
  // Cookie 只存在内存；进程退出前显式清空，覆盖正常退出和可处理终止信号触发的 exit 路径。
  const clearCookieSessions = () => cookieSessionStore?.clearAll();
  if (cookieSessionStore) process.once('exit', clearCookieSessions);
  let terminating = false;
  const terminate = () => {
    if (terminating) return;
    terminating = true;
    clearCookieSessions();
    releasePortLock();
    server.close(() => process.exit(0));
    const forceExit = setTimeout(() => process.exit(1), 5_000);
    forceExit.unref();
  };
  process.once('SIGTERM', terminate);
  process.once('SIGINT', terminate);
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
  const caOperationsRealtimeStream = app.getResource<CaOperationsRealtimeStreamService>('caOperationsRealtimeStream');
  if (caOperationsRealtimeStream && securityServices) {
    const caOperationsRealtimeGateway = new CaOperationsRealtimeGateway(caOperationsRealtimeStream, securityServices);
    app.registerUpgradeHandler((request, socket, head) => caOperationsRealtimeGateway.handleUpgrade(request, socket, head));
  }
  server.once('error', (error: unknown) => {
    releasePortLock();
    structuredLogger.error('后端监听失败', {
      error: error instanceof Error ? error.message : String(error),
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
      host: app.config.host,
      port: app.config.port,
    }, { module: 'bootstrap' });
    process.exit(1);
  });
  server.listen(app.config.port, app.config.host, () => {
    structuredLogger.info('后端服务已启动', {
      host: app.config.host,
      port: app.config.port,
    }, { module: 'bootstrap' });
  });
}

function acquirePortLock(port: number): (() => void) | undefined {
  // 端口锁用于收敛重复的本地热重载进程。
  const lockPath = join(tmpdir(), `gcac-backend-${port}.lock`);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = openSync(lockPath, 'wx', 0o600);
      try {
        writeSync(handle, `${process.pid}\n`, undefined, 'utf8');
      } finally {
        closeSync(handle);
      }

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          const ownerPid = Number(readFileSync(lockPath, 'utf8').trim());
          if (ownerPid === process.pid) unlinkSync(lockPath);
        } catch {
          // 锁文件已经被旧进程清理时无需重复处理。
        }
      };
      process.once('exit', release);
      return release;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'EEXIST') throw error;

      let ownerPid: number;
      try {
        ownerPid = Number(readFileSync(lockPath, 'utf8').trim());
      } catch {
        return undefined;
      }
      if (Number.isInteger(ownerPid) && ownerPid > 0 && isProcessAlive(ownerPid)) return undefined;
      try {
        unlinkSync(lockPath);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
