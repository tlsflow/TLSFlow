import { createApp } from './app.module.js';
import { structuredLogger } from './common/logging/structured-logger.js';

const app = createApp();
const server = app.createNodeServer();

// 注意：只有直接执行 main.ts 编译产物时才启动监听。测试和导入 createApp 不会启动开发服务器。
if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(app.config.port, app.config.host, () => {
    structuredLogger.info('后端服务已启动', { host: app.config.host, port: app.config.port }, { module: 'bootstrap' });
  });
}
