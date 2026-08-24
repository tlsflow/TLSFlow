import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppAsync } from './app.module.js';
import { structuredLogger } from './common/logging/structured-logger.js';
import { loadEnvFile } from './config/load-env.js';
import { bootstrapDatabase } from './database/database-bootstrap.js';
import type { AgentsApplicationService } from './modules/agents/application/agents.application-service.js';
import type { ExecutionsApplicationService } from './modules/executions/application/executions.application-service.js';
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
    app.setAuthTokenResolver((authorization) => securityBundle.services.auth.parseAuthorizationHeader(authorization));
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

  const server = app.createNodeServer();
  server.listen(app.config.port, app.config.host, () => {
    structuredLogger.info('后端服务已启动', {
      host: app.config.host,
      port: app.config.port,
    }, { module: 'bootstrap' });
  });
}

async function drainExecutionJobs(executionsService: ExecutionsApplicationService, maxJobsPerTick: number): Promise<void> {
  const limit = Number.isFinite(maxJobsPerTick) && maxJobsPerTick > 0 ? Math.floor(maxJobsPerTick) : 1;
  for (let index = 0; index < limit; index += 1) {
    const result = await executionsService.runNextQueuedJob();
    if (!result) break;
  }
}
