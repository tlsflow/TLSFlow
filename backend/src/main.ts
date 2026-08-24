import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppAsync } from './app.module.js';
import { loadEnvFile } from './config/load-env.js';
import { structuredLogger } from './common/logging/structured-logger.js';
import { bootstrapDatabase } from './database/database-bootstrap.js';
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
  const server = app.createNodeServer();
  server.listen(app.config.port, app.config.host, () => {
    structuredLogger.info('后端服务已启动', { host: app.config.host, port: app.config.port }, { module: 'bootstrap' });
  });
}
